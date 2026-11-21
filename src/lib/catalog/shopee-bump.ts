import { Platform } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { shopeeGet, shopeePost } from "@/lib/connectors/shopee";
import { ensureFreshToken } from "@/lib/connectors/tokens";

export const SHOPEE_BUMP_SLOTS = 5;
export const BUMP_LOCK_ID = "shopee-bump";
export const BUMP_COOLDOWN_FALLBACK_SEC = 4 * 3600;
export const BUMP_MIN_CHECK_MS = 10 * 60_000;

export interface BoostedItem {
  itemId: string;
  name: string;
  imageUrl: string | null;
  cooldownSecond: number;
  endsAt: string;
}

export interface BumpState {
  enabled: boolean;
  pinnedItemIds: string[];
  cursor: number;
  boosted: BoostedItem[];
  lastBumpedAt: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  nextCheckAt: string | null;
}

const DEFAULT_STATE: BumpState = {
  enabled: false,
  pinnedItemIds: [],
  cursor: 0,
  boosted: [],
  lastBumpedAt: null,
  lastCheckedAt: null,
  lastError: null,
  nextCheckAt: null,
};

/**
 * Pure rotation picker: fills up to `slotsAvailable` open Shopee bump slots
 * without duplicating currently boosted items. Pinned items come first, then
 * remaining in-stock items rotate forward from `cursor`.
 */
export function pickItemsToBump(opts: {
  candidateItemIds: string[];
  currentlyBoostedIds: Set<string>;
  pinnedItemIds: string[];
  cursor: number;
  slotsAvailable: number;
}): { toBump: string[]; nextCursor: number } {
  const uniqueCandidates = [...new Set(opts.candidateItemIds.map(String).filter(Boolean))];
  const candidateSet = new Set(uniqueCandidates);
  const limit = Math.max(0, Math.min(SHOPEE_BUMP_SLOTS, opts.slotsAvailable));
  if (limit === 0 || uniqueCandidates.length === 0) {
    return { toBump: [], nextCursor: uniqueCandidates.length ? opts.cursor % uniqueCandidates.length : 0 };
  }

  const picked: string[] = [];
  const pickedSet = new Set<string>();

  // 1. Pinned items first (if eligible and not already boosted).
  const pinnedSet = new Set(opts.pinnedItemIds.map(String));
  for (const id of opts.pinnedItemIds.map(String)) {
    if (picked.length >= limit) break;
    if (!candidateSet.has(id) || opts.currentlyBoostedIds.has(id) || pickedSet.has(id)) continue;
    picked.push(id);
    pickedSet.add(id);
  }

  // 2. Rotate through non-pinned candidates from cursor.
  const rotating = uniqueCandidates.filter((id) => !pinnedSet.has(id));
  if (rotating.length === 0 || picked.length >= limit) {
    return { toBump: picked, nextCursor: rotating.length ? opts.cursor % rotating.length : 0 };
  }

  const start = ((opts.cursor % rotating.length) + rotating.length) % rotating.length;
  let lastOffset = start;
  for (let step = 0; step < rotating.length && picked.length < limit; step++) {
    const idx = (start + step) % rotating.length;
    lastOffset = (idx + 1) % rotating.length;
    const id = rotating[idx];
    if (opts.currentlyBoostedIds.has(id) || pickedSet.has(id)) continue;
    picked.push(id);
    pickedSet.add(id);
  }

  return { toBump: picked, nextCursor: lastOffset };
}

type Raw = Record<string, unknown>;

export function parseBoostedList(resp: unknown, now: Date = new Date()): Array<{ itemId: string; cooldownSecond: number; endsAt: string }> {
  const raw = (resp ?? {}) as Raw;
  const list = Array.isArray(raw.item_list) ? (raw.item_list as Raw[]) : [];
  const out: Array<{ itemId: string; cooldownSecond: number; endsAt: string }> = [];
  for (const row of list) {
    const itemId = row.item_id !== undefined && row.item_id !== null ? String(row.item_id) : "";
    if (!itemId) continue;
    const rawCd = row.cool_down_second ?? row.cooldown_second ?? BUMP_COOLDOWN_FALLBACK_SEC;
    const cooldownSecond = Math.max(0, Math.round(Number(rawCd) || 0));
    if (cooldownSecond <= 0) continue;
    out.push({
      itemId,
      cooldownSecond,
      endsAt: new Date(now.getTime() + cooldownSecond * 1000).toISOString(),
    });
  }
  return out;
}

