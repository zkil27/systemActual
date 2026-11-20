import { handleSchedule } from "@vercel/schedules";
import { Platform } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { syncShopeeConnection } from "@/lib/connectors/shopee";
import { syncTikTokConnection } from "@/lib/connectors/tiktok";

export const POST = handleSchedule(async (metadata) => {
  console.log(`[schedule:poll-sync] execution ${metadata.executionId}`);
  const shops = await prisma.shopConnection.findMany({
    where: { isDemo: false, accessToken: { not: null } },
  });
  for (const shop of shops) {
    if (shop.platform === Platform.SHOPEE) {
      await syncShopeeConnection(shop.id);
    } else if (shop.platform === Platform.TIKTOK) {
      await syncTikTokConnection(shop.id);
    }
  }
});
