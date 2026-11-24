import { prisma } from "@/lib/prisma";
import { allowanceShare, pacedCap, providerDayKey } from "./clock";
import type { ConfiguredProvider, ModelSpec } from "./catalog";

/**
 * Free AI use per service, model and service-day (the AiUsage table). A request
 * is counted before it's sent, with a single conditional UPDATE, so two chats
 * answered at the same moment can't both take the last free request.
 */

/** Row that holds limits shared by all of a service's models. */
export const SHARED_MODEL = "*";

export interface UsageKey {
  provider: string;
  model: string;
  dayKey: string;
}

export interface UsageRow extends UsageKey {
  requests: number;
  tokensIn: number;
  tokensOut: number;
  cachedTokens: number;
  errors: number;
}

export interface UsageStore {
  /** Adds one request unless the row is already at `cap`. False when full. */
  takeRequest(key: UsageKey, cap?: number): Promise<boolean>;
  addTokens(key: UsageKey, u: { tokensIn: number; tokensOut: number; cachedTokens: number }): Promise<void>;
  addError(key: UsageKey): Promise<void>;
  read(provider: string, dayKey: string): Promise<UsageRow[]>;
}

export const prismaUsageStore: UsageStore = {
  async takeRequest(key, cap) {
    await prisma.aiUsage.createMany({ data: [key], skipDuplicates: true });
    const res = await prisma.aiUsage.updateMany({
      where: { ...key, ...(cap !== undefined ? { requests: { lt: cap } } : {}) },
      data: { requests: { increment: 1 } },
    });
    return res.count > 0;
  },
  async addTokens(key, u) {
    await prisma.aiUsage.updateMany({
      where: key,
      data: {
        tokensIn: { increment: u.tokensIn },
        tokensOut: { increment: u.tokensOut },
        cachedTokens: { increment: u.cachedTokens },
      },
    });
  },
  async addError(key) {
    await prisma.aiUsage.upsert({
      where: { provider_model_dayKey: key },
      create: { ...key, errors: 1 },
      update: { errors: { increment: 1 } },
    });
  },
  async read(provider, dayKey) {
    return prisma.aiUsage.findMany({
      where: { provider, dayKey },
      select: { provider: true, model: true, dayKey: true, requests: true, tokensIn: true, tokensOut: true, cachedTokens: true, errors: true },
    });
  },
};

/** In-memory store for tests and dry runs. Single-threaded, so take is atomic. */
export function memoryUsageStore(): UsageStore & { rows: Map<string, UsageRow> } {
  const rows = new Map<string, UsageRow>();
  const k = (key: UsageKey) => `${key.provider}|${key.model}|${key.dayKey}`;
  const get = (key: UsageKey) => {
    let r = rows.get(k(key));
    if (!r) {
      r = { ...key, requests: 0, tokensIn: 0, tokensOut: 0, cachedTokens: 0, errors: 0 };
      rows.set(k(key), r);
    }
    return r;
  };
  return {
    rows,
    async takeRequest(key, cap) {
      const r = get(key);
      if (cap !== undefined && r.requests >= cap) return false;
      r.requests++;
      return true;
    },
    async addTokens(key, u) {
      const r = get(key);
      r.tokensIn += u.tokensIn;
      r.tokensOut += u.tokensOut;
      r.cachedTokens += u.cachedTokens;
    },
    async addError(key) {
      get(key).errors++;
    },
    async read(provider, dayKey) {
      return [...rows.values()].filter((r) => r.provider === provider && r.dayKey === dayKey);
    },
  };
}

/** Rough token count for Taglish chat text (about 3 characters per token). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3);
}

function units(model: ModelSpec | undefined, tokensIn: number, tokensOut: number): number {
  if (!model?.unitsPerMIn && !model?.unitsPerMOut) return 0;
  return (tokensIn * (model.unitsPerMIn ?? 0) + tokensOut * (model.unitsPerMOut ?? 0)) / 1_000_000;
}

export type BudgetResult =
  | { ok: true; key: UsageKey }
  | { ok: false; reason: "requests" | "tokens" | "units" | "shared_requests" };

/**
 * Checks and takes one request for a model, within today's paced allowance.
 * Token and unit limits are checked against an estimate (the service's own
 * limit is the final guard); request limits are taken atomically.
 */
export async function takeBudget(opts: {
  provider: ConfiguredProvider;
  model: ModelSpec;
  estimateIn: number;
  estimateOut: number;
  reservePct: number;
  now: Date;
  store: UsageStore;
}): Promise<BudgetResult> {
  const { provider, model, store } = opts;
  const dayKey = providerDayKey(provider.spec.dayZone, opts.now);
  const share = allowanceShare(provider.spec.dayZone, opts.reservePct, opts.now);
  const key: UsageKey = { provider: provider.spec.id, model: model.model, dayKey };
  const rows = await store.read(provider.spec.id, dayKey);
  const mine = rows.find((r) => r.model === model.model);

  if (model.tokensPerDay) {
    const used = (mine?.tokensIn ?? 0) + (mine?.tokensOut ?? 0);
    if (used + opts.estimateIn + opts.estimateOut > pacedCap(model.tokensPerDay, share)) return { ok: false, reason: "tokens" };
  }
  const shared = provider.spec.shared;
  if (shared?.unitsPerDay) {
    const byModel = new Map(provider.models.map((m) => [m.model, m]));
    const used = rows.reduce((sum, r) => sum + units(byModel.get(r.model), r.tokensIn, r.tokensOut), 0);
    const next = units(model, opts.estimateIn, opts.estimateOut);
    if (used + next > pacedCap(shared.unitsPerDay, share)) return { ok: false, reason: "units" };
  }
  if (shared?.requestsPerDay) {
    const sharedKey = { ...key, model: SHARED_MODEL };
    if (!(await store.takeRequest(sharedKey, pacedCap(shared.requestsPerDay, share)))) {
      return { ok: false, reason: "shared_requests" };
    }
  }
  const cap = model.requestsPerDay ? pacedCap(model.requestsPerDay, share) : undefined;
  if (!(await store.takeRequest(key, cap))) return { ok: false, reason: "requests" };
  return { ok: true, key };
}
