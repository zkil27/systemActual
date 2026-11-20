import { describe, expect, it } from "vitest";
import { runLocked, type LockStore } from "@/lib/worker/lock";
import { isWorkerAuthorized } from "@/lib/worker/auth";

/** In-memory version of the single-row lease. */
function memoryStore() {
  const rows = new Map<string, { holder: string | null; until: number; rerun: boolean }>();
  const store: LockStore = {
    async tryAcquire(id, holder, until, now) {
      const row = rows.get(id);
      if (row && row.until > now.getTime()) return false;
      rows.set(id, { holder, until: until.getTime(), rerun: false });
      return true;
    },
    async requestRerun(id) {
      const row = rows.get(id);
      if (row) row.rerun = true;
    },
    async takeRerun(id, holder) {
      const row = rows.get(id);
      if (!row || row.holder !== holder || !row.rerun) return false;
      row.rerun = false;
      return true;
    },
    async extend(id, holder, until) {
      const row = rows.get(id);
      if (row?.holder === holder) row.until = until.getTime();
    },
    async release(id, holder, now) {
      const row = rows.get(id);
      if (row?.holder === holder) {
        row.until = now.getTime();
        row.holder = null;
      }
    },
  };
  return { store, rows };
}

const far = () => Date.now() + 60_000;

describe("runLocked", () => {
  it("never runs two ticks at once; the second asks for a rerun instead", async () => {
    const { store } = memoryStore();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let runs = 0;

    const first = runLocked({
      id: "tick",
      leaseMs: 70_000,
      deadline: far(),
      store,
      fn: async () => {
        runs++;
        if (runs === 1) await gate;
        return runs;
      },
    });
    await Promise.resolve();
    const second = await runLocked({ id: "tick", leaseMs: 70_000, deadline: far(), store, fn: async () => 99 });
    expect(second).toEqual({ ran: false, passes: [] });

    release();
    const result = await first;
    // The webhook that arrived mid-tick is honoured with exactly one more pass.
    expect(result).toEqual({ ran: true, passes: [1, 2] });
  });

  it("releases the lock even if the job throws", async () => {
    const { store } = memoryStore();
    await expect(
      runLocked({ id: "tick", leaseMs: 70_000, deadline: far(), store, fn: async () => { throw new Error("boom"); } })
    ).rejects.toThrow("boom");
    const next = await runLocked({ id: "tick", leaseMs: 70_000, deadline: far(), store, fn: async () => "ok" });
    expect(next.ran).toBe(true);
  });

  it("takes over a lease left behind by a crashed tick once it expires", async () => {
    const { store, rows } = memoryStore();
    rows.set("tick", { holder: "crashed", until: Date.now() - 1, rerun: false });
    const res = await runLocked({ id: "tick", leaseMs: 70_000, deadline: far(), store, fn: async () => "ok" });
    expect(res.ran).toBe(true);
  });

  it("does not rerun past the deadline", async () => {
    const { store, rows } = memoryStore();
    const res = await runLocked({
      id: "tick",
      leaseMs: 70_000,
      deadline: Date.now() - 1,
      store,
      fn: async () => {
        rows.get("tick")!.rerun = true;
        return "once";
      },
    });
    expect(res.passes).toEqual(["once"]);
  });
});

describe("isWorkerAuthorized", () => {
  const secret = "s".repeat(40);
  it("accepts only the exact bearer secret", () => {
    expect(isWorkerAuthorized(`Bearer ${secret}`, secret)).toBe(true);
    expect(isWorkerAuthorized(`Bearer ${secret}x`, secret)).toBe(false);
    expect(isWorkerAuthorized(secret, secret)).toBe(false);
    expect(isWorkerAuthorized(null, secret)).toBe(false);
  });
  it("fails closed when the secret is missing or too short", () => {
    expect(isWorkerAuthorized("Bearer ", "")).toBe(false);
    expect(isWorkerAuthorized("Bearer short", "short")).toBe(false);
    expect(isWorkerAuthorized(`Bearer ${secret}`, undefined)).toBe(false);
  });
});
