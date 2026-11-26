import { isChunkLoadError } from "@/lib/update-check";

/** Client-side error reporting to /api/client-errors (Developer › Errors). Browser only. */

const SAME_ERROR_COOLDOWN_MS = 60_000;
const MAX_PER_PAGE_LOAD = 20;
const recent = new Map<string, number>();
let sent = 0;

/** Pure: errors that aren't ours or aren't actionable. */
export function shouldIgnoreClientError(message: string, stack: string | null): boolean {
  if (!message) return true;
  if (isChunkLoadError(message)) return true; // a new deploy; <UpdatePrompt /> handles it
  if (/ResizeObserver loop|Script error\.?$|Load failed$|NetworkError when attempting|Failed to fetch$/i.test(message)) return true;
  if (/AbortError|The user aborted a request|signal is aborted/i.test(message)) return true;
  if (stack && /chrome-extension:|moz-extension:|safari-extension:/i.test(stack)) return true;
  return false;
}

export function reportClientError(err: unknown, extra?: { digest?: string }) {
  if (typeof window === "undefined") return;
  const message =
    err instanceof Error ? `${err.name}: ${err.message}` : typeof err === "string" ? err : String((err as { message?: unknown })?.message ?? err);
  const stack = err instanceof Error ? (err.stack ?? null) : null;
  if (shouldIgnoreClientError(message, stack)) return;
  const now = Date.now();
  const key = message.slice(0, 200);
  if ((recent.get(key) ?? 0) > now - SAME_ERROR_COOLDOWN_MS || sent >= MAX_PER_PAGE_LOAD) return;
  recent.set(key, now);
  sent++;
  const body = JSON.stringify({
    message: extra?.digest ? `${message} (digest ${extra.digest})` : message,
    stack: stack?.slice(0, 4_000) ?? null,
    route: window.location.pathname,
    buildId: process.env.NEXT_PUBLIC_BUILD_ID || "dev",
  }).slice(0, 8_000);
  try {
    const blob = new Blob([body], { type: "application/json" });
    if (navigator.sendBeacon?.("/api/client-errors", blob)) return;
  } catch {
    // fall through to fetch
  }
  void fetch("/api/client-errors", { method: "POST", body, keepalive: true, headers: { "Content-Type": "application/json" } }).catch(
    () => {}
  );
}