export function parseBoostResult(resp: unknown): { succeeded: string[]; failed: Array<{ itemId: string; reason: string }> } {
  const raw = (resp ?? {}) as Raw;
  const successContainer = raw.success_list;
  const rawSuccess = Array.isArray(successContainer)
    ? successContainer
    : Array.isArray((successContainer as Raw | undefined)?.item_id_list)
      ? ((successContainer as Raw).item_id_list as unknown[])
      : [];
  const succeeded = rawSuccess.map(String).filter(Boolean);

  const rawFail = Array.isArray(raw.failure_list) ? (raw.failure_list as Raw[]) : [];
  const failed = rawFail
    .map((f) => ({
      itemId: f.item_id !== undefined && f.item_id !== null ? String(f.item_id) : "",
      reason: String(f.failed_reason || f.fail_reason || f.error_code || "Couldn't boost"),
    }))
    .filter((f) => f.itemId);

  return { succeeded, failed };
}

function parseStoredState(row: { holder: string | null; rerunRequested: boolean; lockedUntil: Date } | null): BumpState {
  if (!row) return { ...DEFAULT_STATE };
  let parsed: Partial<BumpState> = {};
  if (row.holder) {
    try {
      parsed = JSON.parse(row.holder) as Partial<BumpState>;
    } catch {
      parsed = {};
    }
  }
  return {
    enabled: Boolean(row.rerunRequested || parsed.enabled),
    pinnedItemIds: Array.isArray(parsed.pinnedItemIds) ? parsed.pinnedItemIds.map(String) : [],
    cursor: typeof parsed.cursor === "number" && Number.isFinite(parsed.cursor) ? parsed.cursor : 0,
    boosted: Array.isArray(parsed.boosted) ? parsed.boosted : [],
    lastBumpedAt: typeof parsed.lastBumpedAt === "string" ? parsed.lastBumpedAt : null,
    lastCheckedAt: typeof parsed.lastCheckedAt === "string" ? parsed.lastCheckedAt : null,
    lastError: typeof parsed.lastError === "string" ? parsed.lastError : null,
    nextCheckAt: row.lockedUntil.getTime() > 0 ? row.lockedUntil.toISOString() : parsed.nextCheckAt ?? null,
  };
}

export async function readBumpState(): Promise<BumpState> {
  const row = await prisma.workerLock.findUnique({ where: { id: BUMP_LOCK_ID } });
  return parseStoredState(row);
}

async function writeBumpState(state: BumpState): Promise<void> {
  const lockedUntil = state.nextCheckAt ? new Date(state.nextCheckAt) : new Date(0);
  await prisma.workerLock.upsert({
    where: { id: BUMP_LOCK_ID },
    create: {
      id: BUMP_LOCK_ID,
      lockedUntil,
      rerunRequested: state.enabled,
      holder: JSON.stringify(state),
    },
    update: {
      lockedUntil,
      rerunRequested: state.enabled,
      holder: JSON.stringify(state),
    },
  });
}

async function shopeeItemMetadata(shopConnectionId: string, itemIds: string[]) {
  if (!itemIds.length) return new Map<string, { name: string; imageUrl: string | null }>();
  const rows = await prisma.listingVariant.findMany({
    where: { shopConnectionId, listingId: { in: itemIds } },
    select: { listingId: true, name: true, imageUrl: true },
  });
  const map = new Map<string, { name: string; imageUrl: string | null }>();
  for (const r of rows) {
    const prev = map.get(r.listingId);
    if (!prev || (!prev.imageUrl && r.imageUrl)) {
      map.set(r.listingId, { name: r.name, imageUrl: r.imageUrl });
    }
  }
  return map;
}

