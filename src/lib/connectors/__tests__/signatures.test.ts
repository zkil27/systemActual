import crypto from "crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyShopeeWebhookSignature } from "@/lib/connectors/shopee";
import { verifyTikTokWebhookSignature } from "@/lib/connectors/tiktok";

describe("Marketplace webhook HMAC-SHA256 verification", () => {
  it("accepts valid Shopee webhook signature and rejects tampered payload", () => {
    const webhookUrl = "https://kyna-ops.vercel.app/api/webhooks/shopee";
    const rawBody = JSON.stringify({ code: 3, shop_id: 12345, data: { ordersn: "261120ABC" } });
    const partnerKey = "test-shopee-partner-key";
    const validSig = crypto
      .createHmac("sha256", partnerKey)
      .update(`${webhookUrl}|${rawBody}`)
      .digest("hex");

    expect(
      verifyShopeeWebhookSignature({
        webhookUrl,
        rawBody,
        signatureHeader: validSig,
        partnerKey,
      })
    ).toBe(true);

    expect(
      verifyShopeeWebhookSignature({
        webhookUrl,
        rawBody: rawBody + " ",
        signatureHeader: validSig,
        partnerKey,
      })
    ).toBe(false);
  });

  it("accepts valid TikTok raw-body signature and rejects tampered payload", () => {
    const appKey = "test-tiktok-app-key";
    const appSecret = "test-tiktok-app-secret";
    const rawBody = JSON.stringify({ type: 1, shop_id: "9988", data: { order_id: "579410" } });
    const validSig = crypto
      .createHmac("sha256", appSecret)
      .update(`${appKey}${rawBody}`)
      .digest("hex");

    expect(
      verifyTikTokWebhookSignature({
        rawBody,
        authorizationHeader: validSig,
        appKey,
        appSecret,
      })
    ).toBe(true);

    expect(
      verifyTikTokWebhookSignature({
        rawBody: rawBody.replace("579410", "999999"),
        authorizationHeader: validSig,
        appKey,
        appSecret,
      })
    ).toBe(false);
  });
});

describe("Webhook verification fails closed when keys are missing", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("accepts a Shopee push signed with SHOPEE_PUSH_PARTNER_KEY", () => {
    vi.stubEnv("SHOPEE_PARTNER_KEY", "api-key");
    vi.stubEnv("SHOPEE_PUSH_PARTNER_KEY", "push-key");
    const webhookUrl = "https://kyna-ops.vercel.app/api/webhooks/shopee";
    const rawBody = JSON.stringify({ code: 0, shop_id: 12345 });
    const sigWithPushKey = crypto.createHmac("sha256", "push-key").update(`${webhookUrl}|${rawBody}`).digest("hex");
    expect(verifyShopeeWebhookSignature({ webhookUrl, rawBody, signatureHeader: sigWithPushKey })).toBe(true);
  });

  it("rejects a Shopee push when SHOPEE_PARTNER_KEY and SHOPEE_PUSH_PARTNER_KEY are not set", () => {
    vi.stubEnv("SHOPEE_PARTNER_KEY", "");
    vi.stubEnv("SHOPEE_PUSH_PARTNER_KEY", "");
    const rawBody = JSON.stringify({ code: 3, shop_id: 1 });
    // Even a signature computed with an empty key must not pass.
    const sigWithEmptyKey = crypto.createHmac("sha256", "").update(`u|${rawBody}`).digest("hex");
    expect(
      verifyShopeeWebhookSignature({ webhookUrl: "u", rawBody, signatureHeader: sigWithEmptyKey })
    ).toBe(false);
  });

  it("rejects a TikTok webhook when TIKTOK_APP_KEY / SECRET are not set", () => {
    vi.stubEnv("TIKTOK_APP_KEY", "");
    vi.stubEnv("TIKTOK_APP_SECRET", "");
    const rawBody = JSON.stringify({ type: 1 });
    const sigWithEmptyKey = crypto.createHmac("sha256", "").update(rawBody).digest("hex");
    expect(
      verifyTikTokWebhookSignature({ rawBody, authorizationHeader: sigWithEmptyKey })
    ).toBe(false);
  });

  it("rejects a missing signature header even with keys set", () => {
    expect(
      verifyShopeeWebhookSignature({ webhookUrl: "u", rawBody: "{}", signatureHeader: null, partnerKey: "k" })
    ).toBe(false);
    expect(
      verifyTikTokWebhookSignature({ rawBody: "{}", authorizationHeader: undefined, appKey: "a", appSecret: "s" })
    ).toBe(false);
  });
});
