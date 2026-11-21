import { describe, expect, it } from "vitest";
import { buildSyncStatus, STALE_SYNC_MS } from "@/lib/sync/status";
import { computeRefreshDelayMs } from "@/lib/ui/use-live-refresh";

describe("buildSyncStatus", () => {
  const now = new Date("2026-11-21T16:00:00.000Z");

  it("reports healthy caught-up state with deterministic version", () => {
    const status = buildSyncStatus(
      [
        {
          id: "shop-1",
          lastSyncedAt: new Date(now.getTime() - 60_000),
          ordersSyncedTo: new Date(now.getTime() - 60_000),
          returnsSyncedTo: new Date(now.getTime() - 60_000),
          stockImportStatus: "DONE",
        },
      ],
      { holder: null, lockedUntil: new Date(now.getTime() - 10_000) },
      now
    );

    expect(status.syncing).toBe(false);
    expect(status.stale).toBe(false);
    expect(status.catchingUp).toBe(false);
    expect(status.lastSyncedAt).toBe(new Date(now.getTime() - 60_000).toISOString());
    expect(status.version).toContain("shop-1:");
  });

  it("detects active tick lock, stale shop, and backlog catchingUp", () => {
    const status = buildSyncStatus(
      [
        {
          id: "shop-1",
          lastSyncedAt: new Date(now.getTime() - STALE_SYNC_MS - 1_000),
          ordersSyncedTo: new Date(now.getTime() - 30 * 60_000),
          returnsSyncedTo: new Date(now.getTime() - 60_000),
          stockImportStatus: "RUNNING",
        },
      ],
      { holder: "worker-abc", lockedUntil: new Date(now.getTime() + 60_000) },
      now
    );

    expect(status.syncing).toBe(true);
    expect(status.stale).toBe(true);
    expect(status.catchingUp).toBe(true);
  });

  it("changes version whenever any shop timestamp or stock import status changes", () => {
    const base = {
      id: "shop-1",
      lastSyncedAt: new Date(now.getTime() - 60_000),
      ordersSyncedTo: new Date(now.getTime() - 60_000),
      returnsSyncedTo: new Date(now.getTime() - 60_000),
      stockImportStatus: "RUNNING",
    };
    const v1 = buildSyncStatus([base], null, now).version;
    const v2 = buildSyncStatus([{ ...base, ordersSyncedTo: new Date(now.getTime() - 30_000) }], null, now).version;
    const v3 = buildSyncStatus([{ ...base, stockImportStatus: "DONE" }], null, now).version;

    expect(v1).not.toBe(v2);
    expect(v1).not.toBe(v3);
    expect(v2).not.toBe(v3);
  });
});

describe("computeRefreshDelayMs", () => {
  it("uses fast polling when syncing or activeHint is set", () => {
    expect(computeRefreshDelayMs({ syncing: true, catchingUp: false })).toBe(4_000);
    expect(computeRefreshDelayMs({ syncing: false, catchingUp: false, activeHint: true })).toBe(4_000);
  });

  it("uses medium polling while catching up on a backlog", () => {
    expect(computeRefreshDelayMs({ syncing: false, catchingUp: true })).toBe(15_000);
  });

  it("backs off to 45s when idle and caught up", () => {
    expect(computeRefreshDelayMs({ syncing: false, catchingUp: false })).toBe(45_000);
  });
});
