import { NextRequest, NextResponse } from "next/server";
import { isWorkerAuthorized } from "@/lib/worker/auth";
import { deviceFromAuthHeader } from "@/lib/print/device";
import { runTick } from "@/lib/worker/tick";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * Called every minute by the warehouse PC agent (its device token), or by
 * `npm run dev:tick` locally (WORKER_SECRET).
 */
export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!isWorkerAuthorized(auth) && !(await deviceFromAuthHeader(auth))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await runTick("agent");
    return NextResponse.json(result);
  } catch (err) {
    console.error("[worker tick error]", err);
    return NextResponse.json({ error: "Tick failed" }, { status: 500 });
  }
}
