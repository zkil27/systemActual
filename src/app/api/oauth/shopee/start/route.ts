import { NextRequest, NextResponse } from "next/server";
import { getOwnerSession } from "@/lib/auth";
import { buildShopeeAuthUrl, isShopeeConfigured } from "@/lib/connectors/shopee";
import { newOAuthState, setOAuthStateCookie } from "@/lib/oauth-state";

export async function GET(req: NextRequest) {
  if (!(await getOwnerSession())) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  if (!isShopeeConfigured()) {
    return NextResponse.json(
      {
        error:
          "Shopee API keys are not set yet. Add SHOPEE_PARTNER_ID and SHOPEE_PARTNER_KEY in .env after Shopee approves your profile.",
      },
      { status: 400 }
    );
  }
  const state = newOAuthState();
  const res = NextResponse.redirect(buildShopeeAuthUrl(state));
  setOAuthStateCookie(res, state);
  return res;
}