export async function getShopeeBumpStatus(
  now: Date = new Date(),
  shopeeOverride?: { id: string; shopName: string } | null
) {
  const [state, shopee] = await Promise.all([
    readBumpState(),
    shopeeOverride !== undefined
      ? Promise.resolve(shopeeOverride)
      : prisma.shopConnection.findFirst({
          where: { platform: Platform.SHOPEE, isDemo: false, accessToken: { not: null } },
          select: { id: true, shopName: true },
        }),
  ]);

  // Filter out expired cooldown entries when rendering UI status between checks.
  const activeBoosted = state.boosted.filter((b) => new Date(b.endsAt).getTime() > now.getTime());
  const allIds = [...new Set([...activeBoosted.map((b) => b.itemId), ...state.pinnedItemIds])];
  const meta = shopee ? await shopeeItemMetadata(shopee.id, allIds) : new Map<string, { name: string; imageUrl: string | null }>();

  return {
    connected: Boolean(shopee),
    shopName: shopee?.shopName ?? null,
    enabled: state.enabled,
    slotsTotal: SHOPEE_BUMP_SLOTS,
    pinnedItemIds: state.pinnedItemIds,
    boosted: activeBoosted.map((b) => {
      const m = meta.get(b.itemId);
      const remainingSec = Math.max(0, Math.round((new Date(b.endsAt).getTime() - now.getTime()) / 1000));
      return {
        ...b,
        name: m?.name ?? b.name,
        imageUrl: m?.imageUrl ?? b.imageUrl,
        cooldownSecond: remainingSec,
      };
    }),
    lastBumpedAt: state.lastBumpedAt,
    lastCheckedAt: state.lastCheckedAt,
    lastError: state.lastError,
    nextCheckAt: state.nextCheckAt,
  };
}

