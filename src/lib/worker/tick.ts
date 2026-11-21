import { Platform, WaveStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ensureFreshToken } from "@/lib/connectors/tokens";
import { pruneDailyData } from "@/lib/worker/prune";
import { syncOrders } from "@/lib/ledger/sync";
import { detectFailedDeliveries, refreshOpenParcels, syncReturnRequests } from "@/lib/returns/sync";
import { syncMoney } from "@/lib/money/sync";
import { maybeQueueCatalogDiscovery, runStockImport } from "@/lib/catalog/import";
import { maybeAutoBumpShopee } from "@/lib/catalog/shopee-bump";
import { recordShipments } from "@/lib/stock/ledger";
import { pushStock } from "@/lib/stock/push";
import { requeueStalePrintJobs } from "@/lib/print/jobs";
import { sendDailyBriefIfDue } from "@/lib/reports/daily-brief";
import { advanceShopeeWaves } from "@/lib/shipping/shopee-engine";
import { advanceTikTokWaves } from "@/lib/shipping/tiktok-engine";
import { finishDoneWaves, maybeStartScheduledWave } from "@/lib/waves/run";
import { withSpan } from "@/lib/otel";
import { runLocked } from "./lock";

/**
 * One worker tick. Triggered by the warehouse PC agent (adaptively while the
 * PC is on) and by every Shopee/TikTok webhook (any hour).
 * Every job is idempotent and stops when the time budget runs out, so the
 * next tick continues where this one stopped.
 */
export const TICK_BUDGET_MS = 90_000;
const LEASE_MS = 115_000;
const STOCK_PUSH_FALLBACK_MS = 5 * 60_000;
const STOCK_PUSH_LOCK_ID = "stock-push-last";

export type TickReason = "agent" | "webhook" | "schedule" | "manual";

export interface ShopTickResult {
  shop: string;
  ordersSaved: number;
  returnsSaved: number;
  failedDeliveriesFound: number;
  parcelsChecked: number;
  courierReturned: number;
  moneySaved: number;
  stockImportPages?: number;
  caughtUp: boolean;
  error?: string;
}

export interface TickResult {
  ran: boolean;
  reason: TickReason;
  shops: ShopTickResult[];
  pruned: number;
  stock: { shipped: number; pushed: number; failed: number; error?: string };
  nextTickMs: number;
  ms: number;
}

/**
 * A deadline `fraction` of the way from now to `deadline`. Backfills (orders,
 * return requests) get a slice instead of the whole budget, so a shop that's
 * days behind still gets its failed deliveries and courier checks every tick.
 */
export function sliceDeadline(deadline: number, fraction: number, now = Date.now()): number {
  return Math.min(deadline, now + Math.max(0, deadline - now) * fraction);
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
    moneySaved: 0,
    caughtUp: false,
  };
  if (shop.platform === Platform.TIKTOK && !shop.shopCipher) {
    result.error = "Reconnect TikTok (missing shop cipher)";
    return result;
  }
  try {
    const token = await ensureFreshToken(shop);
    // Order ledger first: returns and failed deliveries read packages from it.
    // Orders saved in earlier ticks are enough for the later steps, so a long
    // backfill must not use the whole budget and starve them.
    const orders = await syncOrders(shop, sliceDeadline(deadline, 0.5));
    result.ordersSaved = orders.saved;
    const fresh = await prisma.shopConnection.findUniqueOrThrow({ where: { id: shop.id } });
    const returns = await syncReturnRequests(fresh, token, sliceDeadline(deadline, 0.45));
    result.returnsSaved = returns.saved;
    result.failedDeliveriesFound = (await detectFailedDeliveries(fresh, token, sliceDeadline(deadline, 0.5))).created;
    const refreshed = await refreshOpenParcels(fresh, token, sliceDeadline(deadline, 0.5));
    result.parcelsChecked = refreshed.checked;
    result.courierReturned = refreshed.returned;
    try {
      result.moneySaved = (await syncMoney(fresh, token, sliceDeadline(deadline, 0.5))).saved;
    } catch (err) {
      // Money problems must not hide return updates; report and continue.
      result.error = `Money sync: ${err instanceof Error ? err.message : String(err)}`;
      console.error(`[tick] ${shop.shopName} money`, err);
    }
    let stockImportFinished = true;
    try {
      const queued = await maybeQueueCatalogDiscovery(fresh);
      const importConn = queued
        ? await prisma.shopConnection.findUniqueOrThrow({ where: { id: shop.id } })
        : fresh;
      const imported = await runStockImport(importConn, token, deadline);
      result.stockImportPages = imported.pages;
      if (importConn.stockImportStatus === "RUNNING" && !imported.done) {
        stockImportFinished = false;
      }
    } catch (err) {
      result.error = `Stock import: ${err instanceof Error ? err.message : String(err)}`;
      console.error(`[tick] ${shop.shopName} stock import`, err);
    }
    result.caughtUp = orders.caughtUp && returns.caughtUp && stockImportFinished;
    await prisma.shopConnection.update({ where: { id: shop.id }, data: { lastSyncedAt: new Date() } });
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    console.error(`[tick] ${shop.shopName}`, err);
  }
  return result;
}

