import { NextRequest, NextResponse, after } from "next/server";
import { OrderState, Platform } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { verifyTikTokWebhookSignature } from "@/lib/connectors/tiktok";
import { eventFields, processEvent, storeEvent } from "@/lib/integrations/inbox";
import { handleMarketplaceEvent } from "@/lib/integrations/handle-event";
import { triggerWebhookTick } from "@/lib/worker/tick";

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const authHeader = req.headers.get("authorization");

  // Always verify (fail closed). Without TIKTOK_APP_KEY/SECRET every webhook is rejected.
  const valid = verifyTikTokWebhookSignature({
    rawBody,
    authorizationHeader: authHeader,
  });
  if (!valid) {
    return NextResponse.json({ error: "Invalid TikTok signature" }, { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Store first: a resend is answered without doing the work twice, and a
  // crash below leaves the event for the worker tick to retry.
  const eventId = await storeEvent(Platform.TIKTOK, payload, rawBody);
  if (!eventId) return NextResponse.json({ ok: true, duplicate: true });

  const fields = eventFields(Platform.TIKTOK, payload);

  // Buyer chat events (New conversation / New message) only touch Chats, never the order sync.
  if (fields.isChat) {
    after(() => processEvent(eventId, handleMarketplaceEvent).catch((err) => console.error("[TikTok chat webhook]", err)));
    return NextResponse.json({ ok: true });
  }

  // Fast-track urgent cancellations before any in-flight wave ships the order.
  if (fields.isCancel && fields.orderSn) {
    await prisma.order
      .updateMany({
        where: { platform: Platform.TIKTOK, orderSn: fields.orderSn },
        data: {
          cancelRequested: true,
          ...(fields.cancelStatus === "CANCELLED" ? { status: "CANCELLED", state: OrderState.CANCELLED } : {}),
        },
      })
      .catch((err) => console.error("[TikTok fast-cancel]", err));
  }

  // TikTok needs a 200 within 3 seconds. Urgent cancellations alert packers immediately;
  // normal order updates are drained in bounded batches by the debounced tick.
  after(async () => {
    try {
      if (fields.isCancel) {
        await processEvent(eventId, handleMarketplaceEvent);
      }
      await triggerWebhookTick(Platform.TIKTOK);
    } catch (err) {
      console.error("[TikTok webhook tick error]", err);
    }
  });

  return NextResponse.json({ ok: true });
}