export async function runShopeeBump(opts: { force?: boolean; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const state = await readBumpState();

  if (!opts.force) {
    if (!state.enabled) return { skipped: true, bumped: 0, state };
    if (state.nextCheckAt && now.getTime() < new Date(state.nextCheckAt).getTime()) {
      return { skipped: true, bumped: 0, state };
    }
  }

  const shop = await prisma.shopConnection.findFirst({
    where: { platform: Platform.SHOPEE, isDemo: false, accessToken: { not: null } },
  });
  if (!shop) {
    return { skipped: true, bumped: 0, state };
  }

  try {
    const token = await ensureFreshToken(shop);
    const boostedResp = await shopeeGet("/api/v2/product/get_boosted_list", shop.shopId, token, {});
    let active = parseBoostedList(boostedResp, now);
    const currentlyBoostedIds = new Set(active.map((a) => a.itemId));
    const openSlots = Math.max(0, SHOPEE_BUMP_SLOTS - active.length);

    let bumpedCount = 0;
    let nextCursor = state.cursor;
    let lastBumpedAt = state.lastBumpedAt;
    let lastError: string | null = null;

    if (openSlots > 0 && (state.enabled || opts.force)) {
      const variants = await prisma.listingVariant.findMany({
        where: { shopConnectionId: shop.id },
        select: { listingId: true, name: true, imageUrl: true, availableStock: true, pushedStock: true },
        orderBy: [{ lastSeenAt: "desc" }],
      });

      const byListing = new Map<string, { name: string; imageUrl: string | null; maxKnownStock: number | null }>();
      for (const v of variants) {
        const stock = v.pushedStock ?? v.availableStock;
        const prev = byListing.get(v.listingId);
        if (!prev) {
          byListing.set(v.listingId, { name: v.name, imageUrl: v.imageUrl, maxKnownStock: stock });
        } else {
          if (!prev.imageUrl && v.imageUrl) prev.imageUrl = v.imageUrl;
          if (stock !== null && (prev.maxKnownStock === null || stock > prev.maxKnownStock)) {
            prev.maxKnownStock = stock;
          }
        }
      }

      // Prefer in-stock items (or items whose stock hasn't been read yet).
      const candidates = [...byListing.entries()]
        .filter(([, info]) => info.maxKnownStock === null || info.maxKnownStock > 0)
        .map(([id]) => id);

      const plan = pickItemsToBump({
        candidateItemIds: candidates,
        currentlyBoostedIds,
        pinnedItemIds: state.pinnedItemIds,
        cursor: state.cursor,
        slotsAvailable: openSlots,
      });
      nextCursor = plan.nextCursor;

      if (plan.toBump.length > 0) {
        const boostResp = await shopeePost("/api/v2/product/boost_item", shop.shopId, token, {
          item_id_list: plan.toBump.map(Number),
        });
        const res = parseBoostResult(boostResp);
        bumpedCount = res.succeeded.length;
        if (bumpedCount > 0) {
          lastBumpedAt = now.toISOString();
        }
        if (res.failed.length > 0 && bumpedCount === 0) {
          lastError = res.failed[0].reason;
        }
        // Refresh the active boosted list after bumping so countdowns are exact.
        try {
          active = parseBoostedList(
            await shopeeGet("/api/v2/product/get_boosted_list", shop.shopId, token, {}),
            now
          );
        } catch {
          for (const id of res.succeeded) {
            if (!active.some((a) => a.itemId === id)) {
              active.push({
                itemId: id,
                cooldownSecond: BUMP_COOLDOWN_FALLBACK_SEC,
                endsAt: new Date(now.getTime() + BUMP_COOLDOWN_FALLBACK_SEC * 1000).toISOString(),
              });
            }
          }
        }
      }
    }

    const meta = await shopeeItemMetadata(
      shop.id,
      active.map((a) => a.itemId)
    );
    const boosted: BoostedItem[] = active.map((a) => {
      const m = meta.get(a.itemId);
      return {
        itemId: a.itemId,
        name: m?.name ?? `Item ${a.itemId}`,
        imageUrl: m?.imageUrl ?? null,
        cooldownSecond: a.cooldownSecond,
        endsAt: a.endsAt,
      };
    });

    const minCooldownMs = active.length
      ? Math.max(60_000, Math.min(...active.map((a) => a.cooldownSecond)) * 1000)
      : BUMP_MIN_CHECK_MS;
    const nextCheckAt = new Date(
      now.getTime() + (active.length >= SHOPEE_BUMP_SLOTS ? minCooldownMs : Math.min(minCooldownMs, BUMP_MIN_CHECK_MS))
    ).toISOString();

    const nextState: BumpState = {
      ...state,
      cursor: nextCursor,
      boosted,
      lastBumpedAt,
      lastCheckedAt: now.toISOString(),
      lastError,
      nextCheckAt,
    };
    await writeBumpState(nextState);
    return { skipped: false, bumped: bumpedCount, state: nextState };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const nextState: BumpState = {
      ...state,
      lastCheckedAt: now.toISOString(),
      lastError: message.slice(0, 240),
      nextCheckAt: new Date(now.getTime() + BUMP_MIN_CHECK_MS).toISOString(),
    };
    await writeBumpState(nextState);
    return { skipped: false, bumped: 0, state: nextState, error: message };
  }
}

export async function setShopeeBumpConfig(opts: { enabled?: boolean; togglePinItemId?: string }) {
  const state = await readBumpState();
  const nextPinned = new Set(state.pinnedItemIds);
  if (opts.togglePinItemId) {
    const id = String(opts.togglePinItemId);
    if (nextPinned.has(id)) nextPinned.delete(id);
    else nextPinned.add(id);
  }
  const enabled = opts.enabled !== undefined ? opts.enabled : state.enabled;
  const next: BumpState = {
    ...state,
    enabled,
    pinnedItemIds: [...nextPinned],
    // If just enabled, allow immediate run on tick / force check.
    ...(opts.enabled === true ? { nextCheckAt: null, lastError: null } : {}),
  };
  await writeBumpState(next);

  if (opts.enabled === true && !state.enabled) {
    await runShopeeBump({ force: true });
  }
  return getShopeeBumpStatus();
}

export async function maybeAutoBumpShopee(now: Date = new Date()) {
  try {
    return await runShopeeBump({ force: false, now });
  } catch (err) {
    console.error("[shopee bump]", err);
    return null;
  }
}
