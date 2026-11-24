import { Breaker } from "../providers/breaker";
import { configuredProviders, type ConfiguredProvider } from "../providers/catalog";
import { complete } from "../providers";
import { memoryUsageStore } from "../providers/ledger";
import type { FetchLike } from "../providers/openai-compatible";

/**
 * Sale-day burst on a fake clock: fake AI services that enforce the real free
 * limits (Groq per model: 30 req/min, 8K tokens/min, 1,000 req/day, 200K
 * tokens/day; Cloudflare: 10,000 neurons/day) answer one chat at a time, the
 * way the drafts queue will. Shows how long buyers wait and that no daily
 * limit is ever crossed. No real AI calls.
 */

export interface SimOptions {
  chats: number;
  /** Chats arrive spread over this many seconds. */
  arrivalSeconds: number;
  /** Prompt size per reply (a real prompt with a listing is about 2,000–2,800). */
  tokensIn: number;
  /** Reply tokens the fake services charge (reply plus thinking). */
  tokensOut?: number;
  /** Fake service answer time. */
  latencyMs?: number;
  providers?: ConfiguredProvider[];
  /** Give up on a chat after waiting this long (the owner answers it). */
  maxWaitMinutes?: number;
}

export interface SimResult {
  chats: number;
  answered: number;
  gaveUp: number;
  waitMinutes: { p50: number; p90: number; max: number };
  byModel: Record<string, number>;
  /** Requests the fake services turned away (busy). */
  turnedAway: number;
  /** Requests accepted past a daily limit. Must be 0. */
  overDailyLimit: number;
  /** Simulated minutes until the last chat was answered. */
  totalMinutes: number;
}

const KEYS = { GROQ_API_KEY: "sim", CLOUDFLARE_ACCOUNT_ID: "0123456789abcdef0123456789abcdef", CLOUDFLARE_AI_TOKEN: "sim" };

interface Limits {
  rpm?: number;
  tpm?: number;
  rpd?: number;
  tpd?: number;
  neuronsPerDay?: number;
  neuronsIn?: number;
  neuronsOut?: number;
}

const GROQ: Limits = { rpm: 30, tpm: 8_000, rpd: 1_000, tpd: 200_000 };
const LIMITS: Record<string, Limits> = {
  "openai/gpt-oss-120b": GROQ,
  "openai/gpt-oss-20b": GROQ,
  "qwen/qwen3.8-27b": GROQ,
  "@cf/openai/gpt-oss-120b": { neuronsPerDay: 10_000, neuronsIn: 31_818, neuronsOut: 68_182 },
  "@cf/openai/gpt-oss-20b": { neuronsPerDay: 10_000, neuronsIn: 18_182, neuronsOut: 27_273 },
};

