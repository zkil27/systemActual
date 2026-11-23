import { NextRequest, NextResponse, after } from "next/server";
import { Platform } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getOwnerSession } from "@/lib/auth";
import { encryptSecret } from "@/lib/crypto";
import { exchangeTikTokCode, getAuthorizedShops } from "@/lib/connectors/tiktok";
import { checkOAuthState, clearOAuthStateCookie } from "@/lib/oauth-state";
import { runTick } from "@/lib/worker/tick";

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!(await getOwnerSession())) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  if (!checkOAuthState(req)) {
    return NextResponse.redirect(new URL("/settings?error=tiktok_state_mismatch", req.url));
  }
  const code = req.nextUrl.searchParams.get("code");
  if (!code) {
    return NextResponse.redirect(new URL("/settings?error=tiktok_missing_code", req.url));
  }
  const res = await connectTikTok(req, code);
  clearOAuthStateCookie(res);
  return res;
}

async function connectTikTok(req: NextRequest, code: string): Promise<NextResponse> {
  try {
    const tokens = await exchangeTikTokCode(code);
    // The real shop_id and shop_cipher come from Get Authorized Shops. Without
    // the cipher, every shop-scoped API call fails.
    const shops = await getAuthorizedShops(tokens.accessToken);
    if (shops.length === 0) {
      return NextResponse.redirect(new URL("/settings?error=tiktok_no_shops", req.url));
    }

    const tokenData = {
      accessToken: encryptSecret(tokens.accessToken),
      refreshToken: encryptSecret(tokens.refreshToken),
      tokenExpiresAt: tokens.expiresAt,
      tokenErrorAt: null,
      tokenError: null,
      isDemo: false,
    };

    for (const shop of shops) {
      const encryptedCipher = shop.cipher ? encryptSecret(shop.cipher) : null;
      // Older versions stored a made-up "tiktok-<seller>" id. Move that row to
      // the real id so its parcels stay attached.
      const existing = await prisma.shopConnection.findUnique({ where: { shopId: shop.id } });
      const legacy = existing
        ? null
        : await prisma.shopConnection.findFirst({
            where: { platform: Platform.TIKTOK, isDemo: false, shopId: { startsWith: "tiktok-" } },
          });

      if (legacy) {
        await prisma.shopConnection.update({
          where: { id: legacy.id },
          data: { shopId: shop.id, shopName: shop.name, shopCipher: encryptedCipher, ...tokenData },
        });
        continue;
      }

      await prisma.shopConnection.upsert({
        where: { shopId: shop.id },
        create: {
          platform: Platform.TIKTOK,
          shopId: shop.id,
          shopName: shop.name,
          shopCipher: encryptedCipher,
          ...tokenData,
        },
        update: { shopName: shop.name, shopCipher: encryptedCipher, ...tokenData },
      });
    }
    after(() => runTick("manual").catch((err) => console.error("[TikTok first sync error]", err)));
    return NextResponse.redirect(new URL("/settings?connected=tiktok", req.url));
  } catch (err) {
    console.error("[TikTok OAuth callback error]", err);
    return NextResponse.redirect(new URL("/settings?error=tiktok_oauth_failed", req.url));
  }
}
