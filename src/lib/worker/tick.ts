import { Platform } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ensureFreshToken } from "@/lib/connectors/tokens";
import { pruneOldOrders } from "@/lib/ledger/store";
import { syncOrders } from "@/lib/ledger/sync";
import { detectFailedDeliveries, refreshOpenParcels, syncReturnRequests } from "@/lib/returns/sync";
import { runLocked } from "./lock";

/**
 * One worker tick. Triggered by the warehouse PC agent (every minute while the
 * PC is on) and by every Shopee/TikTok webhook (any hour). There is no cron.
 * Every job is idempotent and stops when the time budget runs out, so the
 * next tick continues where this one stopped.
 */
export const TICK_BUDGET_MS = 45_000;
const LEASE_MS = 70_000;

export type TickReason = "agent" | "webhook" | "schedule" | "manual";

export interface ShopTickResult {
  shop: string;
  ordersSaved: number;
  returnsSaved: number;
  failedDeliveriesFound: number;
  parcelsChecked: number;
  courierReturned: number;
  caughtUp: boolean;
  error?: string;
}

export interface TickResult {
  ran: boolean;
  reason: TickReason;
  shops: ShopTickResult[];
  pruned: number;
  ms: number;
}

async function tickShop(shopId: string, deadline: number): Promise<ShopTickResult> {
  const shop = await prisma.shopConnection.findUniqueOrThrow({ where: { id: shopId } });
  const result: ShopTickResult = {
    shop: shop.shopName,
    ordersSaved: 0,
    returnsSaved: 0,
    failedDeliveriesFound: 0,
    parcelsChecked: 0,
    courierReturned: 0,
    caughtUp: false,
  };
  if (shop.platform === Platform.TIKTOK && !shop.shopCipher) {
    result.error = "Reconnect TikTok (missing shop cipher)";
    return result;
  }
  try {
    const token = await ensureFreshToken(shop);
    // Order ledger first: returns and failed deliveries read packages from it.
    const orders = await syncOrders(shop, deadline);
    result.ordersSaved = orders.saved;
    const fresh = await prisma.shopConnection.findUniqueOrThrow({ where: { id: shop.id } });
    const returns = await syncReturnRequests(fresh, token, deadline);
    result.returnsSaved = returns.saved;
    result.failedDeliveriesFound = (await detectFailedDeliveries(fresh, token, deadline)).created;
    const refreshed = await refreshOpenParcels(fresh, token, deadline);
    result.parcelsChecked = refreshed.checked;
    result.courierReturned = refreshed.returned;
    result.caughtUp = orders.caughtUp && returns.caughtUp;
    await prisma.shopConnection.update({ where: { id: shop.id }, data: { lastSyncedAt: new Date() } });
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    console.error(`[tick] ${shop.shopName}`, err);
  }
  return result;
}

async function tickOnce(deadline: number): Promise<{ shops: ShopTickResult[]; pruned: number }> {
  const shops = await prisma.shopConnection.findMany({
    where: { isDemo: false, accessToken: { not: null } },
    orderBy: { platform: "asc" },
    select: { id: true },
  });
  const results: ShopTickResult[] = [];
  for (let i = 0; i < shops.length; i++) {
    // Fair share of the remaining time, so a big backfill on one shop doesn't starve the other.
    const share = (deadline - Date.now()) / (shops.length - i);
    results.push(await tickShop(shops[i].id, Math.min(deadline, Date.now() + share)));
  }
  const pruned = await pruneOldOrders();
  return { shops: results, pruned };
}

export async function runTick(reason: TickReason): Promise<TickResult> {
  const started = Date.now();
  const deadline = started + TICK_BUDGET_MS;
  const run = await runLocked({
    id: "tick",
    leaseMs: LEASE_MS,
    deadline,
    fn: () => tickOnce(deadline),
  });
  const last = run.passes[run.passes.length - 1];
  return {
    ran: run.ran,
    reason,
    shops: last?.shops ?? [],
    pruned: run.passes.reduce((n, p) => n + p.pruned, 0),
    ms: Date.now() - started,
  };
}