async function shouldPushStockNow(ordersSaved: number, shipped: number, now: Date): Promise<boolean> {
  if (ordersSaved > 0 || shipped > 0) return true;
  const row = await prisma.workerLock.findUnique({ where: { id: STOCK_PUSH_LOCK_ID } });
  return !row || now.getTime() - row.lockedUntil.getTime() >= STOCK_PUSH_FALLBACK_MS;
}

async function markStockPushed(now: Date) {
  await prisma.workerLock.upsert({
    where: { id: STOCK_PUSH_LOCK_ID },
    create: { id: STOCK_PUSH_LOCK_ID, lockedUntil: now, holder: null, rerunRequested: false },
    update: { lockedUntil: now },
  });
}

async function tickOnce(
  deadline: number,
  opts?: { platform?: Platform }
): Promise<{ shops: ShopTickResult[]; pruned: number; stock: TickResult["stock"]; nextTickMs: number }> {
  const shops = await prisma.shopConnection.findMany({
    where: {
      isDemo: false,
      accessToken: { not: null },
      ...(opts?.platform ? { platform: opts.platform } : {}),
    },
    orderBy: { platform: "asc" },
    select: { id: true, platform: true },
  });

  // Run shops in parallel so Shopee and TikTok never block each other.
  const shopBudgetDeadline = sliceDeadline(deadline, 0.7);
  const settledShops = await Promise.allSettled(
    shops.map((s) => {
      const spanName = s.platform === Platform.SHOPEE ? "worker.tick.shopee" : "worker.tick.tiktok";
      return withSpan(spanName, () => tickShop(s.id, shopBudgetDeadline));
    })
  );
  const results: ShopTickResult[] = settledShops
    .filter((r): r is PromiseFulfilledResult<ShopTickResult> => r.status === "fulfilled")
    .map((r) => r.value);

  const ordersSavedTotal = results.reduce((sum, r) => sum + r.ordersSaved, 0);

  // Stock spans both shops, so it runs once per tick after shop orders are in.
  let stock: TickResult["stock"] = { shipped: 0, pushed: 0, failed: 0 };
  try {
    const shipped = await recordShipments(deadline);
    const now = new Date();
    if (await shouldPushStockNow(ordersSavedTotal, shipped.movements, now)) {
      const pushedRes = await withSpan("worker.tick.stockPush", () => pushStock(deadline));
      await markStockPushed(now);
      stock = { shipped: shipped.movements, pushed: pushedRes.pushed, failed: pushedRes.failed };
    } else {
      stock = { shipped: shipped.movements, pushed: 0, failed: 0 };
    }
  } catch (err) {
    stock.error = err instanceof Error ? err.message : String(err);
    console.error("[tick] stock", err);
  }

  // Requeue stale claimed print jobs here instead of on every idle agent poll.
  try {
    await requeueStalePrintJobs();
  } catch (err) {
    console.error("[tick] requeue print jobs", err);
  }

  // Waves: arrange shipment, tracking numbers, labels. Only for shops whose write switch is on.
  try {
    await maybeStartScheduledWave();
  } catch (err) {
    console.error("[tick] scheduled wave", err);
  }

  try {
    await withSpan("worker.tick.waves", async () => {
      const waveTotals = new Map<string, number>();
      await Promise.allSettled([
        advanceShopeeWaves(deadline, waveTotals),
        advanceTikTokWaves(deadline, waveTotals),
      ]);
      await finishDoneWaves();
    });
  } catch (err) {
    console.error("[tick] waves", err);
  }

  try {
    await maybeAutoBumpShopee();
  } catch (err) {
    console.error("[tick] shopee bump", err);
  }

  try {
    await sendDailyBriefIfDue();
  } catch (err) {
    console.error("[tick] daily brief", err);
  }

  const [pruneRes, runningWaves] = await Promise.all([
    pruneDailyData(),
    prisma.wave.count({ where: { status: WaveStatus.RUNNING } }),
  ]);

  const anyBehind = results.some((r) => !r.caughtUp);
  const nextTickMs = runningWaves > 0 || anyBehind ? 20_000 : 180_000;

  return { shops: results, pruned: pruneRes.orders, stock, nextTickMs };
}

export async function runTick(
  reason: TickReason,
  opts?: { platform?: Platform }
): Promise<TickResult> {
  const started = Date.now();
  const deadline = started + TICK_BUDGET_MS;
  const run = await runLocked({
    id: "tick",
    leaseMs: LEASE_MS,
    deadline,
    fn: () => tickOnce(deadline, opts),
  });
  const last = run.passes[run.passes.length - 1];
  return {
    ran: run.ran,
    reason,
    shops: last?.shops ?? [],
    stock: last?.stock ?? { shipped: 0, pushed: 0, failed: 0 },
    pruned: run.passes.reduce((n, p) => n + p.pruned, 0),
    nextTickMs: last?.nextTickMs ?? 180_000,
    ms: Date.now() - started,
  };
}
