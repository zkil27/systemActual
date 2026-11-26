import { noteApiCall } from "@/lib/dev/tick-context";

export class MarketplaceHttpError extends Error {
  readonly status: number;
  readonly retryAfterMs: number | null;
  readonly retryable: boolean;
  readonly bodyPreview?: string;

  constructor(
    message: string,
    opts: {
      status: number;
      retryAfterMs?: number | null;
      retryable?: boolean;
      bodyPreview?: string;
    }
  ) {
    super(message);
    this.name = "MarketplaceHttpError";
    this.status = opts.status;
    this.retryAfterMs = opts.retryAfterMs ?? null;
    this.retryable = Boolean(opts.retryable);
    this.bodyPreview = opts.bodyPreview;
  }
}

export function parseRetryAfterMs(
  header: string | null | undefined,
  nowMs: number = Date.now(),
  maxMs: number = 5_000
): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (!trimmed) return null;

  const secs = Number(trimmed);
  if (Number.isFinite(secs) && secs >= 0) {
    return Math.min(maxMs, Math.round(secs * 1000));
  }

  const parsed = Date.parse(trimmed);
  if (Number.isFinite(parsed)) {
    return Math.min(maxMs, Math.max(0, parsed - nowMs));
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export async function safeReadJson(
  res: Response
): Promise<{ json: Record<string, unknown> | null; text: string }> {
  const anyRes = res as Partial<Response>;
  if (typeof anyRes.text === "function") {
    const text = await anyRes.text().catch(() => "");
    if (!text) return { json: null, text: "" };
    try {
      return { json: asRecord(JSON.parse(text)), text };
    } catch {
      return { json: null, text };
    }
  }
  if (typeof anyRes.json === "function") {
    try {
      return { json: asRecord(await anyRes.json()), text: "" };
    } catch {
      return { json: null, text: "" };
    }
  }
  return { json: null, text: "" };
}

const TRANSIENT_GET_STATUSES = new Set([502, 503, 504]);

function isRetryableNetworkError(err: unknown): boolean {
  return err instanceof TypeError;
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  opts?: {
    fetchFn?: typeof fetch;
    maxRetries?: number;
    baseDelayMs?: number;
    sleep?: (ms: number) => Promise<void>;
  }
): Promise<Response> {
  const fetchFn = opts?.fetchFn ?? fetch;
  const maxRetries = opts?.maxRetries ?? 2;
  const baseDelayMs = opts?.baseDelayMs ?? 400;
  const sleep = opts?.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const method = (init.method ?? "GET").toUpperCase();

  for (let attempt = 0; ; attempt++) {
    let res: Response;
    const callStarted = Date.now();
    try {
      res = await fetchFn(url, init);
    } catch (err) {
      noteApiCall(url, null, Date.now() - callStarted);
      if (attempt < maxRetries && method === "GET" && isRetryableNetworkError(err)) {
        await sleep(Math.min(4_000, baseDelayMs * 2 ** attempt));
        continue;
      }
      throw err;
    }

    const status = typeof res.status === "number" ? res.status : res.ok ? 200 : 500;
    // Counted per attempt (inside worker ticks only) for the Developer screen's API stats.
    noteApiCall(url, status, Date.now() - callStarted);
    if (attempt < maxRetries) {
      if (status === 429) {
        const retryAfterMs = parseRetryAfterMs(res.headers?.get?.("retry-after"));
        await sleep(retryAfterMs ?? Math.min(4_000, baseDelayMs * 2 ** attempt));
        continue;
      }
      if (method === "GET" && TRANSIENT_GET_STATUSES.has(status)) {
        await sleep(Math.min(4_000, baseDelayMs * 2 ** attempt));
        continue;
      }
    }
    return res;
  }
}

export async function readMarketplaceJson(
  res: Response,
  label: string
): Promise<Record<string, unknown>> {
  const status = typeof res.status === "number" ? res.status : res.ok ? 200 : 500;
  const retryAfterMs = parseRetryAfterMs(res.headers?.get?.("retry-after"));
  const { json, text } = await safeReadJson(res);
  if (!json) {
    throw new MarketplaceHttpError(`${label} returned HTTP ${status} (non-JSON)`, {
      status,
      retryAfterMs,
      retryable: status === 429 || status >= 500,
      bodyPreview: text.slice(0, 200),
    });
  }
  return json;
}

export function throwMarketplaceError(res: Response, message: string): never {
  const status = typeof res.status === "number" ? res.status : res.ok ? 200 : 500;
  const retryAfterMs = parseRetryAfterMs(res.headers?.get?.("retry-after"));
  const fullMessage = status === 429 && !/429|too many|rate limit/i.test(message)
    ? `${message} (HTTP 429)`
    : message;
  throw new MarketplaceHttpError(fullMessage, {
    status,
    retryAfterMs,
    retryable: status === 429 || status >= 500,
  });
}
