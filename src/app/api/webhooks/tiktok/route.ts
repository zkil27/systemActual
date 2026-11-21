import { NextRequest, NextResponse, after } from "next/server";
import { Platform } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { verifyTikTokWebhookSignature } from "@/lib/connectors/tiktok";
import { syncSingleOrder } from "@/lib/ledger/sync";
import { runTick } from "@/lib/worker/tick";

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

  // Fast-track urgent cancellations before any in-flight wave ships the order.
  const data = (payload?.data ?? {}) as Record<string, unknown>;
  const orderSn = typeof data.order_id === "string" ? data.order_id : "";
  const status = String(data.order_status ?? "").toUpperCase();
  const cancelStatus = String(data.cancel_status ?? "").toUpperCase();
  if (orderSn && (status === "CANCELLED" || cancelStatus.includes("CANCEL"))) {
    await prisma.order
      .updateMany({
        where: { platform: Platform.TIKTOK, orderSn },
        data: {
          cancelRequested: true,
          ...(status === "CANCELLED" ? { status: "CANCELLED" } : {}),
        },
      })
      .catch((err) => console.error("[TikTok fast-cancel]", err));
  }

  const shopExternalId = typeof payload?.shop_id === "string" ? payload.shop_id : undefined;

  // TikTok needs a 200 within 3 seconds. Fast-sync the specific changed order
  // first (<1s) so dashboards reflect it immediately, then run the full tick.
  after(async () => {
    try {
      if (orderSn) {
        await syncSingleOrder(Platform.TIKTOK, orderSn, shopExternalId).catch((err) =>
          console.error("[TikTok single-order sync error]", orderSn, err)
        );
      }
      await runTick("webhook", { platform: Platform.TIKTOK });
    } catch (err) {
      console.error("[TikTok webhook tick error]", err);
    }
  });

  return NextResponse.json({ ok: true });
}
