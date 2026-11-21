import crypto from "crypto";
import { prisma } from "@/lib/prisma";

/**
 * The warehouse PC proves who it is with a long random token. Only its
 * SHA-256 is stored, so a database leak doesn't give out a working token.
 */
export const DEVICE_TOKEN_PREFIX = "kpd_";
/** The agent polls every few seconds; quiet for 2 minutes means the PC is off or offline. */
export const ONLINE_WINDOW_MS = 2 * 60_000;

export function newDeviceToken(): { token: string; hash: string } {
  const token = DEVICE_TOKEN_PREFIX + crypto.randomBytes(24).toString("base64url");
  return { token, hash: hashDeviceToken(token) };
}

export function hashDeviceToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** "Bearer kpd_..." → token, or null. */
export function bearerDeviceToken(header: string | null | undefined): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec((header ?? "").trim());
  const token = match?.[1] ?? "";
  return token.startsWith(DEVICE_TOKEN_PREFIX) && token.length >= 30 ? token : null;
}

export async function deviceFromAuthHeader(header: string | null | undefined) {
  const token = bearerDeviceToken(header);
  if (!token) return null;
  return prisma.printDevice.findUnique({ where: { tokenHash: hashDeviceToken(token) } });
}

export function isOnline(lastSeenAt: Date | null, now: Date = new Date()): boolean {
  return Boolean(lastSeenAt && now.getTime() - lastSeenAt.getTime() < ONLINE_WINDOW_MS);
}
