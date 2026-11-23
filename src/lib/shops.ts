import { prisma } from "@/lib/prisma";

/**
 * Once at least one real (non-demo) shop is connected, live views and Telegram
 * summaries exclude demo shop rows so sample data never pollutes real numbers.
 */
export async function hasRealConnectedShop(): Promise<boolean> {
  const count = await prisma.shopConnection.count({
    where: { isDemo: false, accessToken: { not: null } },
  });
  return count > 0;
}

/**
 * Returns a Prisma `shopConnection` filter for `ReturnParcel`, `Order`, or
 * `WalletTransaction` queries when real shops exist.
 */
export async function getRealShopWhere(): Promise<{ shopConnection: { isDemo: false } } | Record<string, never>> {
  return (await hasRealConnectedShop()) ? { shopConnection: { isDemo: false } } : {};
}
