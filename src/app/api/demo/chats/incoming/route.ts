import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { addDemoBuyerMessage } from "@/lib/demo-chats";
import { notifyNewBuyerMessage } from "@/lib/chats/notify";

const body = z.object({
  platform: z.enum(["SHOPEE", "TIKTOK"]),
  conversationId: z.string().min(1).max(64).optional(),
  /** Also send the Telegram alert, to try it with sample chats. */
  alert: z.boolean().optional(),
});

/** Owner only (middleware). Adds a sample buyer message, as if a buyer just wrote. */
export async function POST(req: NextRequest) {
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Pick Shopee or TikTok." }, { status: 400 });
  try {
    const id = await addDemoBuyerMessage(parsed.data.platform, parsed.data.conversationId);
    if (!id) {
      return NextResponse.json({ error: "No sample chats yet. Refresh sample data first." }, { status: 404 });
    }
    await notifyNewBuyerMessage({ sample: true, includeSample: parsed.data.alert === true }).catch((err) =>
      console.error("[demo chats] alert", err)
    );
    return NextResponse.json({ ok: true, conversationId: id });
  } catch (err) {
    console.error("[demo chats] incoming", err);
    return NextResponse.json({ error: "Couldn't add a test message." }, { status: 500 });
  }
}
