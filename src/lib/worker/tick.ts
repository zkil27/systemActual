import { Platform } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { syncShopeeConnection } from "@/lib/connectors/shopee";
import { syncTikTokConnection } from "@/lib/connectors/tiktok";
import { pruneOldOrders } from "@/lib/ledger/store";
import { syncOrders } from "@/lib/ledger/sync";
import { runLocked } from "./lock";

/**
 * One worker tick. Triggered by the warehouse PC agent (every minute while the
 * PC is on) and by every Shopee/TikTok webhook (any hour). There is no cron.
 * Every job is idempotent and stops when the time budget runs out, so the
 * next tick continues where this one stopped.
 */
export const TICK_BUDGET_MS = 45_000;
const LEASE_MS = 70_000;
/** Until Task 4 replaces it, the old full returns sync runs at most this often. */
const LEGACY_RETURNS_EVERY_MS = 15 * 60_000;
const LEGACY_RETURNS_MIN_TIME_LEFT_MS = 25_000;

export type TickReason = "agent" | "webhook" | "schedule" | "manual";

export interface ShopTickResult {
  shop: string;
  ordersSaved: number;
  caughtUp: boolean;
  returnsSynced?: number;
  error?: string;
}

export interface TickResult {
  ran: boolean;
  reason: TickReason;
  shops: ShopTickResult[];
  pruned: number;
  ms: number;
}

async function tickOnce(deadline: number): Promise<{ shops: ShopTickResult[]; pruned: number }> {
  const shops = await prisma.shopConnection.findMany({
    where: { isDemo: false, accessToken: { not: null } },
    orderBy: { platform: "asc" },
  });

  const results: ShopTickResult[] = [];
  for (const shop of shops) {
    const result: ShopTickResult = { shop: shop.shopName, ordersSaved: 0, caughtUp: false };
    try {
      const orders = await syncOrders(shop, deadline);
      result.ordersSaved = orders.saved;
      result.caughtUp = orders.caughtUp;

      const due = !shop.lastSyncedAt || Date.now() - shop.lastSyncedAt.getTime() >= LEGACY_RETURNS_EVERY_MS;
      if (due && deadline - Date.now() >= LEGACY_RETURNS_MIN_TIME_LEFT_MS) {
        const r =
          shop.platform === Platform.SHOPEE
            ? await syncShopeeConnection(shop.id)
            : await syncTikTokConnection(shop.id);
        result.returnsSynced = r.synced;
      }
    } catch (err) {
      result.error = err instanceof Error ? err.message : String(err);
      console.error(`[tick] ${shop.shopName}`, err);
    }
    results.push(result);
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
