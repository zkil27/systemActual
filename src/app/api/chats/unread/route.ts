import { NextResponse } from "next/server";
import { unreadTotals } from "@/lib/chats/service";

export const dynamic = "force-dynamic";

/** Owner only (middleware). Unread chat counts for the tab badge. */
export async function GET() {
  try {
    return NextResponse.json(await unreadTotals());
  } catch (err) {
    console.error("[chats] unread", err);
    return NextResponse.json({ error: "Couldn't load chats." }, { status: 500 });
  }
}
