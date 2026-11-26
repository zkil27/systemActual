import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getOwnerSession } from "@/lib/auth";
import { checkReplyText, ReplyKeyConflictError } from "@/lib/chats/send";
import {
  canSendPhotoTo,
  ChatNotFoundError,
  ChatSendDisabledError,
  findReplyByClientKey,
  sendChatMessage,
} from "@/lib/chats/service";
import { PHOTO_OFF_NOTE } from "@/lib/chats/source";
import { InvalidProofPhotoError, saveChatPhoto } from "@/lib/storage";

export const maxDuration = 30;

const clientKeySchema = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);

/**
 * Sends a reply: JSON `{ clientKey, text }` or
 * multipart `{ clientKey, photo }`. Sending the same clientKey again retries
 * a failed reply and never posts twice.
 */
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!(await getOwnerSession())) {
    return NextResponse.json({ error: "Owner sign-in required." }, { status: 401 });
  }
  const { id } = await context.params;
  if (!id || id.length > 64) return NextResponse.json({ error: "Chat not found." }, { status: 404 });

  try {
    const contentType = req.headers.get("content-type") ?? "";
    let message;

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const key = clientKeySchema.safeParse(form.get("clientKey"));
      if (!key.success) return NextResponse.json({ error: "Try sending again." }, { status: 400 });

      const existing = await findReplyByClientKey(key.data);
      if (existing) {
        if (existing.conversationId !== id) return NextResponse.json({ error: "Try sending again." }, { status: 400 });
        // Already uploaded the first time: retry with the stored photo.
        message = await sendChatMessage(id, key.data, { imageUrl: "" });
      } else {
        const photo = form.get("photo");
        if (!(photo instanceof File)) return NextResponse.json({ error: "Choose a photo first." }, { status: 400 });
        if (!(await canSendPhotoTo(id))) return NextResponse.json({ error: PHOTO_OFF_NOTE }, { status: 403 });
        const imageUrl = await saveChatPhoto(photo);
        message = await sendChatMessage(id, key.data, { imageUrl });
      }
    } else {
      const body = (await req.json().catch(() => null)) as { clientKey?: unknown; text?: unknown } | null;
      const key = clientKeySchema.safeParse(body?.clientKey);
      if (!key.success) return NextResponse.json({ error: "Try sending again." }, { status: 400 });
      const text = checkReplyText(body?.text);
      if (!text.ok) return NextResponse.json({ error: text.error }, { status: 400 });
      message = await sendChatMessage(id, key.data, { text: text.text });
    }

    return NextResponse.json({ message });
  } catch (err) {
    if (err instanceof ChatNotFoundError) return NextResponse.json({ error: "Chat not found." }, { status: 404 });
    if (err instanceof ChatSendDisabledError) return NextResponse.json({ error: err.message }, { status: 403 });
    if (err instanceof InvalidProofPhotoError) return NextResponse.json({ error: err.message }, { status: 400 });
    if (err instanceof ReplyKeyConflictError) return NextResponse.json({ error: "Try sending again." }, { status: 400 });
    console.error("[chats] send", id, err);
    return NextResponse.json({ error: "Not sent. Try again." }, { status: 500 });
  }
}
