import { prisma } from "@/lib/prisma";

/**
 * Developer error log. Vercel Hobby keeps runtime logs for 1 hour, so errors
 * land in AppError instead: one row per distinct error, repeats bump `count`.
 * Kept 30 days after the last repeat (see prune.ts).
 */

export type ErrorSource = "server" | "client" | "worker";

export const ERROR_RETENTION_DAYS = 30;
export const MAX_MESSAGE = 500;
export const MAX_STACK = 4_000;
const MAX_ROUTE = 200;
const MAX_UA = 200;

export interface ErrorReport {
  source: ErrorSource;
  message: string;
  stack?: string | null;
  route?: string | null;
  buildId?: string | null;
  actorType?: "OWNER" | "STAFF" | null;
  userAgent?: string | null;
}

/** Replaces ids, numbers and quoted values so the same bug groups together. */
export function normalizeText(s: string): string {
  return s
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<uuid>")
    .replace(/\bc[a-z0-9]{20,30}\b/g, "<id>")
    .replace(/\b[0-9a-f]{16,}\b/gi, "<hex>")
    .replace(/"[^"]{1,200}"|'[^']{1,200}'|“[^”]{1,200}”/g, "<str>")
    // Mixed letter+digit tokens (order numbers like 2411270ABCDEF, tracking codes).
    .replace(/\b(?=[A-Za-z_-]*\d)(?=[\d_-]*[A-Za-z])[A-Za-z0-9_-]{6,}\b/g, "<id>")
    .replace(/\d+/g, "<n>")
    .replace(/\s+/g, " ")
    .trim();
}

/** Same for URL paths: "/returns/ckx…/edit?x=1" → "/returns/<id>/edit". */
export function normalizeRoute(route: string | null | undefined): string | null {
  if (!route) return null;
  const path = route.split(/[?#]/)[0] ?? "";
  return (
    path
      .split("/")
      .map((seg) => (seg && /\d/.test(seg) && seg.length >= 6 ? "<id>" : seg))
      .join("/")
      .slice(0, MAX_ROUTE) || "/"
  );
}

/** First stack frame from our own code, without line/column or chunk hashes (they change every build). */
export function topFrame(stack: string | null | undefined): string {
  if (!stack) return "";
  const lines = stack.split("\n").slice(1).map((l) => l.trim());
  const own = lines.find((l) => l.startsWith("at ") && !/node_modules|node:internal|<anonymous>/.test(l)) ?? lines[0] ?? "";
  return own
    .replace(/:\d+:\d+\)?$/g, "")
    .replace(/[?#].*$/, "")
    .replace(/[-.][0-9a-f]{8,}(?=\.js)/gi, "")
    .replace(/\(|\)/g, "")
    .slice(0, 200);
}

/** FNV-1a, 32-bit, as 8 hex chars. Small and runs anywhere (no node:crypto). */
export function hash32(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function fingerprintError(r: Pick<ErrorReport, "source" | "message" | "stack" | "route">): string {
  const key = [r.source, normalizeRoute(r.route) ?? "", normalizeText(r.message).slice(0, 300), topFrame(r.stack)].join("|");
  return `${r.source}:${hash32(key)}${hash32(key.split("").reverse().join(""))}`;
}

export function errorText(err: unknown): { message: string; stack: string | null } {
  if (err instanceof Error) return { message: `${err.name}: ${err.message}`, stack: err.stack ?? null };
  if (typeof err === "string") return { message: err, stack: null };
  try {
    return { message: JSON.stringify(err).slice(0, MAX_MESSAGE), stack: null };
  } catch {
    return { message: String(err), stack: null };
  }
}

/** Saves (or bumps) an error group. Never throws: logging must not cause a second failure. */
export async function recordError(report: ErrorReport, now: Date = new Date()): Promise<void> {
  try {
    const message = (report.message || "Unknown error").slice(0, MAX_MESSAGE);
    const stack = report.stack ? report.stack.slice(0, MAX_STACK) : null;
    const route = normalizeRoute(report.route);
    const fingerprint = fingerprintError({ source: report.source, message, stack, route });
    const buildId = report.buildId ?? process.env.NEXT_PUBLIC_BUILD_ID ?? null;
    const userAgent = report.userAgent ? report.userAgent.slice(0, MAX_UA) : null;
    await prisma.appError.upsert({
      where: { fingerprint },
      create: {
        fingerprint,
        source: report.source,
        route,
        message,
        stack,
        buildId,
        actorType: report.actorType ?? null,
        lastUserAgent: userAgent,
        firstAt: now,
        lastAt: now,
      },
      update: {
        count: { increment: 1 },
        lastAt: now,
        buildId,
        message,
        ...(stack ? { stack } : {}),
        ...(userAgent ? { lastUserAgent: userAgent } : {}),
        ...(report.actorType ? { actorType: report.actorType } : {}),
      },
    });
  } catch (err) {
    console.error("[dev-errors] could not record", err);
  }
}

export async function pruneAppErrors(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - ERROR_RETENTION_DAYS * 24 * 3600_000);
  const res = await prisma.appError.deleteMany({ where: { lastAt: { lt: cutoff } } });
  return res.count;
}
