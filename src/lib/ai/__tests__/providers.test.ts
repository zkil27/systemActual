import { describe, expect, it } from "vitest";
import { Breaker } from "../providers/breaker";
import { configuredProviders, type ConfiguredProvider } from "../providers/catalog";
import { allowanceShare, eveningStart, pacedCap, providerDayBounds, providerDayKey } from "../providers/clock";
import { complete } from "../providers";
import { memoryUsageStore, takeBudget, type UsageStore } from "../providers/ledger";
import { classifyFailure, stripThinking, type FetchLike } from "../providers/openai-compatible";

const CF_ACCOUNT = "0123456789abcdef0123456789abcdef";
const ALL_KEYS = {
  GROQ_API_KEY: "gsk_test",
  CLOUDFLARE_ACCOUNT_ID: CF_ACCOUNT,
  CLOUDFLARE_AI_TOKEN: "cf_test",
  OPENROUTER_API_KEY: "or_test",
  GEMINI_API_KEY: "gm_test",
};

type Reply = { status: number; body: unknown; headers?: Record<string, string> } | "timeout";

/** Fake services: answers by model id, records what was asked. */
function fakeFetch(byModel: Record<string, Reply | Reply[]>) {
  const calls: Array<{ url: string; model: string; body: Record<string, unknown>; auth: string }> = [];
  const fn: FetchLike = async (url, init) => {
    const body = JSON.parse(String(init.body));
    const auth = String((init.headers as Record<string, string>).Authorization);
    calls.push({ url, model: body.model, body, auth });
    const entry = byModel[body.model] ?? { status: 500, body: { error: "no fake" } };
    const reply = Array.isArray(entry) ? (entry.shift() ?? { status: 500, body: {} }) : entry;
    if (reply === "timeout") {
      const err = new Error("timed out");
      err.name = "TimeoutError";
      throw err;
    }
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: reply.headers });
  };
  return { fn, calls };
}

