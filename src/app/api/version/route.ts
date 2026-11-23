import { NextResponse } from "next/server";
import { LATEST_RELEASE_ID, RELEASES } from "@/lib/releases";
import { DEV_BUILD_ID } from "@/lib/update-check";

// Must run on every request so open apps always see the live deploy.
export const dynamic = "force-dynamic";

/** Public: which build is live, plus recent release notes. Polled by <UpdatePrompt />. */
export function GET() {
  return NextResponse.json(
    {
      buildId: process.env.NEXT_PUBLIC_BUILD_ID || DEV_BUILD_ID,
      releaseId: LATEST_RELEASE_ID,
      releases: RELEASES.slice(0, 5),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
