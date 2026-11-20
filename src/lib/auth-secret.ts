/**
 * Session signing key. Edge-safe (used by middleware and route handlers).
 *
 * There is deliberately no fallback: a hard-coded default would let anyone
 * forge owner sessions. The old placeholder from .env.example is rejected in
 * production for the same reason.
 */
const KNOWN_PLACEHOLDER = "kyna-ops-dev-secret-change-in-production-32chars";
const MIN_LENGTH = 32;

export function resolveAuthSecret(
  raw: string | undefined,
  nodeEnv: string | undefined
): string {
  const value = raw?.trim();
  if (!value) {
    throw new Error("AUTH_SECRET is not set. Add a random string of 32+ characters to your env.");
  }
  if (value.length < MIN_LENGTH) {
    throw new Error(`AUTH_SECRET must be at least ${MIN_LENGTH} characters.`);
  }
  if (nodeEnv === "production" && value === KNOWN_PLACEHOLDER) {
    throw new Error("AUTH_SECRET is still the example placeholder. Generate a new random value.");
  }
  return value;
}

export function getAuthSecretKey(): Uint8Array {
  return new TextEncoder().encode(resolveAuthSecret(process.env.AUTH_SECRET, process.env.NODE_ENV));
}
