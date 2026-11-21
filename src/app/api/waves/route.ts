import { NextRequest, NextResponse, after } from "next/server";
import { z } from "zod";
import { PrintJobKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getOwnerSession } from "@/lib/auth";
import { buildWavePreview } from "@/lib/waves/build";
import { reprintLabel, retryFailed, retryItem, shipNow, startWave, WaveStartError } from "@/lib/waves/run";
import { nextWaveAt, parseWaveTimes } from "@/lib/waves/schedule";
import { runTick } from "@/lib/worker/tick";
import type { WaveSummary } from "@/lib/waves/plan";

export const maxDuration = 60;
/** Leave room to save the wave after the live re-check. */
const RECHECK_BUDGET_MS = 40_000;

export async function GET() {
  if (!(await getOwnerSession())) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const [waves, writable, settings] = await Promise.all([
    prisma.wave.findMany({ orderBy: { createdAt: "desc" }, take: 5 }),
    prisma.shopConnection.count({ where: { isDemo: false, writesEnabled: true, accessToken: { not: null } } }),
    prisma.appSettings.findUnique({ where: { id: "default" }, select: { waveTimes: true, wavesAutoEnabled: true } }),
  ]);
  const times = parseWaveTimes(settings?.waveTimes ?? "");
  const counts = await prisma.waveItem.groupBy({
    by: ["waveId", "status"],
    where: { waveId: { in: waves.map((w) => w.id) } },
    _count: { _all: true },
  });
  const failed = await prisma.waveItem.findMany({
    where: { waveId: { in: waves.map((w) => w.id) }, status: "FAILED" },
    select: { id: true, waveId: true, error: true, package: { select: { order: { select: { orderSn: true } } } } },
    orderBy: { position: "asc" },
    take: 50,
  });
  return NextResponse.json({
    canShip: writable > 0,
    schedule: {
      auto: Boolean(settings?.wavesAutoEnabled),
      times,
      nextAt: settings?.wavesAutoEnabled ? nextWaveAt(new Date(), times)?.toISOString() ?? null : null,
    },
    waves: waves.map((w) => ({
      id: w.id,
      status: w.status,
      trigger: w.trigger,
      parcelCount: w.parcelCount,
      createdAt: w.createdAt.toISOString(),
      summary: w.summaryJson as unknown as WaveSummary,
      progress: Object.fromEntries(counts.filter((c) => c.waveId === w.id).map((c) => [c.status, c._count._all])),
      failed: failed
        .filter((f) => f.waveId === w.id)
        .map((f) => ({ id: f.id, orderSn: f.package.order.orderSn, error: f.error })),
    })),
  });
}

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("preview") }),
  z.object({ action: z.literal("print_pick_list"), waveId: z.string().min(1) }),
  z.object({ action: z.literal("start"), waveId: z.string().min(1) }),
  z.object({ action: z.literal("ship_now") }),
  z.object({ action: z.literal("retry_item"), itemId: z.string().min(1) }),
  z.object({ action: z.literal("retry_failed"), waveId: z.string().min(1) }),
  z.object({ action: z.literal("reprint"), orderSn: z.string().min(3).max(64) }),
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

    const kick = () => after(() => runTick("manual").catch((err) => console.error("[wave tick]", err)));
    try {
      switch (parsed.data.action) {
        case "start": {
          // Arranges shipment on the shops (can't be undone). Each order is
          // re-checked again just before it's shipped.
          const result = await startWave(parsed.data.waveId);
          kick();
          return NextResponse.json({ ok: true, ...result });
        }
        case "ship_now": {
          const result = await shipNow("MANUAL");
          if (result.shipping) kick();
          return NextResponse.json({ ok: true, ...result });
        }
        case "retry_item":
          await retryItem(parsed.data.itemId);
          kick();
          return NextResponse.json({ ok: true });
        case "retry_failed": {
          const retried = await retryFailed(parsed.data.waveId);
          if (retried) kick();
          return NextResponse.json({ ok: true, retried });
        }
        case "reprint":
          return NextResponse.json({ ok: true, ...(await reprintLabel(parsed.data.orderSn)) });
      }
    } catch (err) {
      if (err instanceof WaveStartError) return NextResponse.json({ error: err.message }, { status: 409 });
      throw err;
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
