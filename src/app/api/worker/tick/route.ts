import { NextRequest, NextResponse } from "next/server";
import { isWorkerAuthorized } from "@/lib/worker/auth";
import { deviceFromAuthHeader } from "@/lib/print/device";
import { runTick, type TickReason } from "@/lib/worker/tick";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

async function handleTick(req: NextRequest, reason: TickReason) {
  const auth = req.headers.get("authorization");
  const authorized =
    isWorkerAuthorized(auth, process.env.WORKER_SECRET) ||
    isWorkerAuthorized(auth, process.env.CRON_SECRET) ||
    Boolean(await deviceFromAuthHeader(auth));
  if (!authorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await runTick(reason);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[worker tick error]", err);
    return NextResponse.json({ error: "Tick failed" }, { status: 500 });
  }
}

/** Called by Vercel free daily cron (8 PM Manila) or external free cron pingers. */
export async function GET(req: NextRequest) {
  return handleTick(req, "schedule");
}

/**
 * Called every minute by the warehouse PC agent (its device token), or by
 * `npm run dev:tick` locally (WORKER_SECRET).
 */
export async function POST(req: NextRequest) {
  return handleTick(req, "agent");
}
