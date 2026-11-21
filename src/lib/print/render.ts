import { PrintJobKind, type PrintJob } from "@prisma/client";
import { formatManilaDateTime } from "@/lib/time";
import { buildPdf } from "./pdf";
import { prisma } from "@/lib/prisma";
import { pickListPages, type WaveSummary } from "@/lib/waves/plan";
import { fetchBatchLabelPdf, fetchLabelPdf } from "@/lib/shipping/labels";

export class NotPrintableError extends Error {}

export const DIVIDER_PREFIX = "DIVIDER:";

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
      return buildPdf([
        [
          "KYNA OPS",
          "Test print",
          "",
          `Sent: ${formatManilaDateTime(job.createdAt)}`,
          `Printed on: ${printerName || "default printer"}`,
          "",
          "If this fits inside the label,",
          "printing is set up correctly.",
        ],
      ], { fontSize: 14 });
    case PrintJobKind.PICK_LIST: {
      if (job.title.startsWith(DIVIDER_PREFIX)) {
        return buildPdf([buildCourierDividerLines(job.title, job.createdAt)], { fontSize: 13 });
      }
      if (!job.waveId) throw new NotPrintableError("Pick list has no wave.");
      const wave = await prisma.wave.findUnique({ where: { id: job.waveId } });
      if (!wave) throw new NotPrintableError("That wave was deleted.");
      return buildPdf(pickListPages(wave.summaryJson as unknown as WaveSummary, wave.createdAt), { fontSize: 10 });
    }
    case PrintJobKind.LABEL:
      if (job.batchPackageIds && job.batchPackageIds.length > 1) {
        return fetchBatchLabelPdf(job.batchPackageIds);
      }
      if (!job.packageId) throw new NotPrintableError("Label has no parcel.");
      return fetchLabelPdf(job.packageId);
  }
}
