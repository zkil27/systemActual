import { NextResponse } from "next/server";
import { getOwnerSession } from "@/lib/auth";
import { markChatRead } from "@/lib/chats/service";

export async function POST(_req: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await getOwnerSession())) {
    return NextResponse.json({ error: "Owner sign-in required." }, { status: 401 });
  }
  const { id } = await context.params;
  if (!id || id.length > 64) return NextResponse.json({ error: "Chat not found." }, { status: 404 });
  try {
    const found = await markChatRead(id);
    if (!found) return NextResponse.json({ error: "Chat not found." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[chats] read", id, err);
    return NextResponse.json({ error: "Couldn't update this chat." }, { status: 500 });
  }
}
