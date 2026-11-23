/**
 * Paths that load without an owner session. Kept separate from middleware so
 * it can be unit tested in the node environment.
 */
const PUBLIC_PREFIXES = [
  "/login",
  "/scan",
  // Staff screens: checked against the staff PIN session in the route.
  "/stock-in",
  "/api/stock-in",
  "/api/proofs/",
  "/icons/",
  "/api/auth/",
  "/api/scan/",
  "/api/webhooks/",
  "/api/telegram/",
  "/api/oauth/",
  // Authenticated by WORKER_SECRET or the printer PC's device token in the route.
  "/api/worker/",
  "/api/agent/",
  "/_next/",
];

/** Exact paths. The phone fetches these before anyone signs in. */
const PUBLIC_EXACT = new Set([
  "/manifest.webmanifest",
  "/favicon.ico",
  "/icon",
  "/apple-icon",
  // Build ID + release notes; every open app polls it, signed in or not.
  "/api/version",
]);

export function isPublicPath(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}
