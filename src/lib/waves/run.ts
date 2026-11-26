import { Platform, Prisma, PrintJobKind, WaveItemStatus, WaveStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { notifyOwnerTelegram } from "@/lib/telegram";
import { isOrderCancelledForPacking } from "@/lib/shipping/outbound";
import { SHIP_BATCH } from "@/lib/shipping/shopee-rules";
import { formatManilaTime } from "@/lib/time";
import { buildWavePreview } from "./build";
import { planWave, summarizeWave, type WaveCandidate, type WavePieceMode, type WaveSummary } from "./plan";
import { dueWaveSlot, isContinuousWave, parseWaveTimes, retryUpdate } from "./schedule";

/** A preview older than this must be planned again before shipping. */
export const PREVIEW_MAX_AGE_MS = 30 * 60_000;
/** Postgres advisory lock id that serializes wave starts. */
const WAVE_START_LOCK = 4711001;

export class WaveStartError extends Error {}

/**
 * Turns a preview into a running wave.
 *  - Only one wave runs at a time (starts are serialized by an advisory lock).
 *  - Each package is locked to this wave (unique activePackageId) in one SQL
 *    statement, so two waves can never ship the same package.
 *  - Packages of shops whose write switch is off are left out.
 *  - The pick list is queued first so it prints before any label.
 */
export async function startWave(waveId: string, now: Date = new Date()) {
  const wave = await prisma.wave.findUnique({ where: { id: waveId } });
  if (!wave || wave.status !== WaveStatus.PREVIEW) throw new WaveStartError("This wave already started or was removed.");
  if (now.getTime() - wave.createdAt.getTime() > PREVIEW_MAX_AGE_MS) {
    throw new WaveStartError("This preview is more than 30 minutes old. Preview again first.");
  }
  const writable = await prisma.shopConnection.findMany({
    where: { isDemo: false, writesEnabled: true, accessToken: { not: null } },
    select: { id: true },
  });
  const writableShopIds = writable.map((s) => s.id);
  if (!writableShopIds.length) throw new WaveStartError("Turn on \"Update … from Kyna Ops\" for a shop in Settings first.");

  const claim = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 AS ok FROM (SELECT pg_advisory_xact_lock(${WAVE_START_LOCK})) AS l`;
    if (await tx.wave.count({ where: { status: WaveStatus.RUNNING } })) return "running" as const;
    const r = await tx.wave.updateMany({
      where: { id: waveId, status: WaveStatus.PREVIEW },
      data: { status: WaveStatus.RUNNING, startedAt: now },
    });
    return r.count === 1 ? ("ok" as const) : ("gone" as const);
  });
  if (claim === "running") throw new WaveStartError("A wave is already shipping. Wait for it to finish.");
  if (claim === "gone") throw new WaveStartError("This wave already started.");

  await prisma.waveItem.updateMany({
    where: { waveId, package: { order: { shopConnectionId: { notIn: writableShopIds } } } },
    data: { status: WaveItemStatus.FAILED, error: "Updates from Kyna Ops are off for this shop." },
  });

  // Lock each package to this wave unless another wave already holds it.
  await prisma.$executeRaw`
    UPDATE "WaveItem" AS w
    SET "activePackageId" = w."packageId"
    WHERE w."waveId" = ${waveId}
      AND w."status" = 'READY'
      AND NOT EXISTS (SELECT 1 FROM "WaveItem" o WHERE o."activePackageId" = w."packageId")`;

  await prisma.waveItem.updateMany({
    where: { waveId, status: WaveItemStatus.READY, activePackageId: null },
    data: { status: WaveItemStatus.FAILED, error: "Already in another wave." },
  });

  const shipping = await prisma.waveItem.count({ where: { waveId, activePackageId: { not: null } } });
  if (shipping > 0) {
    await prisma.printJob.create({
      data: { kind: PrintJobKind.PICK_LIST, title: `Pick list (${wave.parcelCount} parcels)`, waveId, createdAt: now },
    });
  }
  return { shipping };
}

/** Plan and start a wave in one go (Ship now button, and scheduled waves). */
export async function shipNow(
  trigger: "MANUAL" | "SCHEDULED",
  now: Date = new Date(),
  filters?: { platform?: Platform; courier?: string; pieceMode?: WavePieceMode; includeNewOrders?: boolean }
) {
  if (await prisma.wave.count({ where: { status: WaveStatus.RUNNING } })) {
    throw new WaveStartError("A wave is already shipping. Wait for it to finish.");
  }
  const { waveId, summary } = await buildWavePreview({
    deadline: Date.now() + 20_000,
    trigger,
    now,
    recheck: false,
    platform: filters?.platform,
    courier: filters?.courier,
    pieceMode: filters?.pieceMode,
    includeNewOrders: filters?.includeNewOrders,
  });
  if (summary.total === 0) {
    await prisma.wave.delete({ where: { id: waveId } });
    return { waveId: null, shipping: 0, summary };
  }
  const { shipping } = await startWave(waveId, now);
  return { waveId, shipping, summary };
}

/**
 * Called by every tick. Starts the wave for the current time slot once, if
 * automatic waves are on, a shop can be updated, and no wave is running.
 * A slot blocked by a running wave starts when that wave finishes (within 2 h).
 */
export async function maybeStartScheduledWave(now: Date = new Date()) {
  const settings = await prisma.appSettings.findUnique({ where: { id: "default" } });
  if (!settings?.wavesAutoEnabled) return null;
  const continuous = isContinuousWave(settings.waveTimes);
  const slot = dueWaveSlot(now, parseWaveTimes(settings.waveTimes), settings.lastWaveSlot, continuous);
  if (!slot) return null;
  if (await prisma.wave.count({ where: { status: WaveStatus.RUNNING } })) return null;
  if (!(await prisma.shopConnection.count({ where: { isDemo: false, writesEnabled: true, accessToken: { not: null } } }))) {
    return null;
  }
  // Claim the slot first, so two ticks can't both start it.
  const claimed = await prisma.appSettings.updateMany({
    where: { id: "default", OR: [{ lastWaveSlot: null }, { lastWaveSlot: { not: slot } }] },
    data: { lastWaveSlot: slot },
  });
  if (claimed.count !== 1) return null;
  try {
    return await shipNow("SCHEDULED", now);
  } catch (err) {
    if (err instanceof WaveStartError) return null;
    throw err;
  }
}

const TERMINAL: WaveItemStatus[] = [WaveItemStatus.PRINTED, WaveItemStatus.SKIPPED_CANCELLED, WaveItemStatus.FAILED];

export function waveDoneMessage(
  wave: { trigger: string; startedAt: Date | null },
  counts: Partial<Record<WaveItemStatus, number>>
): string {
  const printed = counts.PRINTED ?? 0;
  const failed = counts.FAILED ?? 0;
  const cancelled = counts.SKIPPED_CANCELLED ?? 0;
  const lines = [
    `WAVE DONE (${wave.trigger === "SCHEDULED" ? "scheduled" : "started"} ${formatManilaTime(wave.startedAt)})`,
    `• Printed: ${printed}`,
    ...(cancelled ? [`• Cancelled before shipping: ${cancelled}`] : []),
    ...(failed ? [`• NEED ATTENTION: ${failed}. Open Waves to retry or see why.`] : []),
  ];
  return lines.join("\n");
}

/** A running wave is done when every item is printed, skipped or failed. Tells the owner on Telegram. */
export async function finishDoneWaves(now: Date = new Date()) {
  const running = await prisma.wave.findMany({ where: { status: WaveStatus.RUNNING } });
  let finished = 0;
  for (const w of running) {
    const open = await prisma.waveItem.count({ where: { waveId: w.id, status: { notIn: TERMINAL } } });
    if (open > 0) continue;
    const done = await prisma.wave.updateMany({
      where: { id: w.id, status: WaveStatus.RUNNING },
      data: { status: WaveStatus.DONE, finishedAt: now },
    });
    if (done.count !== 1) continue;
    finished++;
    const counts = await prisma.waveItem.groupBy({ by: ["status"], where: { waveId: w.id }, _count: { _all: true } });
    try {
      await notifyOwnerTelegram(waveDoneMessage(w, Object.fromEntries(counts.map((c) => [c.status, c._count._all]))));
    } catch (err) {
      console.error("[wave done telegram]", err);
    }
  }
  return finished;
}

/** The PC printed one or more labels (single or batched): those packages are done. */
export async function markLabelPrinted(waveId: string, packageIds: string | string[]) {
  const ids = Array.isArray(packageIds) ? packageIds : [packageIds];
  if (!ids.length) return;
  await prisma.waveItem.updateMany({
    where: { waveId, packageId: { in: ids }, status: WaveItemStatus.LABEL_READY },
    data: { status: WaveItemStatus.PRINTED },
  });
}

/**
 * The PC failed to print (or the owner cleared the print queue): move LABEL_READY
 * items to FAILED so the wave can finish instead of deadlocking forever. Keeps
 * `activePackageId` so Retry won't double-ship already-arranged orders.
 */
export async function markLabelFailed(waveId: string, packageIds: string | string[], error: string) {
  const ids = Array.isArray(packageIds) ? packageIds : [packageIds];
  if (!ids.length) return;
  await prisma.waveItem.updateMany({
    where: { waveId, packageId: { in: ids }, status: WaveItemStatus.LABEL_READY },
    data: { status: WaveItemStatus.FAILED, error: error.slice(0, 500) },
  });
}

/**
 * Stops a preview or running wave so future waves aren't blocked.
 * - Items not yet sent to the shop (`READY` + `shipRequestedAt: null`) are released cleanly.
 * - Items that may already have shipped keep `activePackageId` and move to `FAILED` so they
 *   can still be retried without double-shipping.
 * - Queued/printing print jobs for this wave are deleted.
 */
export async function cancelWave(waveId: string, now: Date = new Date()) {
  const wave = await prisma.wave.findUnique({ where: { id: waveId } });
  if (!wave) throw new WaveStartError("Wave not found.");
  if (wave.status !== WaveStatus.RUNNING && wave.status !== WaveStatus.PREVIEW) {
    throw new WaveStartError("Only a preview or running wave can be stopped.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.wave.update({
      where: { id: waveId },
      data: { status: WaveStatus.CANCELLED, finishedAt: now },
    });

    if (wave.status === WaveStatus.RUNNING) {
      await tx.waveItem.updateMany({
        where: { waveId, status: WaveItemStatus.READY, shipRequestedAt: null },
        data: { status: WaveItemStatus.SKIPPED_CANCELLED, error: "Wave stopped", activePackageId: null },
      });
      await tx.waveItem.updateMany({
        where: {
          waveId,
          status: {
            in: [
              WaveItemStatus.READY,
              WaveItemStatus.SHIPPING_ARRANGED,
              WaveItemStatus.TRACKING_ASSIGNED,
              WaveItemStatus.LABEL_READY,
            ],
          },
        },
        data: { status: WaveItemStatus.FAILED, error: "Wave stopped before printing" },
      });
      await tx.printJob.deleteMany({
        where: { waveId, status: { in: ["QUEUED", "PRINTING"] } },
      });
    }
  });
}

/** Owner taps Retry on a failed parcel. Its wave runs again until it's done. */
export async function retryItem(itemId: string) {
  const item = await prisma.waveItem.findUnique({ where: { id: itemId }, include: { wave: true } });
  if (!item || item.status !== WaveItemStatus.FAILED) throw new WaveStartError("Only parcels that need attention can be retried.");
  if (item.wave.status === WaveStatus.PREVIEW) throw new WaveStartError("This wave hasn't started.");
  try {
    await prisma.$transaction([
      prisma.waveItem.update({ where: { id: item.id }, data: retryUpdate(item) }),
      prisma.wave.update({ where: { id: item.waveId }, data: { status: WaveStatus.RUNNING, finishedAt: null } }),
    ]);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new WaveStartError("This parcel is in another wave now.");
    }
    throw err;
  }
}

export async function retryFailed(waveId: string) {
  const failed = await prisma.waveItem.findMany({ where: { waveId, status: WaveItemStatus.FAILED }, select: { id: true } });
  let retried = 0;
  for (const f of failed) {
    try {
      await retryItem(f.id);
      retried++;
    } catch (err) {
      if (!(err instanceof WaveStartError)) throw err;
    }
  }
  return retried;
}

/** Print one label again (torn, smudged, lost). Refuses cancelled orders. */
export async function reprintLabel(orderSn: string, opts?: { force?: boolean }) {
  const item = await prisma.waveItem.findFirst({
    where: {
      status: { in: [WaveItemStatus.LABEL_READY, WaveItemStatus.PRINTED] },
      package: { order: { orderSn: { equals: orderSn.trim(), mode: "insensitive" } } },
    },
    include: { package: { include: { order: true } } },
    orderBy: { updatedAt: "desc" },
  });
  if (!item) throw new WaveStartError("No printed label for that order number.");
  const ord = item.package.order;
  const upperStatus = ord.status.trim().toUpperCase();
  if (!opts?.force && (ord.cancelRequested || upperStatus === "CANCELLED" || upperStatus === "IN_CANCEL")) {
    throw new WaveStartError(`Order ${ord.orderSn} was cancelled — don't ship it.`);
  }
  await prisma.printJob.create({
    data: {
      kind: PrintJobKind.LABEL,
      title: `Reprint · ${ord.orderSn}`,
      packageId: item.packageId,
      // No waveId: a reprint must not change the wave's progress.
    },
  });
  return { orderSn: ord.orderSn };
}

