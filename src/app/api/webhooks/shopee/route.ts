import { NextRequest, NextResponse, after } from "next/server";
import { Platform } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  shopeeWebhookUrl,
  syncShopeeConnection,
  verifyShopeeWebhookSignature,
} from "@/lib/connectors/shopee";

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

  let payload: { shop_id?: number | string } = {};
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Respond 200 OK immediately and sync asynchronously
  after(async () => {
    try {
      const shopId = payload.shop_id ? String(payload.shop_id) : null;
      if (!shopId) return;
      const conn = await prisma.shopConnection.findFirst({
        where: { platform: Platform.SHOPEE, shopId, isDemo: false },
      });
      if (conn) {
        await syncShopeeConnection(conn.id);
      }
    } catch (err) {
      console.error("[Shopee webhook async sync error]", err);
    }
  });

  return NextResponse.json({ ok: true });
}
