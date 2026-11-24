/**
 * The free AI services the Chats assistant may use, in the order it tries them.
 * Every one is free; a service is only used when its key is set.
 *
 * Limits checked 2026-11-24:
 * - Groq free: per model 30 req/min, 1,000 req/day, 8K tokens/min, 200K tokens/day.
 *   console.groq.com/docs/rate-limits. Turn on Zero Data Retention in the Groq console.
 * - Cloudflare Workers AI free: 10,000 neurons/day for the whole account, resets 00:00 UTC.
 *   gpt-oss models there are zero data retention. developers.cloudflare.com/workers-ai/platform/pricing
 * - OpenRouter free models: 50 req/day (no credits bought), 20 req/min. Free models come and
 *   go, so they're set in OPENROUTER_MODELS. Requests ask for providers that don't collect data.
 * - Gemini free: per-project limits shown in AI Studio, reset at midnight Pacific. Google may
 *   use free-tier content, so it only gets general questions with no buyer details.
 */

export type ProviderId = "groq" | "cloudflare" | "openrouter" | "gemini";

export interface ProviderSpec {
  id: ProviderId;
  label: string;
  /** Clock the provider's daily limits reset on. */
  dayZone: "UTC" | "America/Los_Angeles";
  /** May see buyer chats and order details (doesn't train on or keep them). */
  privateOk: boolean;
  /** Daily limits shared by all of the provider's models. */
  shared?: { requestsPerDay?: number; unitsPerDay?: number };
}

export interface ModelSpec {
  provider: ProviderId;
  /** Id sent to the API. */
  model: string;
  requestsPerDay?: number;
  tokensPerDay?: number;
  /** Cost in the provider's shared units (Cloudflare neurons) per million tokens. */
  unitsPerMIn?: number;
  unitsPerMOut?: number;
  /** Extra request fields, e.g. reasoning controls. */
  extra?: Record<string, unknown>;
  /** Room for the model's thinking on top of the reply length. */
  thinkingTokens?: number;
}

export interface ConfiguredProvider {
  spec: ProviderSpec;
  baseUrl: string;
  apiKey: string;
  headers?: Record<string, string>;
  /** Extra fields sent with every request to this provider. */
  extra?: Record<string, unknown>;
  models: ModelSpec[];
}

export const PROVIDERS: Record<ProviderId, ProviderSpec> = {
  groq: { id: "groq", label: "Groq", dayZone: "UTC", privateOk: true },
  cloudflare: {
    id: "cloudflare",
    label: "Cloudflare",
    dayZone: "UTC",
    privateOk: true,
    shared: { unitsPerDay: 10_000 },
  },
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    dayZone: "UTC",
    privateOk: true,
    shared: { requestsPerDay: 50 },
  },
  gemini: { id: "gemini", label: "Gemini", dayZone: "America/Los_Angeles", privateOk: false },
};

const GROQ_LIMITS = { requestsPerDay: 1_000, tokensPerDay: 200_000 };
const GPT_OSS_GROQ = { reasoning_effort: "low", include_reasoning: false };

export const DEFAULT_OPENROUTER_MODELS = ["google/gemma-4-31b-it:free", "openrouter/free"];
export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";
export const DEFAULT_GEMINI_DAILY_REQUESTS = 20;

function list(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

type Env = Record<string, string | undefined>;

/** Services with keys, in the order to try them. Never logs or returns keys elsewhere. */
export function configuredProviders(env: Env = process.env): ConfiguredProvider[] {
  const out: ConfiguredProvider[] = [];

  const groqKey = env.GROQ_API_KEY?.trim();
  if (groqKey) {
    out.push({
      spec: PROVIDERS.groq,
      baseUrl: "https://api.groq.com/openai/v1",
      apiKey: groqKey,
      models: [
        { provider: "groq", model: "openai/gpt-oss-20b", ...GROQ_LIMITS, extra: GPT_OSS_GROQ, thinkingTokens: 300 },
        { provider: "groq", model: "openai/gpt-oss-120b", ...GROQ_LIMITS, extra: GPT_OSS_GROQ, thinkingTokens: 300 },
        { provider: "groq", model: "qwen/qwen3.8-27b", ...GROQ_LIMITS, extra: { reasoning_effort: "none" } },
      ],
    });
  }

  const cfAccount = env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const cfToken = env.CLOUDFLARE_AI_TOKEN?.trim();
  if (cfAccount && cfToken && /^[a-f0-9]{32}$/i.test(cfAccount)) {
    out.push({
      spec: PROVIDERS.cloudflare,
      baseUrl: `https://api.cloudflare.com/client/v4/accounts/${cfAccount}/ai/v1`,
      apiKey: cfToken,
      models: [
        // Reasoning can't be turned down here, so leave room for it.
        { provider: "cloudflare", model: "@cf/openai/gpt-oss-120b", unitsPerMIn: 31_818, unitsPerMOut: 68_182, thinkingTokens: 700 },
        { provider: "cloudflare", model: "@cf/openai/gpt-oss-20b", unitsPerMIn: 18_182, unitsPerMOut: 27_273, thinkingTokens: 700 },
      ],
    });
  }

  const orKey = env.OPENROUTER_API_KEY?.trim();
  if (orKey) {
    const models = list(env.OPENROUTER_MODELS);
    out.push({
      spec: PROVIDERS.openrouter,
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: orKey,
      headers: { "X-Title": "Kyna Ops" },
      // Only providers that don't store or train on prompts.
      extra: { provider: { data_collection: "deny" } },
      models: (models.length ? models : DEFAULT_OPENROUTER_MODELS).map((model) => ({
        provider: "openrouter" as const,
        model,
        thinkingTokens: 300,
      })),
    });
  }

  const geminiKey = env.GEMINI_API_KEY?.trim();
  if (geminiKey) {
    out.push({
      spec: PROVIDERS.gemini,
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      apiKey: geminiKey,
      models: [
        {
          provider: "gemini",
          model: env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL,
          requestsPerDay: positiveInt(env.GEMINI_DAILY_REQUESTS, DEFAULT_GEMINI_DAILY_REQUESTS),
          thinkingTokens: 300,
        },
      ],
    });
  }

  return out;
}

/** Which keys are set, for the health check and settings page. Never includes the keys. */
export function providerKeyStatus(env: Env = process.env): Record<ProviderId, boolean> {
  return {
    groq: Boolean(env.GROQ_API_KEY?.trim()),
    cloudflare: Boolean(env.CLOUDFLARE_ACCOUNT_ID?.trim() && env.CLOUDFLARE_AI_TOKEN?.trim()),
    openrouter: Boolean(env.OPENROUTER_API_KEY?.trim()),
    gemini: Boolean(env.GEMINI_API_KEY?.trim()),
  };
}
