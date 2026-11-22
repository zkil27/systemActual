import { Platform } from "@prisma/client";
import { normalizeCourierName } from "@/lib/connectors/normalizer";
import { shipBlocker } from "./plan";

/**
 * Pure counting for the "ready to ship" header. Counts are per ORDER (what
 * Seller Center counts), so ready + waiting + held adds up to the shop's own
 * "to ship" number when the ledger is in sync.
 */

/** Why a to-ship order isn't in the next wave (besides the 1 h wait). */
export type HeldReason = "cancelled" | "split" | "alreadyInWave" | "notReady" | "noPackage";
export type HeldCounts = Record<HeldReason, number>;
type PlatformKey = "SHOPEE" | "TIKTOK";

export const HELD_LABELS: Array<[HeldReason, string]> = [
  ["cancelled", "buyer asked to cancel"],
  ["split", "split order, pack by hand"],
  ["alreadyInWave", "already in a wave"],
  ["notReady", "already arranged"],
  ["noPackage", "no package yet"],
];

export const emptyHeld = (): HeldCounts => ({ cancelled: 0, split: 0, alreadyInWave: 0, notReady: 0, noPackage: 0 });

export const heldTotal = (h: HeldCounts) => Object.values(h).reduce((a, b) => a + b, 0);

export function addHeld(...all: HeldCounts[]): HeldCounts {
  const out = emptyHeld();
  for (const h of all) for (const k of Object.keys(out) as HeldReason[]) out[k] += h[k];
  return out;
}

export interface ReadyOrderInput {
  platform: Platform;
  status: string;
  cancelRequested: boolean;
  platformCreatedAt: Date;
  packages: Array<{ carrier: string | null; status: string | null; trackingNumber: string | null; inActiveWave: boolean }>;
}

export interface ReadyClassification {
  /** Parcels a wave would ship now. */
  totalReady: number;
  /** Orders under 1 h old (buyer cancel window). */
  coolingOff: number;
  byPlatform: Record<PlatformKey, number>;
  coolingOffByPlatform: Record<PlatformKey, number>;
  held: Record<PlatformKey, HeldCounts>;
  byCourier: Array<{ courier: string; count: number }>;
}

export function classifyReady(orders: ReadyOrderInput[], now: Date): ReadyClassification {
  let totalReady = 0;
  let coolingOff = 0;
  const byPlatform = { SHOPEE: 0, TIKTOK: 0 };
  const coolingOffByPlatform = { SHOPEE: 0, TIKTOK: 0 };
  const held = { SHOPEE: emptyHeld(), TIKTOK: emptyHeld() };
  const courierMap = new Map<string, number>();

  for (const o of orders) {
    const p = o.platform as PlatformKey;
    if (!o.packages.length) {
      held[p].noPackage++;
      continue;
    }
    const blockers = o.packages.map((pkg) =>
      shipBlocker(
        {
          platform: o.platform,
          status: o.status,
          cancelRequested: o.cancelRequested,
          platformCreatedAt: o.platformCreatedAt,
          packageCount: o.packages.length,
        },
        pkg,
        now
      )
    );
    const shippable = o.packages.filter((_, i) => blockers[i] === null);
    if (shippable.length) {
      for (const pkg of shippable) {
        totalReady++;
        byPlatform[p]++;
        const courier = normalizeCourierName(pkg.carrier);
        courierMap.set(courier, (courierMap.get(courier) ?? 0) + 1);
      }
      continue;
    }
    const reason = blockers[0]!;
    if (reason === "tooNew") {
      coolingOff++;
      coolingOffByPlatform[p]++;
    } else {
      held[p][reason]++;
    }
  }

  return {
    totalReady,
    coolingOff,
    byPlatform,
    coolingOffByPlatform,
    held,
    byCourier: [...courierMap.entries()]
      .map(([courier, count]) => ({ courier, count }))
      .sort((a, b) => b.count - a.count || a.courier.localeCompare(b.courier)),
  };
}

/** Orders the ledger knows about for a platform (ready + waiting + held). */
export function ledgerToShip(c: ReadyClassification, p: PlatformKey): number {
  return c.byPlatform[p] + c.coolingOffByPlatform[p] + heldTotal(c.held[p]);
}

/**
 * Local "ready" orders the shop no longer lists as ready. Only shops whose
 * live pass finished are trusted: a partial pass would make everything
 * unseen look stale.
 */
export function staleReadyOrders<T extends { orderSn: string; shopConnectionId: string }>(
  local: T[],
  fresh: Set<string>,
  completeShops: Set<string>
): T[] {
  return local.filter((o) => completeShops.has(o.shopConnectionId) && !fresh.has(`${o.shopConnectionId}:${o.orderSn}`));
}
