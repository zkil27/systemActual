import { PrintJobKind, WaveItemStatus, type PrintJob } from "@prisma/client";
import { formatManilaDateTime } from "@/lib/time";
import { buildPdf } from "./pdf";
import { prisma } from "@/lib/prisma";
import { pickListPages, type WaveSummary } from "@/lib/waves/plan";
import { fetchBatchLabelPdf, fetchLabelPdf } from "@/lib/shipping/labels";
import { isOrderCancelledForPacking } from "@/lib/shipping/outbound";
import { buildHandoverManifestLines, getDailyHandoverSummary } from "./handover";
import { assembleWaybillSources, composeWaybills, type WaybillParcel } from "./waybill";
import { buildTestLabelPdf } from "./test-label";

export class NotPrintableError extends Error {}

export const DIVIDER_PREFIX = "DIVIDER:";
export const HANDOVER_PREFIX = "HANDOVER:";

/** Encodes a courier divider slip title inside PrintJob.title (no schema change). */
export function formatCourierDividerTitle(groupTitle: string, count: number): string {
  return `${DIVIDER_PREFIX}${groupTitle}|${count}`;
}

/** Bold 4×6 thermal divider sticker printed between courier stacks in a wave. */
export function buildCourierDividerLines(title: string, createdAt: Date): string[] {
  const payload = title.startsWith(DIVIDER_PREFIX) ? title.slice(DIVIDER_PREFIX.length) : title;
  const [rawGroup, rawCount] = payload.split("|");
  const groupTitle = (rawGroup || "COURIER GROUP").trim().toUpperCase();
  const count = Number(rawCount);
  const countLine = Number.isFinite(count) && count > 0 ? `${count} PARCELS IN THIS STACK` : "";

  return [
    "============================",
    "   COURIER SACK DIVIDER",
    "============================",
    "",
    "START STACK:",
    groupTitle,
    "",
    ...(countLine ? [countLine, ""] : []),
    "Separate into its own sack.",
    `Wave: ${formatManilaDateTime(createdAt)}`,
    "============================",
  ];
}

/**
 * The PDF for a job, made when the PC asks for it. Nothing is stored:
 * reprints just ask again. Label and pick-list kinds are added with waves
 * and shipping (Tasks 10–12).
 */
export async function renderJobPdf(
  job: Pick<PrintJob, "kind" | "title" | "createdAt" | "waveId" | "packageId"> & {
    batchPackageIds?: string[];
  },
  printerName?: string | null
): Promise<Buffer> {
  switch (job.kind) {
    case PrintJobKind.TEST:
      // TikTok-label-sized check page: shows cut-off edges and scaling on one sticker.
      return buildTestLabelPdf({ sentAt: formatManilaDateTime(job.createdAt), printerName });
    case PrintJobKind.PICK_LIST: {
      if (job.title.startsWith(DIVIDER_PREFIX)) {
        return buildPdf([buildCourierDividerLines(job.title, job.createdAt)], { fontSize: 13 });
      }
      if (job.title.startsWith(HANDOVER_PREFIX)) {
        const courier = job.title.slice(HANDOVER_PREFIX.length).trim();
        const all = await getDailyHandoverSummary(job.createdAt);
        const match = all.find((c) => c.courier.toLowerCase() === courier.toLowerCase()) ?? {
          courier,
          totalPrinted: 0,
          packedCount: 0,
          handedOverCount: 0,
          awaitingPickupCount: 0,
          cancelledCount: 0,
          trackingNumbers: [],
        };
        return buildPdf(buildHandoverManifestLines(match, formatManilaDateTime(job.createdAt)), { fontSize: 10 });
      }
      if (!job.waveId) throw new NotPrintableError("Pick list has no wave.");
      const wave = await prisma.wave.findUnique({ where: { id: job.waveId } });
      if (!wave) throw new NotPrintableError("That wave was deleted.");
      return buildPdf(pickListPages(wave.summaryJson as unknown as WaveSummary, wave.createdAt), { fontSize: 10 });
    }
    case PrintJobKind.LABEL: {
      const rawPackageIds =
        job.batchPackageIds && job.batchPackageIds.length > 1
          ? job.batchPackageIds
          : job.packageId
            ? [job.packageId]
            : [];
      if (!rawPackageIds.length) throw new NotPrintableError("Label has no parcel.");

      let packageIds = rawPackageIds;
      // For batched Shopee wave jobs, exclude any parcel cancelled after queueing so we never waste stickers.
      if (rawPackageIds.length > 1 && job.waveId) {
        const pkgs = await prisma.package.findMany({
          where: { id: { in: rawPackageIds } },
          select: { id: true, order: { select: { status: true, cancelRequested: true } } },
        });
        const cancelledIds = new Set(
          pkgs.filter((p) => isOrderCancelledForPacking(p.order)).map((p) => p.id)
        );
        if (cancelledIds.size > 0) {
          await prisma.waveItem.updateMany({
            where: { waveId: job.waveId, packageId: { in: [...cancelledIds] }, status: WaveItemStatus.LABEL_READY },
            data: { status: WaveItemStatus.SKIPPED_CANCELLED, error: "Cancelled before printing", activePackageId: null },
          });
          packageIds = rawPackageIds.filter((id) => !cancelledIds.has(id));
          if (!packageIds.length) {
            throw new NotPrintableError("All parcels in this batch were cancelled before printing.");
          }
        }
      }

      const platformPdf =
        packageIds.length > 1 ? await fetchBatchLabelPdf(packageIds) : await fetchLabelPdf(packageIds[0]);
      return withCustomWaybill(packageIds, platformPdf);
    }
  }
}

/**
 * When "one sticker per parcel" is on: each parcel's shop label page 1,
 * untouched, plus our packing slip if the label ran onto more pages. Any
 * problem prints the shop's PDF as it came, so this never stops shipping.
 */
async function withCustomWaybill(packageIds: string[], platformPdf: Buffer): Promise<Buffer> {
  const settings = await prisma.appSettings.findUnique({
    where: { id: "default" },
    select: { customWaybillEnabled: true },
  });
  if (!settings?.customWaybillEnabled) return platformPdf;

  try {
    const pkgs = await prisma.package.findMany({
      where: { id: { in: packageIds } },
      select: {
        id: true,
        trackingNumber: true,
        order: {
          select: {
            orderSn: true,
            lines: { select: { name: true, variationName: true, quantity: true } },
            _count: { select: { packages: true } },
          },
        },
      },
    });
    const byId = new Map(pkgs.map((p) => [p.id, p]));
    const ordered = packageIds.map((id) => byId.get(id));
    if (ordered.some((p) => !p)) throw new Error("Some parcels in this label job are gone.");

    const parcels: WaybillParcel[] = ordered.map((p) => ({
      orderSn: p!.order.orderSn,
      trackingNumber: p!.trackingNumber,
      lines: p!.order.lines,
      parcelsInOrder: p!.order._count.packages,
    }));
    const sources = await assembleWaybillSources(platformPdf, parcels, (i) => fetchLabelPdf(packageIds[i]));
    // Nothing ran over: send the shop's file byte-for-byte, not a re-saved copy.
    if (!sources.some((s) => s.overflowed)) return platformPdf;
    return await composeWaybills(sources);
  } catch (err) {
    console.error("[Custom waybill] falling back to the shop's label", err);
    return platformPdf;
  }
}
