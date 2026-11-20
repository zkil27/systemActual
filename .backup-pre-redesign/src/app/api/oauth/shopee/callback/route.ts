import { NextRequest, NextResponse } from "next/server";
import { Platform } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { exchangeShopeeCode, syncShopeeConnection } from "@/lib/connectors/shopee";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const shopId = req.nextUrl.searchParams.get("shop_id");

  if (!code || !shopId) {
    return NextResponse.redirect(new URL("/settings?error=shopee_missing_code", req.url));
  }

  try {
    const tokens = await exchangeShopeeCode(code, shopId);
    const conn = await prisma.shopConnection.upsert({
      where: { shopId },
      create: {
        platform: Platform.SHOPEE,
        shopId,
        shopName: `Shopee Store #${shopId}`,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        tokenExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000),
        isDemo: false,
      },
      update: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        tokenExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000),
        isDemo: false,
      },
    });
    await syncShopeeConnection(conn.id);
    return NextResponse.redirect(new URL("/settings?connected=shopee", req.url));
  } catch (err) {
    console.error("[Shopee OAuth callback error]", err);
    return NextResponse.redirect(new URL("/settings?error=shopee_oauth_failed", req.url));
  }
}
