import { NextResponse } from "next/server";
import { getOwnerSession } from "@/lib/auth";
import { getHealthSummary } from "@/lib/health";

/** Owner-only system health: shop sync lag, worker, printer PC, backups, failed jobs. */
export async function GET() {
  if (!(await getOwnerSession())) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  try {
    return NextResponse.json(await getHealthSummary(), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[health]", err);
    return NextResponse.json({ error: "Could not check health." }, { status: 500 });
  }
}
