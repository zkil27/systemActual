import type { ConfiguredProvider, ModelSpec } from "./catalog";

/**
 * One call to an OpenAI-style /chat/completions endpoint. Groq, Cloudflare,
 * OpenRouter and Gemini all accept this format. Never throws.
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export type FailureKind =
  | "rate_limit" // too many right now, try again soon
  | "daily_limit" // free allowance used up until the service's next day
  | "auth" // key missing, wrong or not allowed
  | "unavailable" // model gone, or no provider matches the privacy rules
  | "bad_request"
  | "server"
  | "timeout"
  | "network"
  | "empty"; // answered with nothing usable

export type CallResult =
  | {
      ok: true;
      text: string;
      tokensIn: number;
      tokensOut: number;
      cachedTokens: number;
      /** Model that answered (OpenRouter may pick a fallback). */
      model: string;
      latencyMs: number;
    }
  | {
      ok: false;
      kind: FailureKind;
      status?: number;
      retryAfterMs?: number;
      /** Short service message for the health check. Never includes the prompt or key. */
      detail?: string;
      /** Tokens the service still counted (e.g. an empty reply). */
      tokensIn?: number;
      tokensOut?: number;
      latencyMs: number;
    };

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

const DAILY = /per[\s_-]?day|daily|PerDay|\bRPD\b|\bTPD\b|free-models-per-day|neurons/i;

/** Removes thinking some models leave in the reply. */
export function stripThinking(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^[\s\S]*?<\/think>/i, "")
    .trim();
}

function retryAfter(res: Response): number | undefined {
  const raw = res.headers.get("retry-after");
  if (!raw) return undefined;
  const secs = Number(raw);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : undefined;
}

function short(text: string): string {
  return text.replace(/\s+/g, " ").slice(0, 200);
}

export function classifyFailure(status: number, body: string, res?: Response): FailureKind {
  if (status === 429) {
    const outOfDay = DAILY.test(body) || res?.headers.get("x-ratelimit-remaining-requests") === "0";
    return outOfDay ? "daily_limit" : "rate_limit";
  }
  if (status === 401 || status === 403) return "auth";
  if (status === 402) return "daily_limit"; // OpenRouter: free use needs credits / limit reached
  if (status === 404) return "unavailable";
  if (status === 400 || status === 422) {
    return /model|endpoint|data policy|not (found|available|supported)/i.test(body) ? "unavailable" : "bad_request";
  }
  if (status >= 500) return "server";
  return "bad_request";
}

export async function callChat(opts: {
  provider: ConfiguredProvider;
  model: ModelSpec;
  messages: ChatMessage[];
  maxTokens: number;
  temperature: number;
  timeoutMs: number;
  fetchImpl?: FetchLike;
}): Promise<CallResult> {
  const { provider, model } = opts;
  const started = Date.now();
  const elapsed = () => Date.now() - started;
  const body = {
    ...provider.extra,
    ...model.extra,
    model: model.model,
    messages: opts.messages,
    max_tokens: opts.maxTokens + (model.thinkingTokens ?? 0),
    temperature: opts.temperature,
    stream: false,
  };

  let res: Response;
  try {
    res = await (opts.fetchImpl ?? fetch)(`${provider.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${provider.apiKey}`,
        ...provider.headers,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeoutMs),
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    return { ok: false, kind: name === "TimeoutError" || name === "AbortError" ? "timeout" : "network", latencyMs: elapsed() };
  }

  let raw = "";
  try {
    raw = await res.text();
  } catch {
    return { ok: false, kind: "network", status: res.status, latencyMs: elapsed() };
  }

  if (!res.ok) {
    return {
      ok: false,
      kind: classifyFailure(res.status, raw, res),
      status: res.status,
      retryAfterMs: retryAfter(res),
      detail: short(raw),
      latencyMs: elapsed(),
    };
  }

  let json: {
    model?: string;
    choices?: Array<{ message?: { content?: unknown }; finish_reason?: string }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
    error?: { message?: string; code?: unknown };
  };
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, kind: "server", status: res.status, detail: "Reply wasn't JSON", latencyMs: elapsed() };
  }
  // OpenRouter can return 200 with an error inside.
  if (json.error) {
    const code = typeof json.error.code === "number" ? json.error.code : 502;
    const message = json.error.message ?? "";
    return { ok: false, kind: classifyFailure(code, message), status: code, detail: short(message), latencyMs: elapsed() };
  }

  const content = json.choices?.[0]?.message?.content;
  const text = typeof content === "string" ? stripThinking(content) : "";
  const usage = {
    tokensIn: json.usage?.prompt_tokens ?? 0,
    tokensOut: json.usage?.completion_tokens ?? 0,
    cachedTokens: json.usage?.prompt_tokens_details?.cached_tokens ?? 0,
  };
  if (!text) {
    const why = json.choices?.[0]?.finish_reason === "length" ? "Ran out of room before answering" : "No reply text";
    return { ok: false, kind: "empty", status: res.status, detail: why, ...usage, latencyMs: elapsed() };
  }
  return { ok: true, text, ...usage, model: json.model || model.model, latencyMs: elapsed() };
}
