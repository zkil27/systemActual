import { Platform, WaveStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ensureFreshToken } from "@/lib/connectors/tokens";
import { pruneDailyData } from "@/lib/worker/prune";
import { notifyNewBuyerMessage } from "@/lib/chats/notify";
import { syncAllTikTokChats } from "@/lib/chats/tiktok-sync";
import { syncOrders } from "@/lib/ledger/sync";
import { detectFailedDeliveries, refreshOpenParcels, syncReturnRequests } from "@/lib/returns/sync";
import { syncMoney } from "@/lib/money/sync";
import { maybeQueueCatalogDiscovery, runStockImport } from "@/lib/catalog/import";
import { maybeAutoBumpShopee } from "@/lib/catalog/shopee-bump";
import { recordShipments } from "@/lib/stock/ledger";
import { pushStock } from "@/lib/stock/push";
import { requeueStalePrintJobs } from "@/lib/print/jobs";
import { sendDailyBriefIfDue } from "@/lib/reports/daily-brief";
import { runProactiveAlerts } from "@/lib/reports/alerts";
import { advanceShopeeWaves } from "@/lib/shipping/shopee-engine";
import { advanceTikTokWaves } from "@/lib/shipping/tiktok-engine";
import { finishDoneWaves, maybeStartScheduledWave } from "@/lib/waves/run";
import { claimReadyReconcile, reconcileReadyOrders } from "@/lib/waves/reconcile";
import { withSpan } from "@/lib/otel";
import { drainIntegrationEvents } from "@/lib/integrations/inbox";
import { syncOrderFinance } from "@/lib/finance/sync";
import { maybeRollUpFinance } from "@/lib/finance/report";
import { handleMarketplaceEvent } from "@/lib/integrations/handle-event";
import { runLocked } from "./lock";

/**
 * One worker tick. Triggered by the warehouse PC agent (adaptively while the
 * PC is on) and by every Shopee/TikTok webhook (any hour).
 * Every job is idempotent and stops when the time budget runs out, so the
 * next tick continues where this one stopped.
 */
export const TICK_BUDGET_MS = 90_000;
/** Longer than the route's 120 s maxDuration, so a slow tick is killed before its lease can expire under it. */
export const LEASE_MS = 135_000;
/** A rerun pass only starts with at least this long left. */
const MIN_PASS_MS = 20_000;
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
  /** Completed orders whose fees and payout were saved. */
  financeSaved?: number;
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
/** True while at least `minMs` is left before `deadline`. Tail steps skip themselves otherwise; the next tick runs them. */
export function hasTime(deadline: number, minMs: number, now = Date.now()): boolean {
  return deadline - now >= minMs;
}

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
    try {
      // Read-only: fees and payout of completed orders, for Profit.
      result.financeSaved = (await syncOrderFinance(fresh, token, sliceDeadline(deadline, 0.4))).saved;
    } catch (err) {
      result.error = `Profit sync: ${err instanceof Error ? err.message : String(err)}`;
      console.error(`[tick] ${shop.shopName} finance`, err);
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

  // Webhook events whose handling crashed or timed out get another try.
  try {
    if (hasTime(deadline, 30_000)) {
      await withSpan("worker.tick.inbox", () =>
        drainIntegrationEvents(sliceDeadline(deadline, 0.15), handleMarketplaceEvent)
      );
    }
  } catch (err) {
    console.error("[tick] webhook inbox", err);
  }

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

  // Owner-facing messages come before the optional steps, so a long tick
  // never makes the 8 PM brief or an urgent alert wait for the next one.
  try {
    await sendDailyBriefIfDue();
  } catch (err) {
    console.error("[tick] daily brief", err);
  }

  try {
    await withSpan("worker.tick.alerts", () => runProactiveAlerts());
  } catch (err) {
    console.error("[tick] proactive alerts", err);
  }

  // Keep the ledger's to-ship list matching Seller Center (at most every 5 min).
  try {
    if (hasTime(deadline, 15_000) && (await claimReadyReconcile())) {
      await withSpan("worker.tick.readyReconcile", () => reconcileReadyOrders(sliceDeadline(deadline, 0.6)));
    }
  } catch (err) {
    console.error("[tick] ready reconcile", err);
  }

  try {
    // Monthly profit totals (kept for good), at most every 30 minutes.
    if (hasTime(deadline, 15_000)) await withSpan("worker.tick.financeRollup", () => maybeRollUpFinance());
  } catch (err) {
    console.error("[tick] finance rollup", err);
  }

  try {
    if (hasTime(deadline, 10_000)) await maybeAutoBumpShopee();
  } catch (err) {
    console.error("[tick] shopee bump", err);
  }

  try {
    // TikTok buyer chats: changed chats only, at most once a minute per shop.
    if (hasTime(deadline, 10_000)) {
      await withSpan("worker.tick.chats", () => syncAllTikTokChats(sliceDeadline(deadline, 0.3)));
    }
  } catch (err) {
    console.error("[tick] chats", err);
  }

  try {
    // Sends any grouped "new buyer messages" alert held back by the 2-minute limit.
    if (hasTime(deadline, 5_000)) await notifyNewBuyerMessage({ count: 0 });
  } catch (err) {
    console.error("[tick] chat alerts", err);
  }

  // The daily prune marks itself done only after it runs, so skipping it here
  // just moves it to the next tick with time to spare.
  const [pruneRes, runningWaves] = await Promise.all([
    hasTime(deadline, 20_000) ? pruneDailyData() : Promise.resolve({ orders: 0 }),
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
  // Only the first pass honours the platform filter. A rerun was asked for by
  // some other webhook/agent call, which may be for the other shop, so later
  // passes cover every shop (a Shopee webhook burst must never starve TikTok).
  let pass = 0;
  const run = await runLocked({
    id: "tick",
    leaseMs: LEASE_MS,
    deadline,
    minPassMs: MIN_PASS_MS,
    fn: () => tickOnce(deadline, pass++ === 0 ? opts : undefined),
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
