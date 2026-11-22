import { prisma } from "@/lib/prisma";
import { syncReadyOrders } from "@/lib/ledger/sync";
import { readyWhere } from "./build";
import { MAX_WAVE_SIZE } from "./plan";
import { staleReadyOrders } from "./ready";
import { recheckOrders } from "./recheck";

const LOCK_ID = "ready-reconcile-last";
export const RECONCILE_EVERY_MS = 5 * 60_000;
/** Cap per run so one big backlog can't eat the whole tick. */
const MAX_RECHECK = 300;

/** True (and records the run) if the last reconcile was more than 5 min ago. */
export async function claimReadyReconcile(now: Date = new Date()): Promise<boolean> {
  const row = await prisma.workerLock.findUnique({ where: { id: LOCK_ID } });
  if (row && now.getTime() - row.lockedUntil.getTime() < RECONCILE_EVERY_MS) return false;
  await prisma.workerLock.upsert({
    where: { id: LOCK_ID },
    create: { id: LOCK_ID, lockedUntil: now, holder: null, rerunRequested: false },
    update: { lockedUntil: now },
  });
  return true;
}

/**
 * Makes the ledger's ready list match the shops: pulls every live ready order,
 * then re-fetches local "ready" orders the shop no longer lists (shipped in
 * Seller Center, cancelled, ...) so their real status is saved. Nothing is
 * changed on the shops.
 */
export async function reconcileReadyOrders(
  deadline: number
): Promise<{ live: number; stale: number; rechecked: number }> {
  const syncDeadline = Date.now() + Math.max(0, deadline - Date.now()) * 0.6;
  const { fresh, completeShops } = await syncReadyOrders(syncDeadline);
  if (!completeShops.size) return { live: fresh.size, stale: 0, rechecked: 0 };

  const local = await prisma.order.findMany({
    where: { ...readyWhere(undefined, { includeCancelRequested: true }), shopConnectionId: { in: [...completeShops] } },
    select: { id: true, orderSn: true, platform: true, shopConnectionId: true },
    take: MAX_WAVE_SIZE,
  });
  const stale = staleReadyOrders(local, fresh, completeShops);
  const rechecked = stale.length ? await recheckOrders(stale.slice(0, MAX_RECHECK), deadline) : new Set<string>();
  if (stale.length) console.log(`[ready reconcile] ${stale.length} stale, ${rechecked.size} re-checked`);
  return { live: fresh.size, stale: stale.length, rechecked: rechecked.size };
}
