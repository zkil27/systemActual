import crypto from "crypto";

/**
 * The worker tick is called by the warehouse PC agent with
 * `Authorization: Bearer <WORKER_SECRET>`. Fails closed if the secret is unset.
 */
export function isWorkerAuthorized(authorizationHeader: string | null, secret = process.env.WORKER_SECRET): boolean {
  const expected = secret?.trim();
  if (!expected || expected.length < 32 || !authorizationHeader) return false;
  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader.trim());
  if (!match) return false;
  const a = Buffer.from(match[1]);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
