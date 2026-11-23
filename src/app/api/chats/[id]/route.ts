import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getThread } from "@/lib/chats/service";

export const dynamic = "force-dynamic";

const idSchema = z.string().min(1).max(64);

/** Owner only (middleware). One chat with its order; `?after=` returns only newer messages. */
export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const after = req.nextUrl.searchParams.get("after");
  if (!idSchema.safeParse(id).success || (after && !idSchema.safeParse(after).success)) {
    return NextResponse.json({ error: "Chat not found." }, { status: 404 });
  }
  try {
    const thread = await getThread(id, after);
    if (!thread) return NextResponse.json({ error: "Chat not found." }, { status: 404 });
    return NextResponse.json(thread);
  } catch (err) {
    console.error("[chats] thread", id, err);
    return NextResponse.json({ error: "Couldn't load this chat." }, { status: 500 });
  }
}
