import crypto from "node:crypto";
import { resolveAuthSecret } from "@/lib/auth-secret";

const PREFIX = "enc:v1:";

function getEncryptionKey(): Buffer {
  const custom = process.env.TOKEN_ENCRYPTION_KEY?.trim();
  const seed = custom && custom.length >= 32
    ? custom
    : resolveAuthSecret(process.env.AUTH_SECRET, process.env.NODE_ENV);
  return crypto.createHash("sha256").update(`kyna-ops:tokens:${seed}`).digest();
}

/**
 * Encrypts a sensitive secret (shop access token, refresh token, or cipher)
 * using AES-256-GCM. Output starts with `enc:v1:`.
 */
export function encryptSecret(plain: string): string {
  if (!plain) return plain;
  if (plain.startsWith(PREFIX)) return plain;
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64url")}:${tag.toString("base64url")}:${ciphertext.toString("base64url")}`;
}

/**
 * Decrypts a value encrypted with `encryptSecret`. Transparently returns legacy
 * plaintext values that do not have the `enc:v1:` prefix so existing rows keep working.
 */
export function decryptSecret(stored: string): string;
export function decryptSecret(stored: string | null | undefined): string | null;
export function decryptSecret(stored: string | null | undefined): string | null {
  if (!stored) return stored ?? null;
  if (!stored.startsWith(PREFIX)) return stored;
  const parts = stored.slice(PREFIX.length).split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted token format.");
  }
  const [ivB64, tagB64, ctB64] = parts;
  const iv = Buffer.from(ivB64, "base64url");
  const tag = Buffer.from(tagB64, "base64url");
  const ciphertext = Buffer.from(ctB64, "base64url");
  const key = getEncryptionKey();
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
