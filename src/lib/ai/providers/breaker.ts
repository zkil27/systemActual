import type { FailureKind } from "./openai-compatible";

/**
 * Stops calling a service or model that keeps failing, for a while. Kept in
 * memory per server instance: another instance learns the same thing from one
 * failed call, and the next service in line answers in the meantime.
 */

const MIN = 60 * 1000;

export interface BreakerTrip {
  /** Whole service (bad key, shared daily limit) or one model. */
  scope: "provider" | "model";
  untilMs: number;
}

/** How long to stop after one failure. null = don't stop (try again next time). */
export function cooldownFor(opts: {
  kind: FailureKind;
  retryAfterMs?: number;
  consecutive: number;
  sharedDailyLimit: boolean;
  dayEndMs: number;
  nowMs: number;
}): BreakerTrip | null {
  const { kind, nowMs } = opts;
  switch (kind) {
    case "rate_limit":
      return { scope: "model", untilMs: nowMs + Math.min(10 * MIN, Math.max(20_000, opts.retryAfterMs ?? 30_000)) };
    case "daily_limit":
      return { scope: opts.sharedDailyLimit ? "provider" : "model", untilMs: opts.dayEndMs };
    case "auth":
      return { scope: "provider", untilMs: nowMs + 30 * MIN };
    case "unavailable":
      return { scope: "model", untilMs: nowMs + 60 * MIN };
    case "server":
    case "timeout":
    case "network":
    case "empty":
    case "bad_request":
      // One slow or odd reply happens; three in a row means the model is struggling.
      return opts.consecutive >= 3 ? { scope: "model", untilMs: nowMs + 2 * MIN } : null;
  }
}

export class Breaker {
  private open = new Map<string, number>();
  private fails = new Map<string, number>();

  private static key(provider: string, model?: string) {
    return model ? `${provider}|${model}` : provider;
  }

  /** Ms left before this model may be tried again (0 = go ahead). */
  waitMs(provider: string, model: string, nowMs: number): number {
    const until = Math.max(this.open.get(Breaker.key(provider)) ?? 0, this.open.get(Breaker.key(provider, model)) ?? 0);
    return Math.max(0, until - nowMs);
  }

  success(provider: string, model: string) {
    this.fails.delete(Breaker.key(provider, model));
    this.open.delete(Breaker.key(provider, model));
  }

  failure(
    provider: string,
    model: string,
    opts: { kind: FailureKind; retryAfterMs?: number; sharedDailyLimit: boolean; dayEndMs: number; nowMs: number }
  ): BreakerTrip | null {
    const mk = Breaker.key(provider, model);
    const consecutive = (this.fails.get(mk) ?? 0) + 1;
    this.fails.set(mk, consecutive);
    const trip = cooldownFor({ ...opts, consecutive });
    if (trip) {
      const k = trip.scope === "provider" ? Breaker.key(provider) : mk;
      this.open.set(k, Math.max(this.open.get(k) ?? 0, trip.untilMs));
      if (trip.scope === "model") this.fails.delete(mk);
    }
    return trip;
  }

  reset() {
    this.open.clear();
    this.fails.clear();
  }
}

/** Shared by all calls in this server instance. */
export const breaker = new Breaker();
