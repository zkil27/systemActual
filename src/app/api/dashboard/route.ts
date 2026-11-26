import { NextRequest, NextResponse, after } from "next/server";
import { getOwnerSession } from "@/lib/auth";
import { getDailyTruthReport } from "@/lib/analytics/daily-returns";
import { getSyncStatus } from "@/lib/sync/status";
import { runTick } from "@/lib/worker/tick";

export const maxDuration = 120;

export async function GET(req: NextRequest) {
  if (!(await getOwnerSession())) {
    return NextResponse.json({ error: "Owner sign-in required." }, { status: 401 });
  }
  try {
    const sp = req.nextUrl.searchParams;
    const rangeParam = sp.get("range");
    const range: "today" | "yesterday" | "7days" =
      rangeParam === "yesterday" || rangeParam === "7days" ? rangeParam : "today";
    const date = sp.get("date") || undefined;

    const [report, syncStatus] = await Promise.all([
      getDailyTruthReport({ range, date }),
      getSyncStatus(),
    ]);

    // Opportunistic sync: when the owner opens the dashboard and a live shop is
    // stale (>3m) or catching up on a backlog, kick off a non-blocking tick.
    const needsBgSync = !syncStatus.syncing && (syncStatus.stale || syncStatus.catchingUp);
    if (needsBgSync) {
      after(() => runTick("manual").catch((err) => console.error("[dashboard bg tick]", err)));
    }

    return NextResponse.json(
      { ...report, syncing: syncStatus.syncing || needsBgSync },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("[Dashboard API error]", err);
    return NextResponse.json(
      { error: "Could not load today's return report." },
      { status: 500 }
    );
  }
}
