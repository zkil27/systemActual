import { NextRequest, NextResponse } from "next/server";
import { PrintJobKind } from "@prisma/client";
import { z } from "zod";
import { getScannerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildHandoverManifestLines, getDailyHandoverSummary } from "@/lib/print/handover";
import { buildPdf } from "@/lib/print/pdf";
import { HANDOVER_PREFIX } from "@/lib/print/render";
import { formatManilaDateTime } from "@/lib/time";

export async function GET() {
  const session = await getScannerSession();
  if (!session) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }
  const couriers = await getDailyHandoverSummary();
  return NextResponse.json({ couriers });
}

const postSchema = z.object({
  courier: z.string().min(1).max(80),
  mode: z.enum(["print", "pdf"]).optional(),
});

export async function POST(req: NextRequest) {
  const session = await getScannerSession();
  if (!session) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }
  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid courier request." }, { status: 400 });
  }

  const courier = parsed.data.courier.trim();
  const mode = parsed.data.mode ?? "print";
  const now = new Date();

  if (mode === "pdf") {
    const all = await getDailyHandoverSummary(now);
    const summary = all.find((c) => c.courier.toLowerCase() === courier.toLowerCase()) ?? {
      courier,
      totalPrinted: 0,
      packedCount: 0,
      handedOverCount: 0,
      awaitingPickupCount: 0,
      cancelledCount: 0,
      trackingNumbers: [],
    };
    const pdf = buildPdf(buildHandoverManifestLines(summary, formatManilaDateTime(now)), { fontSize: 10 });
    const safeName = courier.replace(/[^A-Za-z0-9_-]+/g, "-").toLowerCase();
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="handover-${safeName}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  }

  if (!(await prisma.printDevice.count())) {
    return NextResponse.json({ error: "Set up the printer PC first (Settings → Printer)." }, { status: 400 });
  }

  await prisma.printJob.create({
    data: {
      kind: PrintJobKind.PICK_LIST,
      title: `${HANDOVER_PREFIX}${courier}`,
      createdAt: now,
    },
  });
  return NextResponse.json({ ok: true, courier });
}
