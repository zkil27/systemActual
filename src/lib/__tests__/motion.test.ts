import { describe, expect, it } from "vitest";
import { clamp01, countFrame, easeOutExpo, interpolate } from "@/lib/ui/motion";

describe("motion helpers", () => {
  it("interpolate hits both endpoints and clamps outside 0..1", () => {
    expect(interpolate(10, 50, 0)).toBe(10);
    expect(interpolate(10, 50, 1)).toBe(50);
    expect(interpolate(10, 50, -1)).toBe(10);
    expect(interpolate(10, 50, 2)).toBe(50);
  });

  it("easeOutExpo starts at 0, lands exactly at 1, and never goes backwards", () => {
    expect(easeOutExpo(0)).toBe(0);
    expect(easeOutExpo(1)).toBe(1);
    let prev = -1;
    for (let i = 0; i <= 100; i++) {
      const v = easeOutExpo(i / 100);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it("countFrame lands exactly on the final integer, counting up or down", () => {
    expect(countFrame(0, 137, 400, 400)).toBe(137);
    expect(countFrame(0, 137, 9999, 400)).toBe(137);
    expect(countFrame(42, 3, 400, 400)).toBe(3);
    expect(countFrame(0, 137, 0, 400)).toBe(0);
  });

  it("countFrame jumps straight to the value when duration is zero", () => {
    expect(countFrame(0, 9, 0, 0)).toBe(9);
  });

  it("clamp01 treats NaN as 0", () => {
    expect(clamp01(Number.NaN)).toBe(0);
  });
});
