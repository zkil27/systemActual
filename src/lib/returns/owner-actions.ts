import { DisputeStatus, PhysicalCondition, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { syncReturnRestock } from "@/lib/stock/ledger";
import { auditRow, type AuditActor } from "@/lib/audit";
import {
  applyItemChecks,
  checkFromCondition,
  deriveParcelCondition,
  describeLine,
  expectedLinesFromItems,
  priceLines,
  returnCheckSummary,
  type ExpectedLine,
  type ItemCheckInput,
} from "./item-check";

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
  | { action: "correct_condition"; condition: PhysicalCondition; note?: string | null }
  | { action: "correct_items"; checks: ItemCheckInput[]; packagingTorn?: boolean; note?: string | null };

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
    case "correct_items":
      // Needs the latest scan's lines; handled by correctReturnItems.
      return { ok: false, status: 400, error: "Fix items with correctReturnItems." };
  }
}

const OWNER: AuditActor = { type: "OWNER", id: null, name: "Owner" };

/** Lines a fix is checked against: the latest scan's saved lines (same keys and prices), else the parcel's items. */
function expectedForFix(
  saved: Array<{
    lineKey: string;
    name: string;
    variationName: string | null;
    imageUrl: string | null;
    expectedQty: number;
    listingId: string | null;
    variationId: string | null;
    unitPricePhp: Prisma.Decimal | null;
  }>,
  itemsJson: Prisma.JsonValue
): ExpectedLine[] {
  if (!saved.length) return expectedLinesFromItems(itemsJson);
  return saved.map((c) => ({
    lineKey: c.lineKey,
    name: c.name,
    variationName: c.variationName,
    imageUrl: c.imageUrl,
    quantity: c.expectedQty,
    listingId: c.listingId,
    variationId: c.variationId,
    unitPricePhp: c.unitPricePhp === null ? null : Number(c.unitPricePhp),
  }));
}

/**
 * Owner fixes the item-by-item check of a scanned parcel: the latest scan's
 * lines are replaced, the parcel condition and summary follow, and the shelf
 * count is balanced. Kept in the parcel's history with before and after.
 */
export async function correctReturnItems(
  parcelId: string,
  input: { checks: ItemCheckInput[]; packagingTorn?: boolean; note?: string | null },
  actor: AuditActor = OWNER,
  now: Date = new Date()
): Promise<ReturnActionResult> {
  const parcel = await prisma.returnParcel.findUnique({
    where: { id: parcelId },
    select: {
      id: true,
      category: true,
      orderTotalPhp: true,
      itemsJson: true,
      physicalCondition: true,
      physicallyReceivedAt: true,
      piecesGood: true,
      piecesDamaged: true,
      piecesWrong: true,
      piecesMissing: true,
      scans: {
        orderBy: { scannedAt: "desc" },
        take: 1,
        select: { id: true, packagingTorn: true, itemChecks: true },
      },
    },
  });
  if (!parcel) return { ok: false, status: 404, error: "Parcel not found." };
  const scan = parcel.scans[0];
  if (!parcel.physicallyReceivedAt || !scan) {
    return { ok: false, status: 409, error: "Only scanned parcels have items to fix." };
  }
  const expected = expectedForFix(scan.itemChecks, parcel.itemsJson);
  if (!expected.length) {
    return { ok: false, status: 409, error: "This parcel has no item list. Fix the condition instead." };
  }
  const applied = applyItemChecks(expected, input.checks);
  if (!applied.ok) return { ok: false, status: 400, error: applied.error };

  const packagingTorn = input.packagingTorn ?? scan.packagingTorn;
  const condition = deriveParcelCondition(applied.lines, packagingTorn);
  const priced = priceLines(applied.lines, parcel.category, Number(parcel.orderTotalPhp));
  const summary = returnCheckSummary(priced);
  const problems = applied.lines.filter((l) => l.goodQty < l.quantity).map(describeLine);

  await prisma.$transaction([
    prisma.returnItemCheck.deleteMany({ where: { scanId: scan.id } }),
    prisma.returnItemCheck.createMany({
      data: priced.map((l) => ({
        scanId: scan.id,
        parcelId: parcel.id,
        lineKey: l.lineKey,
        listingId: l.listingId,
        variationId: l.variationId,
        name: l.name,
        variationName: l.variationName,
        imageUrl: l.imageUrl,
        expectedQty: l.quantity,
        goodQty: l.goodQty,
        damagedQty: l.damagedQty,
        wrongQty: l.wrongQty,
        missingQty: l.missingQty,
        result: l.result,
        unitPricePhp: l.pricePhp,
        priceSource: l.priceSource,
      })),
    }),
    prisma.physicalScan.update({ where: { id: scan.id }, data: { condition, packagingTorn } }),
    prisma.returnParcel.update({
      where: { id: parcel.id },
      data: {
        physicalCondition: condition,
        piecesGood: summary.piecesGood,
        piecesDamaged: summary.piecesDamaged,
        piecesWrong: summary.piecesWrong,
        piecesMissing: summary.piecesMissing,
        receivedValuePhp: summary.receivedValuePhp,
        itemCheckedAt: now,
      },
    }),
    prisma.returnEvent.create({
      data: {
        parcelId: parcel.id,
        source: "OWNER",
        rawStatus: "ITEMS_CORRECTED",
        description: ["Items fixed", problems.length ? problems.join("; ") : "all came back good", input.note]
          .filter(Boolean)
          .join(" · ")
          .slice(0, 500),
        eventTimestamp: now,
      },
    }),
    prisma.auditLog.create({
      data: auditRow({
        actor,
        action: "return.items_corrected",
        entity: "ReturnParcel",
        entityId: parcel.id,
        before: {
          condition: parcel.physicalCondition,
          good: parcel.piecesGood,
          damaged: parcel.piecesDamaged,
          wrong: parcel.piecesWrong,
          missing: parcel.piecesMissing,
        },
        after: {
          condition,
          good: summary.piecesGood,
          damaged: summary.piecesDamaged,
          wrong: summary.piecesWrong,
          missing: summary.piecesMissing,
        },
        at: now,
      }),
    }),
  ]);

  const restockDelta = await syncReturnRestock(parcel.id);
  return { ok: true, restockDelta };
}

