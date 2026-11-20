/**
 * Paths that load without an owner session. Kept separate from middleware so
 * it can be unit tested in the node environment.
 */
const PUBLIC_PREFIXES = [
  "/login",
  "/scan",
  "/uploads/",
  "/icons/",
  "/api/auth/",
  "/api/scan/",
  "/api/webhooks/",
  "/api/telegram/",
  "/api/schedules/",
  "/api/oauth/",
  "/_next/",
];

/** Exact paths. The phone fetches these before anyone signs in. */
const PUBLIC_EXACT = new Set([
  "/manifest.webmanifest",
  "/favicon.ico",
  "/icon",
  "/apple-icon",
]);

export function isPublicPath(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}
