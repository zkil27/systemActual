import { NextResponse } from "next/server";
import { getOwnerSession } from "@/lib/auth";
import { unreadTotals } from "@/lib/chats/service";

export const dynamic = "force-dynamic";

/** Unread chat counts for the tab badge. */
export async function GET() {
  if (!(await getOwnerSession())) {
    return NextResponse.json({ error: "Owner sign-in required." }, { status: 401 });
  }
  try {
    return NextResponse.json(await unreadTotals());
  } catch (err) {
    console.error("[chats] unread", err);
    return NextResponse.json({ error: "Couldn't load chats." }, { status: 500 });
  }
}
