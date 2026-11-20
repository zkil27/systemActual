import { NextRequest, NextResponse } from "next/server";
import { Platform } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { exchangeTikTokCode } from "@/lib/connectors/tiktok";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  if (!code) {
    return NextResponse.redirect(new URL("/settings?error=tiktok_missing_code", req.url));
  }

  try {
    const tokens = await exchangeTikTokCode(code);
    await prisma.shopConnection.upsert({
      where: { shopId: `tiktok-${tokens.sellerName.toLowerCase().replace(/\W+/g, "-")}` },
      create: {
        platform: Platform.TIKTOK,
        shopId: `tiktok-${tokens.sellerName.toLowerCase().replace(/\W+/g, "-")}`,
        shopName: tokens.sellerName,
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
    return NextResponse.redirect(new URL("/settings?connected=tiktok", req.url));
  } catch (err) {
    console.error("[TikTok OAuth callback error]", err);
    return NextResponse.redirect(new URL("/settings?error=tiktok_oauth_failed", req.url));
  }
}
