import { breaker as sharedBreaker, type Breaker } from "./breaker";
import { configuredProviders, type ConfiguredProvider, type ProviderId } from "./catalog";
import { providerDayBounds } from "./clock";
import { estimateTokens, prismaUsageStore, takeBudget, type UsageStore } from "./ledger";
import { callChat, type ChatMessage, type FailureKind, type FetchLike } from "./openai-compatible";

/**
 * Asks the free AI services for one reply, trying them in order until one
 * answers: Groq → Cloudflare → OpenRouter → Gemini (general questions only).
 * Counts every request against the service's free daily limit, keeps an
 * evening reserve, and skips services that are cooling down. Never throws.
 */

export type { ChatMessage } from "./openai-compatible";

export interface CompletionRequest {
  messages: ChatMessage[];
  /**
   * "private": the messages contain buyer chat or order details, so only
   * services that don't keep or train on data may see them.
   * "general": no buyer details at all; any service may answer.
   */
  privacy: "private" | "general";
  /** Longest reply, in tokens (thinking room is added per model). */
  maxTokens?: number;
  temperature?: number;
  /** Per call. */
  timeoutMs?: number;
  /** For the whole chain. */
  deadlineMs?: number;
  /** Percent of each daily limit held back until 6 PM Manila. */
  reservePct?: number;
}

export interface Attempt {
  provider: ProviderId;
  model: string;
  outcome: "ok" | "cooldown" | "quota" | FailureKind;
  status?: number;
  latencyMs?: number;
}

export type CompletionResult =
  | {
      ok: true;
      text: string;
      provider: ProviderId;
      model: string;
      tokensIn: number;
      tokensOut: number;
      latencyMs: number;
      attempts: Attempt[];
    }
  | {
      ok: false;
      /**
       * no_keys: no AI service set up. no_private: only services that may not see buyer details.
       * quota_out: every service used up its free allowance for now. failed: they all errored.
       */
      reason: "no_keys" | "no_private" | "quota_out" | "failed";
      attempts: Attempt[];
    };

export interface CompletionDeps {
  providers?: ConfiguredProvider[];
  store?: UsageStore;
  fetchImpl?: FetchLike;
  breaker?: Breaker;
  now?: () => Date;
}

export const DEFAULT_TIMEOUT_MS = 15_000;
export const DEFAULT_DEADLINE_MS = 40_000;
const DEFAULT_MAX_TOKENS = 350;

export async function complete(req: CompletionRequest, deps: CompletionDeps = {}): Promise<CompletionResult> {
  const all = deps.providers ?? configuredProviders();
  const store = deps.store ?? prismaUsageStore;
  const brk = deps.breaker ?? sharedBreaker;
  const now = deps.now ?? (() => new Date());
  const started = now().getTime();
  const deadline = started + (req.deadlineMs ?? DEFAULT_DEADLINE_MS);
  const maxTokens = req.maxTokens ?? DEFAULT_MAX_TOKENS;
  const attempts: Attempt[] = [];

  if (all.length === 0) return { ok: false, reason: "no_keys", attempts };
  const providers = req.privacy === "private" ? all.filter((p) => p.spec.privateOk) : all;
  if (providers.length === 0) return { ok: false, reason: "no_private", attempts };

  const estimateIn = estimateTokens(req.messages.map((m) => m.content).join("\n")) + 8 * req.messages.length;

  for (const provider of providers) {
    for (const model of provider.models) {
      const at = now();
      const left = deadline - at.getTime();
      if (left < 2_000) break;
      const base = { provider: provider.spec.id, model: model.model };

      if (brk.waitMs(provider.spec.id, model.model, at.getTime()) > 0) {
        attempts.push({ ...base, outcome: "cooldown" });
        continue;
      }

      const budget = await takeBudget({
        provider,
        model,
        estimateIn,
        estimateOut: maxTokens + (model.thinkingTokens ?? 0),
        reservePct: req.reservePct ?? 15,
        now: at,
        store,
      }).catch(() => null);
      if (!budget) {
        // Can't count usage (database down): don't risk going over a limit.
        attempts.push({ ...base, outcome: "quota" });
        continue;
      }
      if (!budget.ok) {
        attempts.push({ ...base, outcome: "quota" });
        continue;
      }

      const res = await callChat({
        provider,
        model,
        messages: req.messages,
        maxTokens,
        temperature: req.temperature ?? 0.4,
        timeoutMs: Math.min(req.timeoutMs ?? DEFAULT_TIMEOUT_MS, left),
        fetchImpl: deps.fetchImpl,
      });

      if (res.ok) {
        brk.success(provider.spec.id, model.model);
        await store
          .addTokens(budget.key, { tokensIn: res.tokensIn, tokensOut: res.tokensOut, cachedTokens: res.cachedTokens })
          .catch(() => {});
        attempts.push({ ...base, outcome: "ok", status: 200, latencyMs: res.latencyMs });
        return {
          ok: true,
          text: res.text,
          provider: provider.spec.id,
          model: res.model,
          tokensIn: res.tokensIn,
          tokensOut: res.tokensOut,
          latencyMs: now().getTime() - started,
          attempts,
        };
      }

      attempts.push({ ...base, outcome: res.kind, status: res.status, latencyMs: res.latencyMs });
      await store.addError(budget.key).catch(() => {});
      if (res.tokensIn || res.tokensOut) {
        await store
          .addTokens(budget.key, { tokensIn: res.tokensIn ?? 0, tokensOut: res.tokensOut ?? 0, cachedTokens: 0 })
          .catch(() => {});
      }
      const shared = provider.spec.shared;
      const trip = brk.failure(provider.spec.id, model.model, {
        kind: res.kind,
        retryAfterMs: res.retryAfterMs,
        sharedDailyLimit: Boolean(shared?.requestsPerDay || shared?.unitsPerDay),
        dayEndMs: providerDayBounds(provider.spec.dayZone, at).end.getTime(),
        nowMs: now().getTime(),
      });
      // A bad key or a used-up shared allowance affects every model of this service.
      if (trip?.scope === "provider") break;
    }
  }

  // Only limits and cool-downs in the way: the free allowance is used up for now.
  const limited = attempts.length > 0 && !attempts.some(isHardFailure);
  return { ok: false, reason: limited ? "quota_out" : "failed", attempts };
}

function isHardFailure(a: Attempt): boolean {
  return ["auth", "unavailable", "bad_request", "server", "timeout", "network", "empty"].includes(a.outcome);
}
