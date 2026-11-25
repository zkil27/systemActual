import { PhysicalCondition } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { syncReturnRestock } from "@/lib/stock/ledger";
import { auditRow, type AuditActor } from "@/lib/audit";
import { summaryFromStoredChecks } from "./item-check";

/** Staff can take back a return scan this long after saving it. */
export const SCAN_UNDO_WINDOW_MS = 5 * 60_000;

export type UndoDecision = { ok: true } | { ok: false; status: number; error: string };

/** Who may undo which scan, when. Pure. */
export function canUndoScan(
  scan: { staffMemberId: string; scannedAt: Date },
  actor: { staffMemberId: string | null; isOwner: boolean },
  now: Date = new Date()
): UndoDecision {
  if (now.getTime() - scan.scannedAt.getTime() > SCAN_UNDO_WINDOW_MS) {
    return { ok: false, status: 409, error: "Too late to undo. Ask the owner to fix the condition." };
  }
  if (!actor.isOwner && actor.staffMemberId !== scan.staffMemberId) {
    return { ok: false, status: 403, error: "Only the person who scanned it can undo it." };
  }
  return { ok: true };
}

/** What the parcel looks like after a scan is removed: the previous scan, or never arrived. */
export function parcelAfterUndo(
  remaining: Array<{ condition: PhysicalCondition; scannedAt: Date }>
): { physicalCondition: PhysicalCondition | null; physicallyReceivedAt: Date | null } {
  if (!remaining.length) return { physicalCondition: null, physicallyReceivedAt: null };
  const sorted = [...remaining].sort((a, b) => a.scannedAt.getTime() - b.scannedAt.getTime());
  return {
    physicalCondition: sorted[sorted.length - 1].condition,
    physicallyReceivedAt: sorted[0].scannedAt,
  };
}

/**
 * Remove a just-saved return scan. The parcel falls back to its previous scan
 * (or "not arrived", so it's Missing again if it was), and the shelf count is
 * corrected. Photos stay in storage; they are no longer linked.
 */
export async function undoReturnScan(
  scanId: string,
  actor: { staffMemberId: string | null; isOwner: boolean; audit?: AuditActor },
  now: Date = new Date()
): Promise<{ ok: true; parcelId: string; restockDelta: number } | { ok: false; status: number; error: string }> {
  const scan = await prisma.physicalScan.findUnique({ where: { id: scanId } });
  if (!scan) return { ok: false, status: 404, error: "Scan not found (already undone?)." };
  const decision = canUndoScan(scan, actor, now);
  if (!decision.ok) return decision;

  await prisma.$transaction(async (tx) => {
    await tx.physicalScan.delete({ where: { id: scan.id } });
    const remaining = await tx.physicalScan.findMany({
      where: { parcelId: scan.parcelId },
      select: { condition: true, scannedAt: true, itemChecks: true },
    });
    // The item summary follows the scan that's now the latest (or clears).
    const latest = [...remaining].sort((a, b) => b.scannedAt.getTime() - a.scannedAt.getTime())[0];
    const after = parcelAfterUndo(remaining);
    await tx.returnParcel.update({
      where: { id: scan.parcelId },
      data: { ...after, ...summaryFromStoredChecks(latest?.itemChecks ?? [], latest?.scannedAt ?? null) },
    });
    if (actor.audit) {
      await tx.auditLog.create({
        data: auditRow({
          actor: actor.audit,
          action: "return.scan_undone",
          entity: "ReturnParcel",
          entityId: scan.parcelId,
          before: { condition: scan.condition, scannedAt: scan.scannedAt },
          after: { condition: after.physicalCondition, receivedAt: after.physicallyReceivedAt },
          at: now,
        }),
      });
    }
    await tx.returnEvent.create({
      data: {
        parcelId: scan.parcelId,
        source: "WAREHOUSE_SCAN",
        rawStatus: "SCAN_UNDONE",
        description: "Scan undone by staff",
        eventTimestamp: now,
      },
    });
  });

  const restockDelta = await syncReturnRestock(scan.parcelId, actor.staffMemberId);
  return { ok: true, parcelId: scan.parcelId, restockDelta };
}
