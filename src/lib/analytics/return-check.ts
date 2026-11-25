import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isPartialReturn, isWrongItemReturn, refundedNotBackWhere } from "@/lib/returns/rules";

/**
 * "Was it all returned?" numbers for Today and Telegram. Counts parcels
 * scanned in the range; "refunded, not back" is the open list right now.
 */
export interface ReturnCheckSummary {
  /** Parcels scanned in the range. */
  arrivedCount: number;
  /** Of those, checked item by item. */
  itemCheckedCount: number;
  /** Some pieces never came back. */
  partialCount: number;
  /** Something other than what we sent came back. */
  wrongItemCount: number;
  /** Refund (or order value) minus what came back, on partial / wrong-item parcels. Owner only. */
  shortPhp: number;
  /** Buyer refund paid, nothing scanned back (open now). */
  refundedNotBackCount: number;
  refundedNotBackPhp: number;
}

export interface ReturnCheckRow {
  physicalCondition: string | null;
  piecesMissing: number | null;
  piecesWrong: number | null;
  itemCheckedAt: Date | null;
  orderTotalPhp: number;
  receivedValuePhp: number | null;
}

/** Pure: the range's numbers from the parcels scanned in it. */
export function summarizeReturnChecks(
  arrived: ReturnCheckRow[],
  refundedNotBack: { count: number; totalPhp: number }
): ReturnCheckSummary {
  let partialCount = 0;
  let wrongItemCount = 0;
  let itemCheckedCount = 0;
  let shortPhp = 0;
  for (const p of arrived) {
    if (p.itemCheckedAt) itemCheckedCount++;
    const partial = isPartialReturn(p);
    const wrong = isWrongItemReturn(p);
    if (partial) partialCount++;
    if (wrong) wrongItemCount++;
    if ((partial || wrong) && p.receivedValuePhp !== null) {
      shortPhp += Math.max(0, p.orderTotalPhp - p.receivedValuePhp);
    }
  }
  return {
    arrivedCount: arrived.length,
    itemCheckedCount,
    partialCount,
    wrongItemCount,
    shortPhp: Math.round(shortPhp),
    refundedNotBackCount: refundedNotBack.count,
    refundedNotBackPhp: Math.round(refundedNotBack.totalPhp),
  };
}

export async function getReturnCheckSummary(opts: {
  start: Date;
  end: Date;
  missingSinceAt: Date | null;
  shopWhere?: Prisma.ReturnParcelWhereInput;
}): Promise<ReturnCheckSummary> {
  const shopWhere = opts.shopWhere ?? {};
  const [arrived, gap] = await Promise.all([
    prisma.returnParcel.findMany({
      where: { ...shopWhere, physicallyReceivedAt: { gte: opts.start, lt: opts.end } },
      select: {
        physicalCondition: true,
        piecesMissing: true,
        piecesWrong: true,
        itemCheckedAt: true,
        orderTotalPhp: true,
        receivedValuePhp: true,
      },
    }),
    prisma.returnParcel.aggregate({
      where: { ...shopWhere, ...refundedNotBackWhere(opts.missingSinceAt) },
      _count: { _all: true },
      _sum: { orderTotalPhp: true },
    }),
  ]);
  return summarizeReturnChecks(
    arrived.map((p) => ({
      ...p,
      orderTotalPhp: Number(p.orderTotalPhp),
      receivedValuePhp: p.receivedValuePhp === null ? null : Number(p.receivedValuePhp),
    })),
    { count: gap._count._all, totalPhp: Number(gap._sum.orderTotalPhp ?? 0) }
  );
}

/** One line for Telegram, or null on a quiet day. */
export function returnCheckLine(s: ReturnCheckSummary): string | null {
  const parts = [
    s.partialCount ? `${s.partialCount} partial return${s.partialCount === 1 ? "" : "s"}` : null,
    s.wrongItemCount ? `${s.wrongItemCount} wrong item${s.wrongItemCount === 1 ? "" : "s"}` : null,
    s.shortPhp ? `PHP ${s.shortPhp.toLocaleString("en-PH")} refunded for pieces not back` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}
