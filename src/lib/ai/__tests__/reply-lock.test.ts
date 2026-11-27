import { describe, expect, it, vi } from "vitest";
import type { LockStore } from "@/lib/worker/lock";
import { acquireReplyLock, replyLockId } from "../reply-lock";

function memoryLockStore(): LockStore & { held: Map<string, { holder: string; until: number }> } {
  const held = new Map<string, { holder: string; until: number }>();
  return {
    held,
    async tryAcquire(id, holder, until, now) {
      const cur = held.get(id);
      if (cur && cur.until > now.getTime()) return false;
      held.set(id, { holder, until: until.getTime() });
      return true;
    },
    async requestRerun() {},
    async takeRerun() {
      return false;
    },
    async extend() {},
    async release(id, holder) {
      if (held.get(id)?.holder === holder) held.delete(id);
    },
  };
}

describe("acquireReplyLock", () => {
  it("gives deterministic lock ids per (conversation, buyer message)", () => {
    expect(replyLockId("c1", "m1")).toBe(replyLockId("c1", "m1"));
    expect(replyLockId("c1", "m1")).not.toBe(replyLockId("c1", "m2"));
    expect(replyLockId("c1", "m1")).toMatch(/^ai:reply:[a-f0-9]{24}$/);
  });

  it("allows only one concurrent caller per buyer message and cleans up on release", async () => {
    const store = memoryLockStore();
    const cleanup = vi.fn(async (id: string) => {
      store.held.delete(id);
    });
    const now = () => new Date(1_795_000_000_000);

    const first = await acquireReplyLock("c1", "m1", { store, cleanup, now });
    expect(first.acquired).toBe(true);

    const second = await acquireReplyLock("c1", "m1", { store, cleanup, now });
    expect(second.acquired).toBe(false);

    // Different buyer message isn't blocked.
    const other = await acquireReplyLock("c1", "m2", { store, cleanup, now });
    expect(other.acquired).toBe(true);

    if (first.acquired) await first.release();
    expect(cleanup).toHaveBeenCalledTimes(1);

    // After release, a later retry can acquire cleanly.
    const retry = await acquireReplyLock("c1", "m1", { store, cleanup, now });
    expect(retry.acquired).toBe(true);
    if (retry.acquired) await retry.release();
    if (other.acquired) await other.release();
  });
});
