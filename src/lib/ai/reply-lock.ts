import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { prismaLockStore, type LockStore } from "@/lib/worker/lock";

/**
 * Short-lived cross-process lease per (conversation, buyer message) so
 * overlapping triggers (webhook + worker tick + open Chats screen) never fire
 * duplicate AI API calls for the exact same buyer message. Deletes its row on
 * release so WorkerLock stays small.
 */

const DEFAULT_LEASE_MS = 45_000;

export function replyLockId(conversationId: string, buyerMessageId: string): string {
  const hash = crypto
    .createHash("sha1")
    .update(`${conversationId}:${buyerMessageId}`)
    .digest("hex")
    .slice(0, 24);
  return `ai:reply:${hash}`;
}

export interface ReplyLockHandle {
  acquired: true;
  release: () => Promise<void>;
}

export async function acquireReplyLock(
  conversationId: string,
  buyerMessageId: string,
  opts: { leaseMs?: number; store?: LockStore; cleanup?: (id: string) => Promise<void>; now?: () => Date } = {}
): Promise<ReplyLockHandle | { acquired: false }> {
  const id = replyLockId(conversationId, buyerMessageId);
  const store = opts.store ?? prismaLockStore;
  const now = opts.now ?? (() => new Date());
  const holder = crypto.randomUUID();
  const until = new Date(now().getTime() + (opts.leaseMs ?? DEFAULT_LEASE_MS));

  let acquired = false;
  try {
    acquired = await store.tryAcquire(id, holder, until, now());
  } catch {
    // If WorkerLock is temporarily unreachable, proceed rather than blocking replies.
    return { acquired: true, release: async () => {} };
  }
  if (!acquired) return { acquired: false };

  let released = false;
  return {
    acquired: true,
    release: async () => {
      if (released) return;
      released = true;
      if (opts.cleanup) {
        await opts.cleanup(id).catch(() => {});
        return;
      }
      // Delete only if we still hold the lease, leaving zero stale rows behind.
      if (prisma.workerLock?.deleteMany) {
        await prisma.workerLock.deleteMany({ where: { id, holder } }).catch(async () => {
          await store.release(id, holder, now()).catch(() => {});
        });
      } else {
        await store.release(id, holder, now()).catch(() => {});
      }
    },
  };
}
