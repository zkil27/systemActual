import { NextRequest, NextResponse, after } from "next/server";
import { getOwnerSession } from "@/lib/auth";
import { getSyncStatus } from "@/lib/sync/status";
import { runTick } from "@/lib/worker/tick";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

/**
 * Lightweight change-stamp endpoint for client auto-refresh.
 * Clients only re-fetch heavy page payloads when `version` changes or `syncing` completes.
 */
export async function GET(req: NextRequest) {
  if (!(await getOwnerSession())) {
    return NextResponse.json({ error: "Owner sign-in required." }, { status: 401 });
  }
  try {
    const status = await getSyncStatus();
    const shouldTrigger =
      req.nextUrl.searchParams.get("trigger") === "1" &&
      !status.syncing &&
      (status.stale || status.catchingUp);

    if (shouldTrigger) {
      after(() => runTick("manual").catch((err) => console.error("[sync status bg tick]", err)));
    }

    return NextResponse.json(
      shouldTrigger ? { ...status, syncing: true } : status,
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("[Sync status API error]", err);
    return NextResponse.json({ error: "Could not check sync status." }, { status: 500 });
  }
}
