import crypto from "crypto";
import { prisma } from "@/lib/prisma";

/**
 * The warehouse PC proves who it is with a long random token. Only its
 * SHA-256 is stored, so a database leak doesn't give out a working token.
 */
export const DEVICE_TOKEN_PREFIX = "kpd_";
/** The agent polls adaptively (up to every 30s when idle); quiet for 3 minutes means the PC is off or offline. */
export const ONLINE_WINDOW_MS = 3 * 60_000;

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

/** The agent's nightly pg_dump result. Null when the agent doesn't report backups. */
export function parseBackupReport(raw: unknown): {
  lastBackupAt: Date | null;
  lastBackupError: string | null;
  lastBackupBytes: number | null;
} | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.enabled === false) return null;
  const at = typeof r.lastBackupAt === "string" ? new Date(r.lastBackupAt) : null;
  const bytes = Number(r.lastBackupBytes);
  return {
    lastBackupAt: at && !Number.isNaN(at.getTime()) ? at : null,
    lastBackupError: typeof r.lastBackupError === "string" ? r.lastBackupError.slice(0, 300) : null,
    lastBackupBytes: Number.isFinite(bytes) && bytes > 0 ? Math.min(2_000_000_000, Math.floor(bytes)) : null,
  };
}