/** Removes a single parcel from a PREVIEW wave before shipping and updates summary/positions. */
export async function excludeWaveParcel(waveId: string, waveItemId: string) {
  const wave = await prisma.wave.findUnique({ where: { id: waveId } });
  if (!wave || wave.status !== WaveStatus.PREVIEW) {
    throw new WaveStartError("Parcels can only be left out before a wave starts.");
  }
  const target = await prisma.waveItem.findFirst({
    where: { id: waveItemId, waveId },
    select: { id: true },
  });
  if (!target) throw new WaveStartError("Parcel not found in this preview.");

  await prisma.$transaction(async (tx) => {
    await tx.waveItem.delete({ where: { id: target.id } });
    const remaining = await tx.waveItem.findMany({
      where: { waveId },
      orderBy: { position: "asc" },
      include: { package: { include: { order: { include: { lines: true } } } } },
    });

    const shopIds = [...new Set(remaining.map((r) => r.package.order.shopConnectionId))];
    const listingIds = [...new Set(remaining.flatMap((r) => r.package.order.lines.map((l) => l.listingId)))];
    const listings =
      shopIds.length && listingIds.length
        ? await tx.listingVariant.findMany({
            where: { shopConnectionId: { in: shopIds }, listingId: { in: listingIds } },
            include: { garmentVariant: { include: { garment: { select: { name: true } } } } },
          })
        : [];
    const listingByKey = new Map(listings.map((l) => [`${l.shopConnectionId}:${l.listingId}:${l.variationId}`, l]));

    const candidates: WaveCandidate[] = remaining.map((wi) => {
      const o = wi.package.order;
      return {
        packageId: wi.packageId,
        orderId: wi.orderId,
        orderSn: o.orderSn,
        platform: wi.platform,
        carrier: wi.package.carrier,
        channelId: wi.package.channelId,
        createdAt: o.platformCreatedAt,
        lines: o.lines.map((l) => {
          const lv = listingByKey.get(`${o.shopConnectionId}:${l.listingId}:${l.variationId}`);
          const gv = lv?.garmentVariant;
          return {
            key: gv?.id ?? `${o.shopConnectionId}:${l.listingId}:${l.variationId}`,
            label: gv ? `${gv.garment.name} - ${gv.label}` : `${l.name}${l.variationName ? ` - ${l.variationName}` : ""}`,
            quantity: l.quantity,
          };
        }),
      };
    });

    const planned = planWave(candidates);
    const posByPkg = new Map(planned.map((p) => [p.packageId, p.position]));
    const posUpdates: Array<{ id: string; pos: number }> = [];
    for (const wi of remaining) {
      const pos = posByPkg.get(wi.packageId);
      if (pos !== undefined && pos !== wi.position) {
        posUpdates.push({ id: wi.id, pos });
      }
    }
    if (posUpdates.length > 0) {
      const values = Prisma.join(
        posUpdates.map((u) => Prisma.sql`(${u.id}, ${u.pos}::integer)`)
      );
      await tx.$executeRaw`
        UPDATE "WaveItem" AS w
        SET "position" = v."pos", "updatedAt" = NOW()
        FROM (VALUES ${values}) AS v("id", "pos")
        WHERE w."id" = v."id" AND w."waveId" = ${waveId}
      `;
    }

    const prevSummary = wave.summaryJson as unknown as WaveSummary;
    const nextSummary: WaveSummary = {
      ...summarizeWave(planned, prevSummary.skipped),
      pieceMode: prevSummary.pieceMode,
      includeNewOrders: prevSummary.includeNewOrders,
    };
    await tx.wave.update({
      where: { id: waveId },
      data: {
        parcelCount: planned.length,
        summaryJson: nextSummary as unknown as Prisma.InputJsonValue,
      },
    });
  });
}

