import { Platform } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { tiktokRequest } from "@/lib/connectors/tiktok";
import { ensureFreshToken } from "@/lib/connectors/tokens";

/**
 * TikTok order statuses Seller Center counts as "Orders to ship".
 * Confirm against Seller Center with scripts/tiktok-ready-audit.ts.
 */
export const TIKTOK_TO_SHIP_STATUSES = ["AWAITING_SHIPMENT"];

const CACHE_MS = 60_000;
const BUDGET_MS = 6_000;

export interface LiveToShip {
  /** Live count from TikTok, or null if it couldn't be fetched. */
  TIKTOK: number | null;
}

let cache: { at: number; value: LiveToShip } | null = null;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    p.finally(() => clearTimeout(timer)),
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error("timeout")), ms);
    }),
  ]);
}

/** One `page_size: 1` search per shop and status; TikTok returns `total_count`. */
async function countTikTok(): Promise<number | null> {
  const shops = await prisma.shopConnection.findMany({
    where: { isDemo: false, accessToken: { not: null }, platform: Platform.TIKTOK, shopCipher: { not: null } },
  });
  if (!shops.length) return null;
  const counts = await Promise.all(
    shops.map(async (shop) => {
      const token = await ensureFreshToken(shop);
      let sum = 0;
      for (const status of TIKTOK_TO_SHIP_STATUSES) {
        const data = await tiktokRequest({
          method: "POST",
          path: "/order/202309/orders/search",
          accessToken: token,
          shopCipher: shop.shopCipher,
          query: { page_size: "1" },
          body: { order_status: status },
        });
        const total = Number(data?.total_count);
        if (!Number.isFinite(total)) throw new Error("TikTok search returned no total_count");
        sum += total;
      }
      return sum;
    })
  );
  return counts.reduce((a, b) => a + b, 0);
}

/** Live "to ship" counts straight from the shops, cached for a minute. Never throws. */
export async function getLiveToShipCounts(): Promise<LiveToShip> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_MS) return cache.value;
  let tiktok: number | null = null;
  try {
    tiktok = await withTimeout(countTikTok(), BUDGET_MS);
  } catch (err) {
    console.error("[live to-ship count]", err);
  }
  const value = { TIKTOK: tiktok };
  if (tiktok !== null) cache = { at: now, value };
  return value;
}
