import { NextRequest, NextResponse } from "next/server";
import { isWorkerAuthorized } from "@/lib/worker/auth";
import { runTick } from "@/lib/worker/tick";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!isWorkerAuthorized(req.headers.get("authorization"))) {
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
