import crypto from "crypto";
import { prisma } from "@/lib/prisma";

/**
 * Single-row lease so overlapping triggers (PC agent every minute, bursts of
 * webhooks) never run two ticks at once. A crashed tick's lease just expires.
 */
export interface LockStore {
  /** Take the lease if it's free or expired. Returns true if we got it. */
  tryAcquire(id: string, holder: string, until: Date, now: Date): Promise<boolean>;
  requestRerun(id: string): Promise<void>;
  /** Clears and returns the rerun flag, only if we still hold the lease. */
  takeRerun(id: string, holder: string): Promise<boolean>;
  extend(id: string, holder: string, until: Date): Promise<void>;
  release(id: string, holder: string, now: Date): Promise<void>;
}

export const prismaLockStore: LockStore = {
  async tryAcquire(id, holder, until, now) {
    const taken = await prisma.workerLock.updateMany({
      where: { id, lockedUntil: { lte: now } },
      data: { holder, lockedUntil: until, rerunRequested: false },
    });
    if (taken.count === 1) return true;
    try {
      await prisma.workerLock.create({ data: { id, holder, lockedUntil: until } });
      return true;
    } catch {
      return false; // row exists and is held
    }
  },
  async requestRerun(id) {
    await prisma.workerLock.updateMany({ where: { id }, data: { rerunRequested: true } });
  },
  async takeRerun(id, holder) {
    const res = await prisma.workerLock.updateMany({
      where: { id, holder, rerunRequested: true },
      data: { rerunRequested: false },
    });
    return res.count === 1;
  },
  async extend(id, holder, until) {
    await prisma.workerLock.updateMany({ where: { id, holder }, data: { lockedUntil: until } });
  },
  async release(id, holder, now) {
    await prisma.workerLock.updateMany({ where: { id, holder }, data: { lockedUntil: now, holder: null } });
  },
};

export interface LockedRunResult<T> {
  ran: boolean;
  passes: T[];
}

/**
 * Runs `fn` under the lease. If someone asks for a rerun while we run (a
 * webhook arrived mid-tick), do another pass, while time remains.
 */
export async function runLocked<T>(opts: {
  id: string;
  leaseMs: number;
  deadline: number;
  fn: () => Promise<T>;
  store?: LockStore;
  now?: () => Date;
}): Promise<LockedRunResult<T>> {
  const store = opts.store ?? prismaLockStore;
  const now = opts.now ?? (() => new Date());
  const holder = crypto.randomUUID();

  const acquired = await store.tryAcquire(opts.id, holder, new Date(now().getTime() + opts.leaseMs), now());
  if (!acquired) {
    await store.requestRerun(opts.id);
    return { ran: false, passes: [] };
  }

  const passes: T[] = [];
  try {
    do {
      passes.push(await opts.fn());
      await store.extend(opts.id, holder, new Date(now().getTime() + opts.leaseMs));
    } while (now().getTime() < opts.deadline && (await store.takeRerun(opts.id, holder)));
  } finally {
    await store.release(opts.id, holder, now());
  }
  return { ran: true, passes };
}
