import { PrintJobKind, WaveItemStatus, WaveStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/** A preview older than this must be planned again before shipping. */
export const PREVIEW_MAX_AGE_MS = 30 * 60_000;

export class WaveStartError extends Error {}

/**
 * Turns a preview into a running wave. Each package is locked to this wave
 * (unique activePackageId) in one SQL statement, so two waves can never ship
 * the same package. Packages of shops whose write switch is off are left out.
 * The pick list is queued first so it prints before any label.
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

  // Only one start can win this.
  const claimed = await prisma.wave.updateMany({
    where: { id: waveId, status: WaveStatus.PREVIEW },
    data: { status: WaveStatus.RUNNING, startedAt: now },
  });
  if (claimed.count !== 1) throw new WaveStartError("This wave already started.");

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

const TERMINAL = [WaveItemStatus.PRINTED, WaveItemStatus.SKIPPED_CANCELLED, WaveItemStatus.FAILED];

/** A running wave is done when every item is printed, skipped or failed. */
export async function finishDoneWaves(now: Date = new Date()) {
  const running = await prisma.wave.findMany({ where: { status: WaveStatus.RUNNING }, select: { id: true } });
  let finished = 0;
  for (const w of running) {
    const open = await prisma.waveItem.count({ where: { waveId: w.id, status: { notIn: TERMINAL } } });
    if (open === 0) {
      finished += (
        await prisma.wave.updateMany({ where: { id: w.id, status: WaveStatus.RUNNING }, data: { status: WaveStatus.DONE, finishedAt: now } })
      ).count;
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