function pct(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

export async function simulateBurst(opts: SimOptions): Promise<SimResult> {
  const providers = opts.providers ?? configuredProviders(KEYS);
  const tokensOut = opts.tokensOut ?? 250;
  const latency = opts.latencyMs ?? 1_500;
  const maxWait = (opts.maxWaitMinutes ?? 180) * 60_000;
  // 2026-11-24 03:00 UTC = 11 AM Manila, a busy sale morning.
  const t0 = Date.UTC(2026, 10, 24, 3, 0);
  let clock = t0;
  const now = () => new Date(clock);

  const minute = new Map<string, Array<{ at: number; tokens: number }>>();
  const day = new Map<string, { requests: number; tokens: number }>();
  let neurons = 0;
  let turnedAway = 0;
  let overDailyLimit = 0;
  const byModel: Record<string, number> = {};

  const fetchImpl: FetchLike = async (_url, init) => {
    const body = JSON.parse(String(init.body)) as { model: string; messages: Array<{ content: string }> };
    const lim = LIMITS[body.model] ?? {};
    const tokensIn = opts.tokensIn;
    const used = tokensIn + tokensOut;
    const reject = (message: string, retryAfterS?: number) => {
      turnedAway++;
      clock += 150;
      return new Response(JSON.stringify({ error: { message } }), {
        status: 429,
        headers: retryAfterS !== undefined ? { "retry-after": String(Math.ceil(retryAfterS)) } : {},
      });
    };
    if (lim.neuronsPerDay) {
      const cost = (tokensIn * (lim.neuronsIn ?? 0) + tokensOut * (lim.neuronsOut ?? 0)) / 1e6;
      if (neurons + cost > lim.neuronsPerDay) return reject("you have used up your daily free allocation of 10,000 neurons");
      neurons += cost;
    } else {
      const win = (minute.get(body.model) ?? []).filter((w) => clock - w.at < 60_000);
      minute.set(body.model, win);
      const d = day.get(body.model) ?? { requests: 0, tokens: 0 };
      if (lim.rpd && d.requests >= lim.rpd) return reject("Rate limit reached on requests per day (RPD)");
      if (lim.tpd && d.tokens + used > lim.tpd) return reject("Rate limit reached on tokens per day (TPD)");
      if (lim.rpm && win.length >= lim.rpm) return reject("Rate limit reached on requests per minute (RPM)", (60_000 - (clock - win[0].at)) / 1000);
      const inWindow = win.reduce((n, w) => n + w.tokens, 0);
      if (lim.tpm && inWindow + used > lim.tpm) {
        // Wait until enough of the window has rolled off.
        let freed = inWindow;
        let waitS = 60;
        for (const w of win) {
          freed -= w.tokens;
          if (freed + used <= lim.tpm) {
            waitS = (60_000 - (clock - w.at)) / 1000;
            break;
          }
        }
        return reject("Rate limit reached on tokens per minute (TPM)", waitS);
      }
      win.push({ at: clock, tokens: used });
      d.requests++;
      d.tokens += used;
      day.set(body.model, d);
      if ((lim.rpd && d.requests > lim.rpd) || (lim.tpd && d.tokens > lim.tpd)) overDailyLimit++;
    }
    clock += latency;
    byModel[body.model] = (byModel[body.model] ?? 0) + 1;
    return new Response(
      JSON.stringify({ model: body.model, choices: [{ message: { content: "Opo, available po ang COD." }, finish_reason: "stop" }], usage: { prompt_tokens: tokensIn, completion_tokens: tokensOut } }),
      { status: 200 }
    );
  };

  const deps = { providers, store: memoryUsageStore(), fetchImpl, breaker: new Breaker(), now };
  const arrivals = Array.from({ length: opts.chats }, (_, i) => t0 + Math.floor((i * opts.arrivalSeconds * 1000) / Math.max(1, opts.chats)));
  const prompt = [{ role: "user" as const, content: "x".repeat(opts.tokensIn * 3) }];
  const waits: number[] = [];
  let gaveUp = 0;

  for (const arrivedAt of arrivals) {
    if (clock < arrivedAt) clock = arrivedAt;
    for (;;) {
      if (clock - arrivedAt > maxWait) {
        gaveUp++;
        break;
      }
      const r = await complete({ messages: prompt, privacy: "private", reservePct: 15 }, deps);
      if (r.ok) {
        waits.push(clock - arrivedAt);
        break;
      }
      // Every service is busy or out for now: the queue waits a little.
      clock += 15_000;
    }
  }

  const sorted = [...waits].sort((a, b) => a - b);
  const min = (ms: number) => Math.round((ms / 60_000) * 10) / 10;
  return {
    chats: opts.chats,
    answered: waits.length,
    gaveUp,
    waitMinutes: { p50: min(pct(sorted, 0.5)), p90: min(pct(sorted, 0.9)), max: min(sorted[sorted.length - 1] ?? 0) },
    byModel,
    turnedAway,
    overDailyLimit,
    totalMinutes: min(clock - t0),
  };
}
