import { AsyncLocalStorage } from "node:async_hooks";

/**
 * In-memory collector for one worker tick: step timings and marketplace API
 * call counts. No database access here, so the HTTP and tracing helpers can
 * import it cheaply. tick-recorder.ts writes it out at the end of the tick.
 */

export interface StepTiming {
  name: string;
  ms: number;
  error?: string;
}

export interface ApiCallKey {
  platform: "SHOPEE" | "TIKTOK";
  shopKey: string;
  pathKey: string;
}

export interface ApiCallBucket extends ApiCallKey {
  hour: Date;
  calls: number;
  errors: number;
  throttled: number;
  totalMs: number;
}

export class TickRecorder {
  readonly steps: StepTiming[] = [];
  readonly calls = new Map<string, ApiCallBucket>();
  errors = 0;

  step(name: string, ms: number, error?: string) {
    this.steps.push({ name, ms: Math.round(ms), ...(error ? { error: error.slice(0, 200) } : {}) });
    if (error) this.errors++;
  }

  apiCall(url: string, status: number | null, ms: number, at: Date = new Date()) {
    addApiCall(this.calls, url, status, ms, at);
  }
}

const storage = new AsyncLocalStorage<TickRecorder>();

export function currentRecorder(): TickRecorder | undefined {
  return storage.getStore();
}

export function withTickRecorder<T>(rec: TickRecorder, fn: () => Promise<T>): Promise<T> {
  return storage.run(rec, fn);
}

/** "worker.tick.shopee" → "shopee". */
export function stepName(spanName: string): string {
  return spanName.replace(/^worker\.tick\./, "");
}

/** Which marketplace, shop and endpoint a request URL is for. Null for anything else (Telegram, AI, ...). */
export function classifyApiUrl(raw: string): ApiCallKey | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const platform = host.includes("shopee") ? "SHOPEE" : host.includes("tiktok") ? "TIKTOK" : null;
  if (!platform) return null;
  const shopKey =
    (platform === "SHOPEE" ? url.searchParams.get("shop_id") : url.searchParams.get("shop_cipher")) || "-";
  // TikTok paths carry an API version ("/order/202309/orders"); fold it so versions group.
  const pathKey =
    url.pathname
      .split("/")
      .map((seg) => (/^\d{6,}$/.test(seg) ? "<v>" : seg))
      .join("/")
      .slice(0, 120) || "/";
  return { platform, shopKey: shopKey.slice(0, 80), pathKey };
}

export function hourBucket(at: Date): Date {
  const d = new Date(at.getTime());
  d.setUTCMinutes(0, 0, 0);
  return d;
}

/** Adds one call to the map. `status` null means the request itself failed (network/timeout). */
export function addApiCall(
  into: Map<string, ApiCallBucket>,
  url: string,
  status: number | null,
  ms: number,
  at: Date
): void {
  const key = classifyApiUrl(url);
  if (!key) return;
  const hour = hourBucket(at);
  const id = `${key.platform}|${key.shopKey}|${key.pathKey}|${hour.toISOString()}`;
  const b = into.get(id) ?? { ...key, hour, calls: 0, errors: 0, throttled: 0, totalMs: 0 };
  b.calls++;
  b.totalMs += Math.max(0, Math.round(ms));
  if (status === 429) b.throttled++;
  else if (status === null || status >= 400) b.errors++;
  into.set(id, b);
}

/** Records a marketplace call when inside a tick; a no-op otherwise. */
export function noteApiCall(url: string, status: number | null, ms: number) {
  currentRecorder()?.apiCall(url, status, ms);
}
