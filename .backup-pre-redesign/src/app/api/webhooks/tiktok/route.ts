import { NextRequest, NextResponse, after } from "next/server";
import { Platform } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  syncTikTokConnection,
  verifyTikTokWebhookSignature,
} from "@/lib/connectors/tiktok";

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const authHeader = req.headers.get("authorization");

  if (process.env.TIKTOK_APP_KEY && process.env.TIKTOK_APP_SECRET) {
    const valid = verifyTikTokWebhookSignature({
      rawBody,
      authorizationHeader: authHeader,
    });
    if (!valid) {
      return NextResponse.json({ error: "Invalid TikTok signature" }, { status: 401 });
    }
  }

  let payload: { shop_id?: string | number } = {};
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // TikTok requires an immediate 200 OK; run the REST reconciliation asynchronously
  after(async () => {
    try {
      const shopId = payload.shop_id ? String(payload.shop_id) : null;
      const conn = await prisma.shopConnection.findFirst({
        where: {
          platform: Platform.TIKTOK,
          ...(shopId ? { shopId } : {}),
          isDemo: false,
        },
      });
      if (conn) {
        await syncTikTokConnection(conn.id);
      }
    } catch (err) {
      console.error("[TikTok webhook async sync error]", err);
    }
  });

  return NextResponse.json({ ok: true });
}
