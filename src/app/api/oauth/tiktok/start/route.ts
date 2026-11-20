import { NextRequest, NextResponse } from "next/server";
import { getOwnerSession } from "@/lib/auth";
import { buildTikTokAuthUrl, isTikTokConfigured } from "@/lib/connectors/tiktok";
import { newOAuthState, setOAuthStateCookie } from "@/lib/oauth-state";

export async function GET(req: NextRequest) {
  if (!(await getOwnerSession())) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  if (!isTikTokConfigured()) {
    return NextResponse.json(
      {
        error:
          "TikTok Shop API keys are not set yet. Add TIKTOK_APP_KEY, TIKTOK_APP_SECRET and TIKTOK_SERVICE_ID in .env.",
      },
      { status: 400 }
    );
  }
  const state = newOAuthState();
  const res = NextResponse.redirect(buildTikTokAuthUrl(state));
  setOAuthStateCookie(res, state);
  return res;
}
