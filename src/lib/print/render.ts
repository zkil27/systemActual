import { PrintJobKind, type PrintJob } from "@prisma/client";
import { formatManilaDateTime } from "@/lib/time";
import { buildPdf } from "./pdf";

export class NotPrintableError extends Error {}

/**
 * The PDF for a job, made when the PC asks for it. Nothing is stored:
 * reprints just ask again. Label and pick-list kinds are added with waves
 * and shipping (Tasks 10–12).
 */
export async function renderJobPdf(job: Pick<PrintJob, "kind" | "title" | "createdAt">, printerName?: string | null): Promise<Buffer> {
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
    case PrintJobKind.LABEL:
    case PrintJobKind.PICK_LIST:
      throw new NotPrintableError(`${job.kind} printing isn't available yet.`);
  }
}
