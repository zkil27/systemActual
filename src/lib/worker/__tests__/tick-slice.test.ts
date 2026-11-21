import { describe, expect, it } from "vitest";
import { sliceDeadline } from "../tick";

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
