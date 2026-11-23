import { DisputeStatus, PhysicalCondition, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { syncReturnRestock } from "@/lib/stock/ledger";

export type ReturnAction =
  | {
      action: "set_dispute";
      status: DisputeStatus;
      ref?: string | null;
      reimbursedPhp?: number | null;
      note?: string | null;
    }
  | { action: "resolve"; outcome: "FOUND" | "SETTLED"; note?: string | null }
  | { action: "reopen" }
  | { action: "correct_condition"; condition: PhysicalCondition; note?: string | null };

export interface ReturnActionState {
  disputeStatus: DisputeStatus;
  disputeFiledAt: Date | null;
  disputeRef: string | null;
  reimbursedPhp: number | null;
  resolvedAt: Date | null;
  resolvedNote: string | null;
  physicalCondition: PhysicalCondition | null;
  physicallyReceivedAt: Date | null;
}

export type ReturnPlan =
  | {
      ok: true;
      data: Prisma.ReturnParcelUpdateInput;
      /** Owner-history line stored as a ReturnEvent (source OWNER). */
      event: { rawStatus: string; description: string };
      /** Condition changed: the latest scan and the shelf count must follow. */
      conditionChanged: boolean;
    }
  | { ok: false; status: number; error: string };

const CLOSED: ReadonlySet<DisputeStatus> = new Set([DisputeStatus.WON, DisputeStatus.LOST]);

const STATUS_WORD: Record<DisputeStatus, string> = {
  NONE: "Dispute cleared",
  FILED: "Dispute filed",
  WON: "Dispute won",
  LOST: "Dispute lost",
};

/**
 * Decide what one owner action changes. Pure, so every transition is tested.
 * - FILED keeps the parcel open (still Missing until settled).
 * - WON / LOST settle it; moving back to NONE / FILED reopens it.
 * - "Found" / "Settled" close it by hand; "Reopen" undoes that.
 * - A condition fix only applies to a parcel that was actually scanned.
 */
export function planReturnAction(state: ReturnActionState, action: ReturnAction, now: Date = new Date()): ReturnPlan {
  switch (action.action) {
    case "set_dispute": {
      const data: Prisma.ReturnParcelUpdateInput = { disputeStatus: action.status };
      if (action.ref !== undefined) data.disputeRef = action.ref || null;
      data.disputeFiledAt = action.status === DisputeStatus.NONE ? null : (state.disputeFiledAt ?? now);
      // Money back only exists once a dispute is won.
      if (action.status !== DisputeStatus.WON) data.reimbursedPhp = null;
      else if (action.reimbursedPhp !== undefined) data.reimbursedPhp = action.reimbursedPhp;
      if (CLOSED.has(action.status)) {
        data.resolvedAt = state.resolvedAt ?? now;
        data.resolvedNote = action.note || STATUS_WORD[action.status];
      } else if (CLOSED.has(state.disputeStatus)) {
        data.resolvedAt = null;
        data.resolvedNote = null;
      }
      const extras = [
        action.ref ? `ref ${action.ref}` : null,
        action.status === DisputeStatus.WON && action.reimbursedPhp ? `₱${action.reimbursedPhp.toFixed(2)} back` : null,
        action.note || null,
      ].filter(Boolean);
      return {
        ok: true,
        data,
        event: {
          rawStatus: `DISPUTE_${action.status}`,
          description: [STATUS_WORD[action.status], ...extras].join(" · "),
        },
        conditionChanged: false,
      };
    }
    case "resolve": {
      const word = action.outcome === "FOUND" ? "Found" : "Settled";
      return {
        ok: true,
        data: { resolvedAt: now, resolvedNote: action.note ? `${word}: ${action.note}` : word },
        event: { rawStatus: `RESOLVED_${action.outcome}`, description: action.note ? `${word} · ${action.note}` : word },
        conditionChanged: false,
      };
    }
    case "reopen": {
      if (!state.resolvedAt) return { ok: false, status: 409, error: "This parcel is already open." };
      return {
        ok: true,
        data: { resolvedAt: null, resolvedNote: null },
        event: { rawStatus: "REOPENED", description: "Reopened" },
        conditionChanged: false,
      };
    }
    case "correct_condition": {
      if (!state.physicallyReceivedAt) {
        return { ok: false, status: 409, error: "Only scanned parcels have a condition to fix." };
      }
      if (state.physicalCondition === action.condition) {
        return { ok: false, status: 409, error: "That is already the condition." };
      }
      return {
        ok: true,
        data: { physicalCondition: action.condition },
        event: {
          rawStatus: "CONDITION_CORRECTED",
          description: [`Condition ${state.physicalCondition ?? "none"} → ${action.condition}`, action.note]
            .filter(Boolean)
            .join(" · "),
        },
        conditionChanged: true,
      };
    }
  }
}

export type ReturnActionResult =
  | { ok: true; restockDelta: number }
  | { ok: false; status: number; error: string };

export async function applyReturnAction(
  parcelId: string,
  action: ReturnAction,
  now: Date = new Date()
): Promise<ReturnActionResult> {
  const parcel = await prisma.returnParcel.findUnique({
    where: { id: parcelId },
    select: {
      id: true,
      disputeStatus: true,
      disputeFiledAt: true,
      disputeRef: true,
      reimbursedPhp: true,
      resolvedAt: true,
      resolvedNote: true,
      physicalCondition: true,
      physicallyReceivedAt: true,
      scans: { orderBy: { scannedAt: "desc" }, take: 1, select: { id: true } },
    },
  });
  if (!parcel) return { ok: false, status: 404, error: "Parcel not found." };

  const plan = planReturnAction(
    { ...parcel, reimbursedPhp: parcel.reimbursedPhp === null ? null : Number(parcel.reimbursedPhp) },
    action,
    now
  );
  if (!plan.ok) return plan;

  const latestScanId = parcel.scans[0]?.id;
  await prisma.$transaction([
    prisma.returnParcel.update({ where: { id: parcel.id }, data: plan.data }),
    prisma.returnEvent.create({
      data: {
        parcelId: parcel.id,
        source: "OWNER",
        rawStatus: plan.event.rawStatus,
        description: plan.event.description,
        eventTimestamp: now,
      },
    }),
    ...(plan.conditionChanged && latestScanId && action.action === "correct_condition"
      ? [prisma.physicalScan.update({ where: { id: latestScanId }, data: { condition: action.condition } })]
      : []),
  ]);

  const restockDelta = plan.conditionChanged ? await syncReturnRestock(parcel.id) : 0;
  return { ok: true, restockDelta };
}
