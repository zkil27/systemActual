import { NextRequest, NextResponse, after } from "next/server";
import { z } from "zod";
import { listChats, unreadTotals } from "@/lib/chats/service";
import { syncAllTikTokChats } from "@/lib/chats/tiktok-sync";

export const dynamic = "force-dynamic";
// The first TikTok import can take a while; it runs after the response.
export const maxDuration = 60;

const query = z.object({
  platform: z.enum(["SHOPEE", "TIKTOK"]),
  cursor: z.string().min(1).max(64).optional(),
});

/** Owner only (middleware). Chats for one shop, newest first, plus unread counts for both. */
export async function GET(req: NextRequest) {
  const parsed = query.safeParse({
    platform: req.nextUrl.searchParams.get("platform")?.toUpperCase(),
    cursor: req.nextUrl.searchParams.get("cursor") || undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Pick Shopee or TikTok." }, { status: 400 });
  }
  if (parsed.data.platform === "TIKTOK" && !parsed.data.cursor) {
    // While the screen is open, check TikTok for changed chats (at most every 15 s per shop).
    after(() =>
      syncAllTikTokChats(Date.now() + 50_000, 15_000).catch((err) =>
        console.error("[chats] background sync", err instanceof Error ? err.message : err)
      )
    );
  }
  try {
    const [list, unread] = await Promise.all([listChats(parsed.data.platform, parsed.data.cursor), unreadTotals()]);
    return NextResponse.json({ ...list, unread });
  } catch (err) {
    console.error("[chats] list", err);
    return NextResponse.json({ error: "Couldn't load chats." }, { status: 500 });
  }
}
