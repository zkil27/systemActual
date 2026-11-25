import { describe, expect, it } from "vitest";
import { hasTime, LEASE_MS, sliceDeadline, TICK_BUDGET_MS } from "../tick";

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
