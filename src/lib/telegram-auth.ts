import crypto from "node:crypto";

/**
 * Verifies Telegram's `x-telegram-bot-api-secret-token` header in constant time.
 * Fails closed when `TELEGRAM_WEBHOOK_SECRET` is missing or empty.
 */
export function verifyTelegramSecret(
  headerToken: string | null | undefined,
  configuredSecret: string | undefined = process.env.TELEGRAM_WEBHOOK_SECRET
): { ok: true } | { ok: false; status: 401 | 503; error: string } {
  const secret = configuredSecret?.trim();
  if (!secret) {
    return { ok: false, status: 503, error: "Telegram webhook secret is not configured." };
  }
  const actual = headerToken?.trim() ?? "";
  if (!actual) {
    return { ok: false, status: 401, error: "Invalid secret token" };
  }
  const expectedBuf = Buffer.from(secret);
  const actualBuf = Buffer.from(actual);
  if (expectedBuf.length !== actualBuf.length || !crypto.timingSafeEqual(expectedBuf, actualBuf)) {
    return { ok: false, status: 401, error: "Invalid secret token" };
  }
  return { ok: true };
}

/** Extracts the pairing code from `/start <code>` or returns null. */
export function parseTelegramStartCode(text: string): string | null {
  const m = text.trim().match(/^\/start(?:@\w+)?(?:\s+([A-Za-z0-9_-]{4,32}))?/i);
  if (!m) return null;
  return m[1] ? m[1].trim() : null;
}

export function isAuthorizedTelegramChat(chatId: string, ownerChatId: string | null | undefined): boolean {
  if (!ownerChatId?.trim() || !chatId.trim()) return false;
  return chatId.trim() === ownerChatId.trim();
}
