import { NextRequest, NextResponse, after } from "next/server";
import { Platform } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { shopeeWebhookUrl, verifyShopeeWebhookSignature } from "@/lib/connectors/shopee";
import { eventFields, processEvent, storeEvent } from "@/lib/integrations/inbox";
import { handleMarketplaceEvent } from "@/lib/integrations/handle-event";
import { normalizeOrderState } from "@/lib/ledger/state";
import { triggerWebhookTick } from "@/lib/worker/tick";

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("authorization");

  // Always verify (fail closed). Without SHOPEE_PUSH_PARTNER_KEY or SHOPEE_PARTNER_KEY every push is rejected.
  const webhookUrl = shopeeWebhookUrl(req.url);
  const valid = verifyShopeeWebhookSignature({
    webhookUrl,
    rawBody,
    signatureHeader: signature,
  });
  if (!valid) {
    console.warn("[Shopee webhook] signature mismatch", {
      hasAuth: Boolean(signature),
      hasPushKey: Boolean(process.env.SHOPEE_PUSH_PARTNER_KEY?.trim()),
      webhookUrl,
    });
    return NextResponse.json({ error: "Invalid Shopee signature" }, { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Shopee's "Verify and Save" test push uses code 0; acknowledge immediately.
  if (payload.code === 0 || payload.code === "0") {
    return NextResponse.json({ ok: true });
  }

  // Store first: a resend is answered without doing the work twice, and a
  // crash below leaves the event for the worker tick to retry.
  const eventId = await storeEvent(Platform.SHOPEE, payload, rawBody);
  if (!eventId) return NextResponse.json({ ok: true, duplicate: true });

  // Fast-track urgent cancellations before any in-flight wave ships the order.
  const fields = eventFields(Platform.SHOPEE, payload);
  if (fields.isCancel && fields.orderSn) {
    const cancelStatus = fields.cancelStatus ?? "IN_CANCEL";
    await prisma.order
      .updateMany({
        where: { platform: Platform.SHOPEE, orderSn: fields.orderSn },
        data: {
          cancelRequested: true,
          status: cancelStatus,
          state: normalizeOrderState(Platform.SHOPEE, cancelStatus),
        },
      })
      .catch((err) => console.error("[Shopee fast-cancel]", err));
  }

  // Reply now; urgent cancellations alert packers immediately, while normal pushes are drained by the debounced tick.
  after(async () => {
    try {
      if (fields.isCancel) {
        await processEvent(eventId, handleMarketplaceEvent);
      }
      await triggerWebhookTick(Platform.SHOPEE);
    } catch (err) {
      console.error("[Shopee webhook tick error]", err);
    }
  });

  return NextResponse.json({ ok: true });
}
