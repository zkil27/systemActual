import { NextResponse } from "next/server";
import { LATEST_RELEASE_ID, RELEASES } from "@/lib/releases";
import { DEV_BUILD_ID } from "@/lib/update-check";
import { getOpsSwitches, type OpsSwitches } from "@/lib/maintenance";

// Must run on every request so open apps always see the live deploy.
export const dynamic = "force-dynamic";

/** Every open app polls this, so the maintenance switch is read at most every 30 s per server instance. */
const MAINTENANCE_CACHE_MS = 30_000;
let cached: { at: number; value: OpsSwitches["maintenance"] } | null = null;

async function maintenanceNotice(): Promise<OpsSwitches["maintenance"]> {
  const now = Date.now();
  if (cached && now - cached.at < MAINTENANCE_CACHE_MS) return cached.value;
  const value = (await getOpsSwitches(new Date(now))).maintenance;
  cached = { at: now, value };
  return value;
}

/** Public: which build is live, recent release notes, and any maintenance notice. Polled by <UpdatePrompt />. */
export async function GET() {
  return NextResponse.json(
    {
      buildId: process.env.NEXT_PUBLIC_BUILD_ID || DEV_BUILD_ID,
      releaseId: LATEST_RELEASE_ID,
      releases: RELEASES.slice(0, 5),
      maintenance: await maintenanceNotice(),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