/**
 * Reprints a range of parcel positions (#fromPos–#toPos, 1-based) or a whole
 * courier group after a thermal printer jam or missing roll section.
 */
export async function reprintWaveRange(opts: {
  waveId: string;
  fromPos: number;
  toPos: number;
  groupKey?: string;
}): Promise<{ queuedParcels: number; queuedJobs: number }> {
  const from = Math.max(1, Math.floor(Math.min(opts.fromPos, opts.toPos)));
  const to = Math.max(from, Math.floor(Math.max(opts.fromPos, opts.toPos)));

  if (!(await prisma.printDevice.count())) {
    throw new WaveStartError("Set up the printer PC first (Settings → Printer).");
  }

  const items = await prisma.waveItem.findMany({
    where: {
      waveId: opts.waveId,
      status: { in: [WaveItemStatus.LABEL_READY, WaveItemStatus.PRINTED] },
      position: { gte: from - 1, lte: to - 1 },
      ...(opts.groupKey ? { groupKey: opts.groupKey } : {}),
    },
    include: { package: { include: { order: true } } },
    orderBy: { position: "asc" },
  });

  const printable = items.filter((it) => !isOrderCancelledForPacking(it.package.order));
  if (!printable.length) {
    throw new WaveStartError("No printed labels found in that range.");
  }

  const jobsToCreate: Prisma.PrintJobCreateManyInput[] = [];
  let idx = 0;
  while (idx < printable.length) {
    const first = printable[idx];
    if (first.platform === Platform.SHOPEE) {
      const batch = [first];
      idx++;
      while (
        idx < printable.length &&
        batch.length < SHIP_BATCH &&
        printable[idx].platform === Platform.SHOPEE &&
        printable[idx].groupKey === first.groupKey
      ) {
        batch.push(printable[idx]);
        idx++;
      }
      const last = batch[batch.length - 1];
      jobsToCreate.push({
        kind: PrintJobKind.LABEL,
        title:
          batch.length === 1
            ? `Reprint #${first.position + 1} · ${first.package.order.orderSn}`
            : `Reprint #${first.position + 1}–#${last.position + 1} (${batch.length} parcels)`,
        packageId: first.packageId,
        batchPackageIds: batch.length > 1 ? batch.map((b) => b.packageId) : [],
        position: first.position,
      });
    } else {
      jobsToCreate.push({
        kind: PrintJobKind.LABEL,
        title: `Reprint #${first.position + 1} · ${first.package.order.orderSn}`,
        packageId: first.packageId,
        position: first.position,
      });
      idx++;
    }
  }

  await prisma.printJob.createMany({ data: jobsToCreate });
  return { queuedParcels: printable.length, queuedJobs: jobsToCreate.length };
}
