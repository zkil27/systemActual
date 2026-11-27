import { NextRequest, NextResponse, after } from "next/server";
import { Platform } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getOwnerSession } from "@/lib/auth";
import { encryptSecret } from "@/lib/crypto";
import {
  exchangeShopeeCode,
  exchangeShopeeMainAccountCode,
  getShopeeShopInfo,
  resolveShopeeMainAccountShop,
} from "@/lib/connectors/shopee";
import { checkOAuthState, clearOAuthStateCookie } from "@/lib/oauth-state";
import { runTick } from "@/lib/worker/tick";

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!(await getOwnerSession())) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  if (!checkOAuthState(req)) {
    return NextResponse.redirect(new URL("/settings?error=shopee_state_mismatch", req.url));
  }
  const code = req.nextUrl.searchParams.get("code");
  const shopId = req.nextUrl.searchParams.get("shop_id");
  const mainAccountId = req.nextUrl.searchParams.get("main_account_id");
  if (!code || (!shopId && !mainAccountId)) {
    return NextResponse.redirect(new URL("/settings?error=shopee_missing_code", req.url));
  }
  const res = await connectShopee(req, { code, shopId, mainAccountId });
  clearOAuthStateCookie(res);
  return res;
}

async function connectShopee(
  req: NextRequest,
  params: { code: string; shopId: string | null; mainAccountId: string | null }
): Promise<NextResponse> {
  try {
    let targetShopId: string;
    let shopName: string;
    let tokens: { accessToken: string; refreshToken: string; expiresIn: number };

    if (params.shopId) {
      targetShopId = params.shopId;
      tokens = await exchangeShopeeCode(params.code, targetShopId);
      const info = await getShopeeShopInfo(targetShopId, tokens.accessToken).catch(() => null);
      shopName = info?.shopName || `Shopee Store #${targetShopId}`;
    } else {
      const mainTokens = await exchangeShopeeMainAccountCode(params.code, params.mainAccountId!);
      const picked = await resolveShopeeMainAccountShop(mainTokens.shopIds, mainTokens.accessToken);
      if (!picked) {
        return NextResponse.redirect(new URL("/settings?error=shopee_no_shops", req.url));
      }
      targetShopId = picked.shopId;
      shopName = picked.shopName;
      tokens = mainTokens;
    }

    const tokenData = {
      accessToken: encryptSecret(tokens.accessToken),
      refreshToken: encryptSecret(tokens.refreshToken),
      tokenExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000),
      tokenErrorAt: null,
      tokenError: null,
      isDemo: false,
    };
    await prisma.shopConnection.upsert({
      where: { shopId: targetShopId },
      create: {
        platform: Platform.SHOPEE,
        shopId: targetShopId,
        shopName,
        ...tokenData,
      },
      update: {
        shopName,
        ...tokenData,
      },
    });
    // First sync starts right away; any part that doesn't finish continues on the next tick.
    after(() => runTick("manual").catch((err) => console.error("[Shopee first sync error]", err)));
    return NextResponse.redirect(new URL("/settings?connected=shopee", req.url));
  } catch (err) {
    console.error("[Shopee OAuth callback error]", err);
    return NextResponse.redirect(new URL("/settings?error=shopee_oauth_failed", req.url));
  }
}
