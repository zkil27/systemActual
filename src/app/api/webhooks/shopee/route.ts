import { NextRequest, NextResponse, after } from "next/server";
import { shopeeWebhookUrl, verifyShopeeWebhookSignature } from "@/lib/connectors/shopee";
import { runTick } from "@/lib/worker/tick";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("authorization");

  // Always verify (fail closed). Without SHOPEE_PARTNER_KEY every push is rejected.
  const valid = verifyShopeeWebhookSignature({
    webhookUrl: shopeeWebhookUrl(req.url),
    rawBody,
    signatureHeader: signature,
  });
  if (!valid) {
    return NextResponse.json({ error: "Invalid Shopee signature" }, { status: 401 });
  }

  try {
    JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Reply now; the push is only a wake-up. The tick pulls whatever changed
  // since the shop's cursor, so duplicate or out-of-order pushes are harmless.
  after(async () => {
    try {
      await runTick("webhook");
    } catch (err) {
      console.error("[Shopee webhook tick error]", err);
    }
  });

  return NextResponse.json({ ok: true });
}
