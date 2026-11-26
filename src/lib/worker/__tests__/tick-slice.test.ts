import { describe, expect, it } from "vitest";
import { hasTime, LEASE_MS, shouldRunWebhookTick, sliceDeadline, TICK_BUDGET_MS, WEBHOOK_DEBOUNCE_MS } from "../tick";

describe("sliceDeadline", () => {
  it("gives a backfill only part of the remaining time", () => {
    expect(sliceDeadline(45_000, 0.5, 0)).toBe(22_500);
  });

  it("never goes past the real deadline", () => {
    expect(sliceDeadline(10_000, 2, 0)).toBe(10_000);
  });

  it("returns now when time is already up", () => {
    expect(sliceDeadline(1_000, 0.5, 5_000)).toBe(1_000);
  });
});

describe("hasTime", () => {
  it("is true only with at least the asked time left", () => {
    expect(hasTime(30_000, 10_000, 20_000)).toBe(true);
    expect(hasTime(30_000, 10_000, 20_001)).toBe(false);
    expect(hasTime(30_000, 10_000, 40_000)).toBe(false);
  });
});

describe("tick lease", () => {
  it("outlives the route's 120 s limit, so two ticks never overlap", () => {
    expect(LEASE_MS).toBeGreaterThan(120_000);
    expect(LEASE_MS).toBeGreaterThan(TICK_BUDGET_MS);
  });
});

describe("shouldRunWebhookTick", () => {
  const now = new Date("2026-11-26T12:00:00Z");

  it("asks for a rerun when a tick is actively holding the lease", () => {
    expect(
      shouldRunWebhookTick({ holder: "abc", lockedUntil: new Date(now.getTime() + 30_000) }, now)
    ).toBe("rerun");
  });

  it("debounces when a tick finished within the cooldown window", () => {
    expect(
      shouldRunWebhookTick({ holder: null, lockedUntil: new Date(now.getTime() - (WEBHOOK_DEBOUNCE_MS - 1_000)) }, now)
    ).toBe("debounce");
  });

  it("runs when no lock exists, the lease expired, or cooldown elapsed", () => {
    expect(shouldRunWebhookTick(null, now)).toBe("run");
    expect(
      shouldRunWebhookTick({ holder: "crashed", lockedUntil: new Date(now.getTime() - 1) }, now)
    ).toBe("run");
    expect(
      shouldRunWebhookTick({ holder: null, lockedUntil: new Date(now.getTime() - WEBHOOK_DEBOUNCE_MS) }, now)
    ).toBe("run");
  });
});
