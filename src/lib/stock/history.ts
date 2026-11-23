import { Prisma, StockReason } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { onShelfByVariant } from "./ledger";

export interface StockHistoryRow {
  id: string;
  variantId: string;
  garmentName: string;
  variantLabel: string;
  reason: StockReason;
  delta: number;
  note: string | null;
  staffName: string | null;
  createdAt: string;
  /** On-shelf count right after this movement (single-variant view only). */
  balanceAfter: number | null;
  /** Staff may undo their own supplier delivery for a few minutes. */
  undoable: boolean;
  sourceKey: string;
}

export const UNDO_WINDOW_MS = 5 * 60_000;

/**
 * Walk back from today's count: newest row's balance is the current count,
 * each older row's is that minus the newer rows' deltas.
 */
export function withRunningBalance<T extends { delta: number }>(rowsNewestFirst: T[], current: number) {
  let bal = current;
  return rowsNewestFirst.map((r) => {
    const out = { ...r, balanceAfter: bal };
    bal -= r.delta;
    return out;
  });
}

export function isUndoable(
  m: { reason: StockReason; sourceKey: string; createdAt: Date },
  now: Date = new Date()
): boolean {
  return (
    m.reason === StockReason.SUPPLIER_IN &&
    m.sourceKey.startsWith("in:") &&
    now.getTime() - m.createdAt.getTime() <= UNDO_WINDOW_MS
  );
}

export async function getStockHistory(opts: {
  variantId?: string | null;
  garmentId?: string | null;
  staffMemberId?: string | null;
  since?: Date | null;
  reasons?: StockReason[];
  limit?: number;
  before?: Date | null;
  now?: Date;
}): Promise<{ rows: StockHistoryRow[]; hasMore: boolean }> {
  const limit = Math.min(200, Math.max(1, opts.limit ?? 50));
  const now = opts.now ?? new Date();
  const where: Prisma.StockMovementWhereInput = {
    ...(opts.variantId ? { garmentVariantId: opts.variantId } : {}),
    ...(opts.garmentId ? { garmentVariant: { garmentId: opts.garmentId } } : {}),
    ...(opts.staffMemberId ? { staffMemberId: opts.staffMemberId } : {}),
    ...(opts.reasons?.length ? { reason: { in: opts.reasons } } : {}),
    ...(opts.since || opts.before
      ? {
          createdAt: {
            ...(opts.since ? { gte: opts.since } : {}),
            ...(opts.before ? { lt: opts.before } : {}),
          },
        }
      : {}),
  };
  const rows = await prisma.stockMovement.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    include: { garmentVariant: { select: { label: true, garment: { select: { name: true } } } } },
  });
  const page = rows.slice(0, limit);
  const staffIds = [...new Set(page.map((r) => r.staffMemberId).filter((s): s is string => Boolean(s)))];
  const staff = staffIds.length
    ? await prisma.staffMember.findMany({ where: { id: { in: staffIds } }, select: { id: true, name: true } })
    : [];
  const staffName = new Map(staff.map((s) => [s.id, s.name]));
  const undoCandidates = page.filter((r) => isUndoable(r, now)).map((r) => `undo:${r.id}`);
  const undone = new Set(
    undoCandidates.length
      ? (
          await prisma.stockMovement.findMany({
            where: { sourceKey: { in: undoCandidates } },
            select: { sourceKey: true },
          })
        ).map((u) => u.sourceKey.slice("undo:".length))
      : []
  );

  let balances: Array<number | null> = page.map(() => null);
  // A running balance only makes sense for one variant, from the newest row.
  if (opts.variantId && !opts.before && !opts.staffMemberId && !opts.reasons?.length) {
    const current = (await onShelfByVariant([opts.variantId])).get(opts.variantId) ?? 0;
    balances = withRunningBalance(page, current).map((r) => r.balanceAfter);
  }

  return {
    rows: page.map((r, i) => ({
      id: r.id,
      variantId: r.garmentVariantId,
      garmentName: r.garmentVariant.garment.name,
      variantLabel: r.garmentVariant.label,
      reason: r.reason,
      delta: r.delta,
      note: r.note,
      staffName: r.staffMemberId ? (staffName.get(r.staffMemberId) ?? null) : null,
      createdAt: r.createdAt.toISOString(),
      balanceAfter: balances[i],
      undoable: isUndoable(r, now) && !undone.has(r.id),
      sourceKey: r.sourceKey,
    })),
    hasMore: rows.length > limit,
  };
}

/**
 * Undo a supplier delivery within the window, by the same staff (or the
 * owner). Adds a reversing movement so the history still shows both.
 */
export async function undoSupplierDelivery(
  movementId: string,
  actor: { staffMemberId: string | null; isOwner: boolean },
  now: Date = new Date()
): Promise<{ ok: true; variantId: string; delta: number } | { ok: false; status: number; error: string }> {
  const m = await prisma.stockMovement.findUnique({ where: { id: movementId } });
  if (!m) return { ok: false, status: 404, error: "Entry not found." };
  if (!isUndoable(m, now)) return { ok: false, status: 409, error: "Too late to undo. Ask the owner to recount." };
  if (!actor.isOwner && m.staffMemberId !== actor.staffMemberId) {
    return { ok: false, status: 403, error: "Only the person who added it can undo it." };
  }
  try {
    await prisma.stockMovement.create({
      data: {
        garmentVariantId: m.garmentVariantId,
        delta: -m.delta,
        reason: StockReason.ADJUSTMENT,
        sourceKey: `undo:${m.id}`,
        note: `Undid delivery of ${m.delta}${m.note ? ` (${m.note})` : ""}`,
        staffMemberId: actor.staffMemberId,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { ok: false, status: 409, error: "Already undone." };
    }
    throw err;
  }
  return { ok: true, variantId: m.garmentVariantId, delta: -m.delta };
}
