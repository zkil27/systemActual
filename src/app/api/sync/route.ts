import { NextResponse } from "next/server";
import { runTick } from "@/lib/worker/tick";

export const maxDuration = 60;

/** The owner's "Sync now" button. Runs the same tick as the PC agent and webhooks. */
export async function POST() {
  try {
    const result = await runTick("manual");
    const totalSynced = result.shops.reduce(
      (n, s) => n + s.ordersSaved + s.returnsSaved + s.failedDeliveriesFound + s.courierReturned,
      0
    );
    return NextResponse.json({
      ok: true,
      // A tick was already running; it picks up this request as an extra pass.
      alreadyRunning: !result.ran,
      totalSynced,
      syncedAt: new Date().toISOString(),
      results: result.shops,
    });
  } catch (err) {
    console.error("[Manual sync error]", err);
    return NextResponse.json({ error: "Sync failed. Please try again." }, { status: 500 });
  }
}
