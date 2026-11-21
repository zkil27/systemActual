import { NextRequest, NextResponse, after } from "next/server";
import { Platform } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { shopeeWebhookUrl, verifyShopeeWebhookSignature } from "@/lib/connectors/shopee";
import { syncSingleOrder } from "@/lib/ledger/sync";
import { notifyCancelledPrintedOrder } from "@/lib/shipping/outbound";
import { runTick } from "@/lib/worker/tick";

export const maxDuration = 120;

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

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Fast-track urgent cancellations before any in-flight wave ships the order.
  const data = (payload?.data ?? {}) as Record<string, unknown>;
  const orderSn = typeof data.ordersn === "string" ? data.ordersn : typeof data.order_sn === "string" ? data.order_sn : "";
  const status = typeof data.status === "string" ? data.status.toUpperCase() : "";
  const isCancelEvent = Boolean(orderSn && (status === "IN_CANCEL" || status === "CANCELLED"));
  if (isCancelEvent) {
    await prisma.order
      .updateMany({
        where: { platform: Platform.SHOPEE, orderSn },
        data: { cancelRequested: true, status },
      })
      .catch((err) => console.error("[Shopee fast-cancel]", err));
  }

  const shopExternalId =
    payload?.shop_id !== undefined && payload?.shop_id !== null ? String(payload.shop_id) : undefined;

  // Reply now; fast-sync the changed order first (<1s), then run the full tick.
  after(async () => {
    try {
      if (isCancelEvent) {
        await notifyCancelledPrintedOrder(Platform.SHOPEE, orderSn).catch((err) =>
          console.error("[Shopee cancel-pull alert]", orderSn, err)
        );
      }
      if (orderSn) {
        await syncSingleOrder(Platform.SHOPEE, orderSn, shopExternalId).catch((err) =>
          console.error("[Shopee single-order sync error]", orderSn, err)
        );
      }
      await runTick("webhook", { platform: Platform.SHOPEE });
    } catch (err) {
      console.error("[Shopee webhook tick error]", err);
    }
  });

  return NextResponse.json({ ok: true });
}
