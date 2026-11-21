import { Prisma, PrintJobKind, WaveItemStatus, WaveStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { notifyOwnerTelegram } from "@/lib/telegram";
import { formatManilaTime } from "@/lib/time";
import { buildWavePreview } from "./build";
import { dueWaveSlot, parseWaveTimes, retryUpdate } from "./schedule";

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
    select: { platform: true },
  });
  const platforms = [...new Set(writable.map((s) => s.platform))];
  if (!platforms.length) throw new WaveStartError("Turn on \"Update … from Kyna Ops\" for a shop in Settings first.");

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
    where: { waveId, platform: { notIn: platforms } },
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
export async function shipNow(trigger: "MANUAL" | "SCHEDULED", now: Date = new Date()) {
  if (await prisma.wave.count({ where: { status: WaveStatus.RUNNING } })) {
    throw new WaveStartError("A wave is already shipping. Wait for it to finish.");
  }
  const { waveId, summary } = await buildWavePreview({ deadline: Date.now() + 20_000, trigger, now, recheck: false });
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
  const slot = dueWaveSlot(now, parseWaveTimes(settings.waveTimes), settings.lastWaveSlot);
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

/** The PC printed a label: that package is done. */
export async function markLabelPrinted(waveId: string, packageId: string) {
  await prisma.waveItem.updateMany({
    where: { waveId, packageId, status: WaveItemStatus.LABEL_READY },
    data: { status: WaveItemStatus.PRINTED },
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

/** Print one label again (torn, smudged, lost). */
export async function reprintLabel(orderSn: string) {
  const item = await prisma.waveItem.findFirst({
    where: {
      status: { in: [WaveItemStatus.LABEL_READY, WaveItemStatus.PRINTED] },
      package: { order: { orderSn: { equals: orderSn.trim(), mode: "insensitive" } } },
    },
    include: { package: { include: { order: true } } },
    orderBy: { updatedAt: "desc" },
  });
  if (!item) throw new WaveStartError("No printed label for that order number.");
  await prisma.printJob.create({
    data: {
      kind: PrintJobKind.LABEL,
      title: `Reprint · ${item.package.order.orderSn}`,
      packageId: item.packageId,
      // No waveId: a reprint must not change the wave's progress.
    },
  });
  return { orderSn: item.package.order.orderSn };
}
