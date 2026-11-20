import { NextRequest, NextResponse } from "next/server";
import { Platform } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getOwnerSession } from "@/lib/auth";
import { exchangeShopeeCode, syncShopeeConnection } from "@/lib/connectors/shopee";
import { checkOAuthState, clearOAuthStateCookie } from "@/lib/oauth-state";

export async function GET(req: NextRequest) {
  if (!(await getOwnerSession())) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  if (!checkOAuthState(req)) {
    return NextResponse.redirect(new URL("/settings?error=shopee_state_mismatch", req.url));
  }
  const code = req.nextUrl.searchParams.get("code");
  const shopId = req.nextUrl.searchParams.get("shop_id");
  if (!code || !shopId) {
    return NextResponse.redirect(new URL("/settings?error=shopee_missing_code", req.url));
  }
  const res = await connectShopee(req, code, shopId);
  clearOAuthStateCookie(res);
  return res;
}

async function connectShopee(req: NextRequest, code: string, shopId: string): Promise<NextResponse> {
  try {
    const tokens = await exchangeShopeeCode(code, shopId);
    const tokenData = {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      tokenExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000),
      tokenErrorAt: null,
      tokenError: null,
      isDemo: false,
    };
    const conn = await prisma.shopConnection.upsert({
      where: { shopId },
      create: {
        platform: Platform.SHOPEE,
        shopId,
        shopName: `Shopee Store #${shopId}`,
        ...tokenData,
      },
      update: tokenData,
    });
    try {
      await syncShopeeConnection(conn.id);
    } catch (err) {
      // Connected fine; the first sync can retry on the next tick.
      console.error("[Shopee first sync error]", err);
    }
    return NextResponse.redirect(new URL("/settings?connected=shopee", req.url));
  } catch (err) {
    console.error("[Shopee OAuth callback error]", err);
    return NextResponse.redirect(new URL("/settings?error=shopee_oauth_failed", req.url));
  }
}
