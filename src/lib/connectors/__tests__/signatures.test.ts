import crypto from "crypto";
import { describe, expect, it } from "vitest";
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