export type ReturnActionResult =
  | { ok: true; restockDelta: number }
  | { ok: false; status: number; error: string };

export async function applyReturnAction(
  parcelId: string,
  action: ReturnAction,
  now: Date = new Date(),
  actor: AuditActor = OWNER
): Promise<ReturnActionResult> {
  if (action.action === "correct_items") return correctReturnItems(parcelId, action, actor, now);
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
      scans: {
        orderBy: { scannedAt: "desc" },
        take: 1,
        select: { id: true, itemChecks: { select: { lineKey: true, expectedQty: true } } },
      },
    },
  });
  if (!parcel) return { ok: false, status: 404, error: "Parcel not found." };

  // An item-checked parcel's condition comes from its items. A one-piece
  // parcel's condition fix is turned into the matching item fix; bigger
  // parcels must be fixed item by item.
  const savedChecks = parcel.scans[0]?.itemChecks ?? [];
  if (action.action === "correct_condition" && savedChecks.length > 0) {
    if (savedChecks.length !== 1 || savedChecks[0].expectedQty !== 1) {
      return { ok: false, status: 409, error: "This return was checked item by item. Fix the items instead." };
    }
    if (parcel.physicalCondition === action.condition) {
      return { ok: false, status: 409, error: "That is already the condition." };
    }
    const one = checkFromCondition(
      {
        lineKey: savedChecks[0].lineKey,
        name: "",
        variationName: null,
        imageUrl: null,
        quantity: 1,
        listingId: null,
        variationId: null,
        unitPricePhp: null,
      },
      action.condition
    );
    return correctReturnItems(
      parcelId,
      {
        checks: [{ lineKey: one.lineKey, missing: one.missingQty, wrong: one.wrongQty, damaged: one.damagedQty }],
        packagingTorn: action.condition === PhysicalCondition.DAMAGED_PACKAGING,
        note: action.note,
      },
      actor,
      now
    );
  }

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
    prisma.auditLog.create({
      data: auditRow({
        actor,
        action: `return.${action.action}`,
        entity: "ReturnParcel",
        entityId: parcel.id,
        before: {
          disputeStatus: parcel.disputeStatus,
          resolvedAt: parcel.resolvedAt,
          condition: parcel.physicalCondition,
        },
        after: plan.data,
        at: now,
      }),
    }),
  ]);

  const restockDelta = plan.conditionChanged ? await syncReturnRestock(parcel.id) : 0;
  return { ok: true, restockDelta };
}
