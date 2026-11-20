import { NextResponse } from "next/server";
import { Platform } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { syncShopeeConnection } from "@/lib/connectors/shopee";
import { syncTikTokConnection } from "@/lib/connectors/tiktok";

export async function POST() {
  try {
    const shops = await prisma.shopConnection.findMany();
    let totalSynced = 0;
    const results: Array<{ shopName: string; platform: Platform; synced: number; mode: string }> = [];

    for (const shop of shops) {
      if (shop.isDemo || !shop.accessToken) {
        await prisma.shopConnection.update({
          where: { id: shop.id },
          data: { lastSyncedAt: new Date() },
        });
        results.push({
          shopName: shop.shopName,
          platform: shop.platform,
          synced: 0,
          mode: shop.isDemo ? "demo" : "awaiting_oauth",
        });
        continue;
      }

      const r =
        shop.platform === Platform.SHOPEE
          ? await syncShopeeConnection(shop.id)
          : await syncTikTokConnection(shop.id);
      totalSynced += r.synced;
      results.push({
        shopName: shop.shopName,
        platform: shop.platform,
        synced: r.synced,
        mode: "live",
      });
    }

    return NextResponse.json({
      ok: true,
      totalSynced,
      syncedAt: new Date().toISOString(),
      results,
    });
  } catch (err) {
    console.error("[Manual sync error]", err);
    return NextResponse.json({ error: "Sync failed. Please try again." }, { status: 500 });
  }
}
