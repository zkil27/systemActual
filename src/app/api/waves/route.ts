import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { PrintJobKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getOwnerSession } from "@/lib/auth";
import { buildWavePreview } from "@/lib/waves/build";
import type { WaveSummary } from "@/lib/waves/plan";

export const maxDuration = 60;
/** Leave room to save the wave after the live re-check. */
const RECHECK_BUDGET_MS = 40_000;

export async function GET() {
  if (!(await getOwnerSession())) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const waves = await prisma.wave.findMany({ orderBy: { createdAt: "desc" }, take: 5 });
  return NextResponse.json({
    waves: waves.map((w) => ({
      id: w.id,
      status: w.status,
      trigger: w.trigger,
      parcelCount: w.parcelCount,
      createdAt: w.createdAt.toISOString(),
      summary: w.summaryJson as unknown as WaveSummary,
    })),
  });
}

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("preview") }),
  z.object({ action: z.literal("print_pick_list"), waveId: z.string().min(1) }),
]);

export async function POST(req: NextRequest) {
  if (!(await getOwnerSession())) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const parsed = actionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  try {
    if (parsed.data.action === "preview") {
      // Read-only: nothing is shipped or changed on the shops.
      const result = await buildWavePreview({ deadline: Date.now() + RECHECK_BUDGET_MS });
      return NextResponse.json({ ok: true, ...result });
    }

    const wave = await prisma.wave.findUnique({ where: { id: parsed.data.waveId } });
    if (!wave) return NextResponse.json({ error: "Wave not found." }, { status: 404 });
    if (!(await prisma.printDevice.count())) {
      return NextResponse.json({ error: "Set up the printer PC first (Settings → Printer)." }, { status: 400 });
    }
    await prisma.printJob.create({
      data: { kind: PrintJobKind.PICK_LIST, title: `Pick list (${wave.parcelCount} parcels)`, waveId: wave.id },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[waves]", err);
    return NextResponse.json({ error: "Couldn't plan the wave. Try again." }, { status: 500 });
  }
}
