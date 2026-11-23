import { describe, expect, it } from "vitest";
import {
  isAuthorizedTelegramChat,
  parseTelegramStartCode,
  verifyTelegramSecret,
} from "@/lib/telegram-auth";

describe("verifyTelegramSecret", () => {
  it("fails closed when TELEGRAM_WEBHOOK_SECRET is unset", () => {
    const res = verifyTelegramSecret("anything", "");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(503);
  });

  it("rejects missing or mismatched secret headers", () => {
    const missing = verifyTelegramSecret(null, "top-secret-token");
    expect(missing).toEqual({ ok: false, status: 401, error: "Invalid secret token" });

    const wrong = verifyTelegramSecret("wrong-token", "top-secret-token");
    expect(wrong).toEqual({ ok: false, status: 401, error: "Invalid secret token" });
  });

  it("accepts matching secret headers", () => {
    expect(verifyTelegramSecret("top-secret-token", "top-secret-token")).toEqual({ ok: true });
  });
});

describe("parseTelegramStartCode", () => {
  it("extracts one-time pairing codes from /start", () => {
    expect(parseTelegramStartCode("/start AB12CD34")).toBe("AB12CD34");
    expect(parseTelegramStartCode("/start@KynaOpsBot PAIR_99")).toBe("PAIR_99");
    expect(parseTelegramStartCode("/start")).toBeNull();
    expect(parseTelegramStartCode("/today")).toBeNull();
  });
});

describe("isAuthorizedTelegramChat", () => {
  it("allows only the configured owner chat ID", () => {
    expect(isAuthorizedTelegramChat("123456", "123456")).toBe(true);
    expect(isAuthorizedTelegramChat("999999", "123456")).toBe(false);
    expect(isAuthorizedTelegramChat("123456", null)).toBe(false);
  });
});
