import { PrintJobKind, type PrintJob } from "@prisma/client";
import { formatManilaDateTime } from "@/lib/time";
import { buildPdf } from "./pdf";
import { prisma } from "@/lib/prisma";
import { pickListPages, type WaveSummary } from "@/lib/waves/plan";
import { fetchLabelPdf } from "@/lib/shipping/labels";

export class NotPrintableError extends Error {}

/**
 * The PDF for a job, made when the PC asks for it. Nothing is stored:
 * reprints just ask again. Label and pick-list kinds are added with waves
 * and shipping (Tasks 10–12).
 */
export async function renderJobPdf(
  job: Pick<PrintJob, "kind" | "title" | "createdAt" | "waveId" | "packageId">,
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
      if (!job.waveId) throw new NotPrintableError("Pick list has no wave.");
      const wave = await prisma.wave.findUnique({ where: { id: job.waveId } });
      if (!wave) throw new NotPrintableError("That wave was deleted.");
      return buildPdf(pickListPages(wave.summaryJson as unknown as WaveSummary, wave.createdAt), { fontSize: 10 });
    }
    case PrintJobKind.LABEL:
      if (!job.packageId) throw new NotPrintableError("Label has no parcel.");
      return fetchLabelPdf(job.packageId);
  }
}
