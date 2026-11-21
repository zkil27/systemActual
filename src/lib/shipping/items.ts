import { PrintJobKind, WaveItemStatus, WaveStatus, type Platform, type Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { formatCourierDividerTitle } from "@/lib/print/render";
import type { WaveSummary } from "@/lib/waves/plan";
import { MAX_ATTEMPTS } from "./shopee-rules";

/**
 * Shared wave-item steps for both shops, so the "maybe shipped" and release
 * rules are the same everywhere:
 *  - release = the package may go into a later wave. Only for packages the
 *    shop clearly did NOT ship.
 *  - anything that may have shipped keeps its lock forever.
 */
export const itemInclude = { package: { include: { order: true } } } satisfies Prisma.WaveItemInclude;
export type Item = Prisma.WaveItemGetPayload<{ include: typeof itemInclude }>;

export const BATCH = 50;
export const later = (ms: number) => new Date(Date.now() + ms);

/** This shop's items in running waves at `status`, due now, in wave/label order. */
export async function dueItems(
  platform: Platform,
  shopId: string,
  status: WaveItemStatus,
  extra: Prisma.WaveItemWhereInput = {}
): Promise<Item[]> {
  return prisma.waveItem.findMany({
    where: {
      status,
      platform,
      activePackageId: { not: null },
      wave: { status: WaveStatus.RUNNING },
      package: { order: { shopConnectionId: shopId } },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
      ...extra,
    },
    include: itemInclude,
    orderBy: [{ wave: { createdAt: "asc" } }, { position: "asc" }],
    take: BATCH,
  });
}

export async function hasRunningItems(platform: Platform, shopId: string) {
  return (
    (await prisma.waveItem.count({
      where: { platform, wave: { status: WaveStatus.RUNNING }, package: { order: { shopConnectionId: shopId } } },
    })) > 0
  );
}

/** Ends items (terminal). */
export async function finish(items: Item[], status: WaveItemStatus, error: string | null, release: boolean) {
  if (!items.length) return;
  await prisma.waveItem.updateMany({
    where: { id: { in: items.map((i) => i.id) } },
    data: { status, error, nextAttemptAt: null, ...(release ? { activePackageId: null } : {}) },
  });
}

/** Not done: try again later, or give up after MAX_ATTEMPTS. */
export async function retry(items: Item[], ms: number, reason: string, giveUp: { release: boolean }) {
  for (const i of items) {
    const attempts = i.attempts + 1;
    await prisma.waveItem.update({
      where: { id: i.id },
      data:
        attempts >= MAX_ATTEMPTS
          ? { status: WaveItemStatus.FAILED, error: reason, attempts, nextAttemptAt: null, ...(giveUp.release ? { activePackageId: null } : {}) }
          : { attempts, error: reason, nextAttemptAt: later(ms) },
    });
  }
}

/** Waiting on something outside our control (re-check, too new): no try is used up. */
export async function wait(items: Item[], ms: number, reason: string) {
  if (!items.length) return;
  await prisma.waveItem.updateMany({
    where: { id: { in: items.map((i) => i.id) } },
    data: { error: reason, nextAttemptAt: later(ms) },
  });
}

export async function advance(items: Item[], status: WaveItemStatus, data: Prisma.WaveItemUpdateManyMutationInput = {}) {
  if (!items.length) return;
  await prisma.waveItem.updateMany({
    where: { id: { in: items.map((i) => i.id) } },
    data: { status, attempts: 0, error: null, nextAttemptAt: null, ...data },
  });
}

/** Mark "we're asking the shop to ship these" BEFORE the call. */
export async function markShipRequested(items: Item[]) {
  await prisma.waveItem.updateMany({
    where: { id: { in: items.map((i) => i.id) } },
    data: { shipRequestedAt: new Date() },
  });
}

/**
 * Inserts a 4×6 courier divider slip right before the first label of each
 * courier/shop group when a wave spans multiple couriers/shops.
 */
async function ensureCourierDivider(
  tx: Prisma.TransactionClient,
  waveId: string,
  groupKey: string,
  position: number,
  now: Date
) {
  const wave = await tx.wave.findUnique({ where: { id: waveId }, select: { summaryJson: true } });
  const summary = wave?.summaryJson as unknown as WaveSummary | undefined;
  if (!summary?.groups || summary.groups.length <= 1) return;
  const group = summary.groups.find((g) => g.key === groupKey);
  if (!group) return;
  const title = formatCourierDividerTitle(group.title, group.count);
  const exists = await tx.printJob.count({
    where: { waveId, kind: PrintJobKind.PICK_LIST, title },
  });
  if (exists > 0) return;
  await tx.printJob.create({
    data: {
      kind: PrintJobKind.PICK_LIST,
      title,
      waveId,
      position: Math.max(0, position),
      createdAt: new Date(now.getTime() - 1),
    },
  });
}

/**
 * Label is ready: move the item to LABEL_READY and queue exactly one print
 * job (the status condition makes a repeat a no-op).
 */
export async function queueLabel(
  item: Item,
  from: WaveItemStatus,
  waveTotals: Map<string, number>,
  now: Date,
  trackingNumber?: string,
  doc?: { url: string; expiresAt: Date }
) {
  if (!waveTotals.has(item.waveId)) {
    waveTotals.set(item.waveId, await prisma.waveItem.count({ where: { waveId: item.waveId } }));
  }
  await prisma.$transaction(async (tx) => {
    const moved = await tx.waveItem.updateMany({
      where: { id: item.id, status: from },
      data: {
        status: WaveItemStatus.LABEL_READY,
        attempts: 0,
        error: null,
        nextAttemptAt: null,
        ...(trackingNumber ? { trackingNumber } : {}),
      },
    });
    if (moved.count !== 1) return;
    if (trackingNumber) await tx.package.update({ where: { id: item.packageId }, data: { trackingNumber } });
    await ensureCourierDivider(tx, item.waveId, item.groupKey, item.position, now);
    await tx.printJob.create({
      data: {
        kind: PrintJobKind.LABEL,
        title: `Label ${item.position + 1}/${waveTotals.get(item.waveId)} · ${item.package.order.orderSn}`,
        packageId: item.packageId,
        waveId: item.waveId,
        position: item.position,
        docUrl: doc?.url ?? null,
        docExpiresAt: doc?.expiresAt ?? null,
        createdAt: now,
      },
    });
  });
}

/**
 * Batches up to 50 ready Shopee labels of the same courier/wave into 1 merged
 * multi-page PrintJob, cutting PDF downloads and SumatraPDF invocations up to 50x.
 */
export async function queueLabelBatch(
  items: Item[],
  from: WaveItemStatus,
  waveTotals: Map<string, number>,
  now: Date
) {
  if (!items.length) return;
  if (items.length === 1) {
    await queueLabel(items[0], from, waveTotals, now);
    return;
  }

  const waveId = items[0].waveId;
  if (!waveTotals.has(waveId)) {
    waveTotals.set(waveId, await prisma.waveItem.count({ where: { waveId } }));
  }
  const total = waveTotals.get(waveId) ?? items.length;

  await prisma.$transaction(async (tx) => {
    const movedItems: Item[] = [];
    for (const item of items) {
      const moved = await tx.waveItem.updateMany({
        where: { id: item.id, status: from },
        data: {
          status: WaveItemStatus.LABEL_READY,
          attempts: 0,
          error: null,
          nextAttemptAt: null,
        },
      });
      if (moved.count === 1) movedItems.push(item);
    }
    if (!movedItems.length) return;

    const first = movedItems[0];
    const last = movedItems[movedItems.length - 1];
    await ensureCourierDivider(tx, waveId, first.groupKey, first.position, now);
    const title =
      movedItems.length === 1
        ? `Label ${first.position + 1}/${total} · ${first.package.order.orderSn}`
        : `Labels ${first.position + 1}–${last.position + 1}/${total} (${movedItems.length} parcels)`;

    await tx.printJob.create({
      data: {
        kind: PrintJobKind.LABEL,
        title,
        packageId: first.packageId,
        batchPackageIds: movedItems.map((i) => i.packageId),
        waveId,
        position: first.position,
        createdAt: now,
      },
    });
  });
}
