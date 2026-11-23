import type { ChatOutgoing, ChatSource, ChatSourceConversation } from "./source";
import { previewFor } from "./types";

export const MAX_REPLY_CHARS = 1000;

/** The send key was already used for a reply in a different chat. */
export class ReplyKeyConflictError extends Error {}

export type ReplyCheck = { ok: true; text: string } | { ok: false; error: string };

export function checkReplyText(raw: unknown): ReplyCheck {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return { ok: false, error: "Type a message first." };
  if (text.length > MAX_REPLY_CHARS) {
    return { ok: false, error: `Keep it under ${MAX_REPLY_CHARS.toLocaleString("en-PH")} characters.` };
  }
  return { ok: true, text };
}

export interface StoredReply {
  id: string;
  conversationId: string;
  clientKey: string | null;
  kind: "TEXT" | "IMAGE";
  text: string | null;
  imageUrl: string | null;
  sentAt: Date;
  status: "SENDING" | "SENT" | "FAILED";
}

/** The few database steps a send needs, so the flow can be tested without Postgres. */
export interface ReplyStore {
  findByClientKey(clientKey: string): Promise<StoredReply | null>;
  create(data: {
    conversationId: string;
    clientKey: string;
    kind: "TEXT" | "IMAGE";
    text: string | null;
    imageUrl: string | null;
    sentAt: Date;
  }): Promise<StoredReply>;
  /** Moves a reply to SENDING only if it isn't SENDING already. False when another request has it. */
  claimForRetry(id: string): Promise<boolean>;
  finish(id: string, result: { status: "SENT"; externalId: string } | { status: "FAILED" }): Promise<StoredReply>;
  touchConversation(conversationId: string, at: Date, preview: string): Promise<void>;
}

export type ReplyContent = { text: string } | { imageUrl: string };

/**
 * Saves the reply as SENDING, hands it to the shop, then marks it SENT or
 * FAILED. The same clientKey never posts twice: a sent reply is returned as is,
 * and a failed one is retried with what was stored the first time.
 */
export async function sendReply(
  opts: {
    conversation: ChatSourceConversation;
    clientKey: string;
    content: ReplyContent;
    now?: Date;
  },
  deps: { store: ReplyStore; source: ChatSource }
): Promise<StoredReply> {
  const { conversation, clientKey } = opts;
  const now = opts.now ?? new Date();
  const existing = await deps.store.findByClientKey(clientKey);

  let reply: StoredReply;
  if (existing) {
    if (existing.conversationId !== conversation.id) throw new ReplyKeyConflictError("This reply belongs to another chat.");
    if (existing.status === "SENT") return existing;
    if (!(await deps.store.claimForRetry(existing.id))) return existing;
    reply = { ...existing, status: "SENDING" };
  } else {
    const isImage = "imageUrl" in opts.content;
    reply = await deps.store.create({
      conversationId: conversation.id,
      clientKey,
      kind: isImage ? "IMAGE" : "TEXT",
      text: "text" in opts.content ? opts.content.text : null,
      imageUrl: "imageUrl" in opts.content ? opts.content.imageUrl : null,
      sentAt: now,
    });
  }

  const outgoing: ChatOutgoing = reply.kind === "IMAGE" ? { imageUrl: reply.imageUrl ?? "" } : { text: reply.text ?? "" };
  try {
    const result = await deps.source.send(conversation, outgoing);
    const done = await deps.store.finish(reply.id, { status: "SENT", externalId: result.externalId });
    await deps.store.touchConversation(conversation.id, done.sentAt, previewFor(done.kind, done.text, true));
    return done;
  } catch (err) {
    console.error("[chats] send failed", conversation.id, err instanceof Error ? err.message : err);
    return deps.store.finish(reply.id, { status: "FAILED" });
  }
}
