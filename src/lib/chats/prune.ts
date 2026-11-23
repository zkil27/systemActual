import { del } from "@vercel/blob";
import { prisma } from "@/lib/prisma";

export const CHAT_RETENTION_DAYS = 90;
/** Messages per prune run, so one run never takes long. */
const CHAT_PRUNE_BATCH = 500;

export interface ChatPruneDeps {
  findOldMessages: (cutoff: Date, take: number) => Promise<Array<{ id: string; imageUrl: string | null }>>;
  deleteMessages: (ids: string[]) => Promise<number>;
  deleteOldConversations: (cutoff: Date) => Promise<number>;
  deleteBlobs: ((urls: string[]) => Promise<void>) | null;
}

/** Photos we uploaded to Vercel Blob for chats (not buyer photos hosted by the shop). */
export function isOwnChatBlob(url: string | null): url is string {
  return Boolean(url && /^https:\/\//i.test(url) && url.includes("/chat-photos/"));
}

/** Deletes chat messages and chats older than 90 days, and the chat photos we stored for them. */
export async function pruneOldChats(
  now: Date = new Date(),
  deps: ChatPruneDeps = defaultChatPruneDeps()
): Promise<{ messages: number; conversations: number; blobs: number }> {
  const cutoff = new Date(now.getTime() - CHAT_RETENTION_DAYS * 24 * 3600_000);
  const old = await deps.findOldMessages(cutoff, CHAT_PRUNE_BATCH);
  const blobUrls = old.map((m) => m.imageUrl).filter(isOwnChatBlob);
  let blobs = 0;
  if (blobUrls.length > 0 && deps.deleteBlobs) {
    try {
      await deps.deleteBlobs(blobUrls);
      blobs = blobUrls.length;
    } catch (err) {
      console.error("[prune] chat photos", err);
    }
  }
  const messages = old.length > 0 ? await deps.deleteMessages(old.map((m) => m.id)) : 0;
  const conversations = await deps.deleteOldConversations(cutoff);
  return { messages, conversations, blobs };
}

function defaultChatPruneDeps(): ChatPruneDeps {
  return {
    findOldMessages: (cutoff, take) =>
      prisma.chatMessage.findMany({ where: { sentAt: { lt: cutoff } }, select: { id: true, imageUrl: true }, take }),
    deleteMessages: async (ids) => (await prisma.chatMessage.deleteMany({ where: { id: { in: ids } } })).count,
    // Only chats whose messages are already gone, so no stored photo is left behind.
    deleteOldConversations: async (cutoff) =>
      (await prisma.chatConversation.deleteMany({ where: { lastMessageAt: { lt: cutoff }, messages: { none: {} } } }))
        .count,
    deleteBlobs: process.env.BLOB_READ_WRITE_TOKEN?.trim() ? (urls) => del(urls) : null,
  };
}
