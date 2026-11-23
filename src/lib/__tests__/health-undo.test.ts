import { PhysicalCondition } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { assessHealth, type HealthInput } from "@/lib/health";
import { canUndoScan, parcelAfterUndo, SCAN_UNDO_WINDOW_MS } from "@/lib/returns/undo-scan";

const NOW = new Date("2026-11-23T04:00:00Z");
const minsAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

const healthy: HealthInput = {
  now: NOW,
  shops: [{ platform: "SHOPEE", shopName: "Kyna", connected: true, lastSyncedAt: minsAgo(2), tokenError: null }],
  workerLockedUntil: minsAgo(1),
  workerRunning: false,
  printer: {
    lastSeenAt: minsAgo(0.2),
    paused: false,
    agentVersion: "1.4.0",
    printerStatus: "Normal",
    lastBackupAt: minsAgo(60 * 10),
    lastBackupError: null,
  },
  queuedJobs: 0,
  failedJobs24h: 0,
  runningWave: false,
};

describe("health", () => {
  it("is all good when everything is fresh", () => {
    const h = assessHealth(healthy);
    expect(h.level).toBe("ok");
    expect(h.checks.every((c) => c.level === "ok")).toBe(true);
  });

  it("flags a stale shop sync and a broken token", () => {
    expect(assessHealth({ ...healthy, shops: [{ ...healthy.shops[0], lastSyncedAt: minsAgo(30) }] }).level).toBe("warn");
    const bad = assessHealth({ ...healthy, shops: [{ ...healthy.shops[0], tokenError: "invalid refresh token" }] });
    expect(bad.level).toBe("bad");
    expect(bad.checks[0].detail).toContain("Reconnect");
  });

  it("offline printer is bad only when something is waiting to print", () => {
    const offline = { ...healthy, printer: { ...healthy.printer!, lastSeenAt: minsAgo(20) } };
    expect(assessHealth(offline).checks.find((c) => c.id === "printer")?.level).toBe("warn");
    expect(assessHealth({ ...offline, queuedJobs: 3 }).checks.find((c) => c.id === "printer")?.level).toBe("bad");
  });

  it("printer trouble, failed backup and failed jobs are surfaced", () => {
    const h = assessHealth({
      ...healthy,
      printer: { ...healthy.printer!, printerStatus: "PaperOut", lastBackupError: "pg_dump not found" },
      failedJobs24h: 2,
    });
    expect(h.checks.find((c) => c.id === "printer")?.level).toBe("bad");
    expect(h.checks.find((c) => c.id === "backup")?.detail).toContain("pg_dump");
    expect(h.checks.find((c) => c.id === "print-jobs")?.level).toBe("warn");
  });

  it("a worker that hasn't run in 30+ minutes is bad", () => {
    expect(assessHealth({ ...healthy, workerLockedUntil: minsAgo(45) }).checks.find((c) => c.id === "worker")?.level).toBe("bad");
    expect(assessHealth({ ...healthy, workerLockedUntil: minsAgo(45), workerRunning: true }).level).toBe("ok");
  });
});

describe("undo a return scan", () => {
  const scan = { staffMemberId: "s1", scannedAt: minsAgo(2) };
  it("same staff within 5 minutes", () => {
    expect(canUndoScan(scan, { staffMemberId: "s1", isOwner: false }, NOW)).toEqual({ ok: true });
    expect(canUndoScan(scan, { staffMemberId: "s2", isOwner: false }, NOW)).toMatchObject({ ok: false, status: 403 });
    expect(canUndoScan(scan, { staffMemberId: null, isOwner: true }, NOW)).toEqual({ ok: true });
    expect(
      canUndoScan({ ...scan, scannedAt: new Date(NOW.getTime() - SCAN_UNDO_WINDOW_MS - 1) }, { staffMemberId: "s1", isOwner: false }, NOW)
    ).toMatchObject({ ok: false, status: 409 });
  });

  it("falls back to the previous scan, or to not-arrived", () => {
    expect(parcelAfterUndo([])).toEqual({ physicalCondition: null, physicallyReceivedAt: null });
    expect(
      parcelAfterUndo([
        { condition: PhysicalCondition.DAMAGED_ITEM, scannedAt: minsAgo(30) },
        { condition: PhysicalCondition.GOOD_RESTOCKABLE, scannedAt: minsAgo(60) },
      ])
    ).toEqual({ physicalCondition: PhysicalCondition.DAMAGED_ITEM, physicallyReceivedAt: minsAgo(60) });
  });
});