const ok = (text: string, model?: string): Reply => ({
  status: 200,
  body: { model, choices: [{ message: { content: text }, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 20 } },
});

const MSG = [{ role: "user" as const, content: "Magkano po shipping?" }];
// 2026-11-24 01:00 UTC = 9 AM Manila, before the evening reserve is released.
const MORNING = new Date("2026-11-24T01:00:00Z");

function deps(fetchImpl: FetchLike, store: UsageStore = memoryUsageStore(), providers?: ConfiguredProvider[]) {
  return { providers: providers ?? configuredProviders(ALL_KEYS), store, fetchImpl, breaker: new Breaker(), now: () => MORNING };
}

describe("configuredProviders", () => {
  it("uses only services with keys, in order", () => {
    expect(configuredProviders({})).toEqual([]);
    expect(configuredProviders(ALL_KEYS).map((p) => p.spec.id)).toEqual(["groq", "cloudflare", "openrouter", "gemini"]);
    expect(configuredProviders({ GEMINI_API_KEY: "x" })[0].models[0].model).toBe("gemini-3.5-flash-lite");
  });

  it("skips Cloudflare when the account id isn't a real one", () => {
    const p = configuredProviders({ CLOUDFLARE_ACCOUNT_ID: "../evil", CLOUDFLARE_AI_TOKEN: "t" });
    expect(p).toEqual([]);
  });

  it("reads OpenRouter models and the Gemini limit from env", () => {
    const p = configuredProviders({ OPENROUTER_API_KEY: "k", OPENROUTER_MODELS: "a:free, b:free", GEMINI_API_KEY: "g", GEMINI_DAILY_REQUESTS: "50" });
    expect(p[0].models.map((m) => m.model)).toEqual(["a:free", "b:free"]);
    expect(p[1].models[0].requestsPerDay).toBe(50);
  });

  it("never lets Gemini free see buyer details", () => {
    const gemini = configuredProviders(ALL_KEYS).find((p) => p.spec.id === "gemini");
    expect(gemini?.spec.privateOk).toBe(false);
  });
});

describe("provider days", () => {
  it("keys the day on the service's own clock", () => {
    const t = new Date("2026-11-24T05:00:00Z");
    expect(providerDayKey("UTC", t)).toBe("2026-11-24");
    expect(providerDayKey("America/Los_Angeles", t)).toBe("2026-11-23");
  });

  it("finds Pacific midnight in winter and summer", () => {
    const winter = providerDayBounds("America/Los_Angeles", new Date("2026-11-24T05:00:00Z"));
    expect(winter.start.toISOString()).toBe("2026-11-23T08:00:00.000Z");
    expect(winter.end.toISOString()).toBe("2026-11-24T08:00:00.000Z");
    const summer = providerDayBounds("America/Los_Angeles", new Date("2026-07-10T12:00:00Z"));
    expect(summer.start.toISOString()).toBe("2026-07-10T07:00:00.000Z");
    const utc = providerDayBounds("UTC", new Date("2026-11-24T23:59:00Z"));
    expect(utc.start.toISOString()).toBe("2026-11-24T00:00:00.000Z");
  });

  it("holds the evening reserve until 6 PM Manila", () => {
    expect(eveningStart("UTC", MORNING).toISOString()).toBe("2026-11-24T10:00:00.000Z");
    expect(allowanceShare("UTC", 15, new Date("2026-11-24T09:59:00Z"))).toBeCloseTo(0.85);
    expect(allowanceShare("UTC", 15, new Date("2026-11-24T10:00:00Z"))).toBe(1);
    // 4 AM Manila is after the evening in the same UTC day.
    expect(allowanceShare("UTC", 15, new Date("2026-11-24T20:00:00Z"))).toBe(1);
    // Gemini's day starts at 4 PM Manila; 5 PM is still before the evening.
    expect(allowanceShare("America/Los_Angeles", 15, new Date("2026-11-24T09:00:00Z"))).toBeCloseTo(0.85);
    expect(allowanceShare("America/Los_Angeles", 15, new Date("2026-11-24T07:00:00Z"))).toBe(1);
  });

  it("keeps at least one request when a cap is small", () => {
    expect(pacedCap(1, 0.85)).toBe(1);
    expect(pacedCap(50, 0.85)).toBe(42);
    expect(pacedCap(0, 1)).toBe(0);
  });
});

describe("usage ledger", () => {
  const [groq, cloudflare, openrouter, gemini] = configuredProviders(ALL_KEYS);

  it("stops at the paced daily request limit", async () => {
    const store = memoryUsageStore();
    const model = { ...gemini.models[0], requestsPerDay: 3 };
    const take = () => takeBudget({ provider: gemini, model, estimateIn: 10, estimateOut: 10, reservePct: 40, now: MORNING, store });
    // Gemini's day: 2026-11-23 Pacific; 1 AM UTC is after 6 PM Manila there, so no reserve.
    expect((await take()).ok).toBe(true);
    expect((await take()).ok).toBe(true);
    expect((await take()).ok).toBe(true);
    expect(await take()).toEqual({ ok: false, reason: "requests" });
  });

  it("doesn't hand out the same last request twice when chats arrive together", async () => {
    const store = memoryUsageStore();
    const results = await Promise.all(
      Array.from({ length: 60 }, () =>
        takeBudget({ provider: openrouter, model: openrouter.models[0], estimateIn: 10, estimateOut: 10, reservePct: 15, now: MORNING, store })
      )
    );
    // 50 a day, 15% held for the evening.
    expect(results.filter((r) => r.ok)).toHaveLength(42);
  });

  it("counts Cloudflare neurons across its models", async () => {
    const store = memoryUsageStore();
    const day = providerDayKey("UTC", MORNING);
    // 120b already used 100k in × 31,818/M + 90k out × 68,182/M ≈ 9,318 neurons; the morning cap is 8,500.
    await store.takeRequest({ provider: "cloudflare", model: "@cf/openai/gpt-oss-120b", dayKey: day });
    await store.addTokens({ provider: "cloudflare", model: "@cf/openai/gpt-oss-120b", dayKey: day }, { tokensIn: 100_000, tokensOut: 90_000, cachedTokens: 0 });
    const r = await takeBudget({ provider: cloudflare, model: cloudflare.models[1], estimateIn: 3_000, estimateOut: 1_000, reservePct: 15, now: MORNING, store });
    expect(r).toEqual({ ok: false, reason: "units" });
    // After 6 PM Manila the reserve is free to use.
    const evening = await takeBudget({ provider: cloudflare, model: cloudflare.models[1], estimateIn: 3_000, estimateOut: 1_000, reservePct: 15, now: new Date("2026-11-24T11:00:00Z"), store });
    expect(evening.ok).toBe(true);
  });

  it("checks Groq's daily tokens per model", async () => {
    const store = memoryUsageStore();
    const day = providerDayKey("UTC", MORNING);
    const key = { provider: "groq", model: groq.models[0].model, dayKey: day };
    await store.takeRequest(key);
    await store.addTokens(key, { tokensIn: 160_000, tokensOut: 10_000, cachedTokens: 0 });
    const r = await takeBudget({ provider: groq, model: groq.models[0], estimateIn: 2_000, estimateOut: 700, reservePct: 15, now: MORNING, store });
    expect(r).toEqual({ ok: false, reason: "tokens" });
    const other = await takeBudget({ provider: groq, model: groq.models[1], estimateIn: 2_000, estimateOut: 700, reservePct: 15, now: MORNING, store });
    expect(other.ok).toBe(true);
  });
});

describe("complete", () => {
  it("answers from the first service that works and counts its tokens", async () => {
    const { fn, calls } = fakeFetch({ "openai/gpt-oss-20b": ok("<think>hmm</think>Opo, may COD po.") });
    const store = memoryUsageStore();
    const r = await complete({ messages: MSG, privacy: "private" }, deps(fn, store));
    expect(r).toMatchObject({ ok: true, text: "Opo, may COD po.", provider: "groq", model: "openai/gpt-oss-20b", tokensIn: 100, tokensOut: 20 });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(calls[0].auth).toBe("Bearer gsk_test");
    expect(calls[0].body).toMatchObject({ reasoning_effort: "low", include_reasoning: false, max_tokens: 650 });
    const row = [...store.rows.values()].find((x) => x.model === "openai/gpt-oss-20b");
    expect(row).toMatchObject({ requests: 1, tokensIn: 100, tokensOut: 20 });
  });

  it("moves on when a service is busy, and rests that model", async () => {
    const busy: Reply = { status: 429, body: { error: { message: "Rate limit reached for requests per minute (RPM)" } }, headers: { "retry-after": "40" } };
    const { fn, calls } = fakeFetch({ "openai/gpt-oss-20b": [busy], "openai/gpt-oss-120b": ok("Sagot") });
    const d = deps(fn);
    const r = await complete({ messages: MSG, privacy: "private" }, d);
    expect(r.ok && r.model).toBe("openai/gpt-oss-120b");
    expect(r.attempts.map((a) => a.outcome)).toEqual(["rate_limit", "ok"]);
    expect(d.breaker.waitMs("groq", "openai/gpt-oss-20b", MORNING.getTime())).toBeGreaterThan(30_000);
    // Next question skips the resting model without calling it.
    await complete({ messages: MSG, privacy: "private" }, d);
    expect(calls.filter((c) => c.model === "openai/gpt-oss-20b")).toHaveLength(1);
  });

  it("skips the rest of a service when its key is wrong", async () => {
    const { fn, calls } = fakeFetch({
      "openai/gpt-oss-20b": { status: 401, body: { error: { message: "Invalid API Key" } } },
      "@cf/openai/gpt-oss-120b": ok("Galing sa Cloudflare"),
    });
    const r = await complete({ messages: MSG, privacy: "private" }, deps(fn));
    expect(r.ok && r.provider).toBe("cloudflare");
    expect(calls.map((c) => c.model)).toEqual(["openai/gpt-oss-20b", "@cf/openai/gpt-oss-120b"]);
  });

  it("treats a used-up shared allowance as the whole service out until its next day", async () => {
    const out: Reply = { status: 429, body: { errors: [{ code: 4006, message: "you have used up your daily free allocation of 10,000 neurons" }] } };
    const groqOnly = configuredProviders({ CLOUDFLARE_ACCOUNT_ID: CF_ACCOUNT, CLOUDFLARE_AI_TOKEN: "t" });
    const { fn, calls } = fakeFetch({ "@cf/openai/gpt-oss-120b": out });
    const d = deps(fn, memoryUsageStore(), groqOnly);
    const r = await complete({ messages: MSG, privacy: "private" }, d);
    expect(r).toMatchObject({ ok: false, reason: "quota_out" });
    expect(calls).toHaveLength(1);
    expect(d.breaker.waitMs("cloudflare", "@cf/openai/gpt-oss-20b", MORNING.getTime())).toBe(
      new Date("2026-11-25T00:00:00Z").getTime() - MORNING.getTime()
    );
  });

  it("keeps buyer details away from Gemini free", async () => {
    const geminiOnly = configuredProviders({ GEMINI_API_KEY: "g" });
    const { fn, calls } = fakeFetch({ "gemini-3.5-flash-lite": ok("General answer") });
    const priv = await complete({ messages: MSG, privacy: "private" }, deps(fn, memoryUsageStore(), geminiOnly));
    expect(priv).toMatchObject({ ok: false, reason: "no_private" });
    expect(calls).toHaveLength(0);
    const gen = await complete({ messages: MSG, privacy: "general" }, deps(fn, memoryUsageStore(), geminiOnly));
    expect(gen.ok && gen.provider).toBe("gemini");
  });

  it("asks OpenRouter only for providers that don't collect data", async () => {
    const orOnly = configuredProviders({ OPENROUTER_API_KEY: "k" });
    const { fn, calls } = fakeFetch({ "google/gemma-4-31b-it:free": ok("Hi po") });
    await complete({ messages: MSG, privacy: "private" }, deps(fn, memoryUsageStore(), orOnly));
    expect(calls[0].body.provider).toEqual({ data_collection: "deny" });
  });

  it("gives up on a slow service and tries the next", async () => {
    const { fn } = fakeFetch({ "openai/gpt-oss-20b": "timeout", "openai/gpt-oss-120b": ok("Mabilis") });
    const r = await complete({ messages: MSG, privacy: "private" }, deps(fn));
    expect(r.ok && r.text).toBe("Mabilis");
    expect(r.attempts[0].outcome).toBe("timeout");
  });

  it("says no keys when nothing is set up", async () => {
    const { fn } = fakeFetch({});
    expect(await complete({ messages: MSG, privacy: "private" }, deps(fn, memoryUsageStore(), []))).toMatchObject({ ok: false, reason: "no_keys" });
  });

  it("doesn't call anything when usage can't be counted", async () => {
    const { fn, calls } = fakeFetch({ "openai/gpt-oss-20b": ok("x") });
    const broken: UsageStore = {
      takeRequest: async () => {
        throw new Error("db down");
      },
      addTokens: async () => {},
      addError: async () => {},
      read: async () => {
        throw new Error("db down");
      },
    };
    const r = await complete({ messages: MSG, privacy: "private" }, deps(fn, broken));
    expect(r).toMatchObject({ ok: false, reason: "quota_out" });
    expect(calls).toHaveLength(0);
  });

  it("reports failed when every service errors", async () => {
    // The fake answers 500 for every model it doesn't know.
    const { fn } = fakeFetch({});
    const r = await complete({ messages: MSG, privacy: "general" }, deps(fn));
    expect(r).toMatchObject({ ok: false, reason: "failed" });
    expect(r.attempts.length).toBeGreaterThan(3);
  });

  it("counts an empty reply as a failure but keeps its tokens", async () => {
    const empty: Reply = { status: 200, body: { choices: [{ message: { content: "<think>long</think>" }, finish_reason: "length" }], usage: { prompt_tokens: 50, completion_tokens: 650 } } };
    const store = memoryUsageStore();
    const { fn } = fakeFetch({ "openai/gpt-oss-20b": empty, "openai/gpt-oss-120b": ok("Ayos") });
    const r = await complete({ messages: MSG, privacy: "private" }, deps(fn, store));
    expect(r.ok).toBe(true);
    const row = [...store.rows.values()].find((x) => x.model === "openai/gpt-oss-20b");
    expect(row).toMatchObject({ requests: 1, errors: 1, tokensOut: 650 });
  });
});

describe("failure kinds", () => {
  it("tells a daily limit from a short burst", () => {
    expect(classifyFailure(429, "Rate limit reached ... on requests per day (RPD)")).toBe("daily_limit");
    expect(classifyFailure(429, "Rate limit exceeded: free-models-per-day")).toBe("daily_limit");
    expect(classifyFailure(429, "Rate limit reached ... tokens per minute (TPM)")).toBe("rate_limit");
    expect(classifyFailure(404, "")).toBe("unavailable");
    expect(classifyFailure(400, "No endpoints found matching your data policy")).toBe("unavailable");
    expect(classifyFailure(503, "")).toBe("server");
  });

  it("strips thinking from replies", () => {
    expect(stripThinking("<think>a\nb</think>\nSagot po")).toBe("Sagot po");
    expect(stripThinking("left over thinking</think>Sagot")).toBe("Sagot");
    expect(stripThinking("Walang think")).toBe("Walang think");
  });
});
