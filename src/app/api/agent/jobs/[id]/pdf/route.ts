import { NextRequest, NextResponse } from "next/server";
import { PrintJobStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { deviceFromAuthHeader } from "@/lib/print/device";
import { NotPrintableError, renderJobPdf } from "@/lib/print/render";
import { withSpan } from "@/lib/otel";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const device = await deviceFromAuthHeader(req.headers.get("authorization"));
  if (!device) return NextResponse.json({ error: "Unknown printer" }, { status: 401 });

  const { id } = await context.params;
  const job = await prisma.printJob.findUnique({ where: { id } });
  // Only the PC holding the job gets its PDF.
  if (!job || job.deviceId !== device.id || job.status !== PrintJobStatus.PRINTING) {
    return NextResponse.json({ error: "Job not claimed by this printer" }, { status: 409 });
  }

  try {
    const pdf = await withSpan("agent.pdf.fetchLabel", () => renderJobPdf(job, device.printerName));
    return new NextResponse(new Uint8Array(pdf), {
      headers: { "Content-Type": "application/pdf", "Cache-Control": "no-store" },
    });
  } catch (err) {
    const status = err instanceof NotPrintableError ? 422 : 502;
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't make the PDF" }, { status });
  }
}
