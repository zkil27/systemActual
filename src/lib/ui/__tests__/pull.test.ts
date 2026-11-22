import { describe, expect, it } from "vitest";
import { PULL_MAX, PULL_TRIGGER, indicatorOffset, pullOffset, pullPhase, scrollEdges } from "../pull";

describe("pullOffset", () => {
  it("is zero for no or upward travel", () => {
    expect(pullOffset(0)).toBe(0);
    expect(pullOffset(-40)).toBe(0);
    expect(pullOffset(Number.NaN)).toBe(0);
  });

  it("damps by half before the knee", () => {
    expect(pullOffset(20)).toBe(10);
  });

  it("grows monotonically and never passes the max", () => {
    let prev = 0;
    for (let dy = 1; dy < 2000; dy += 7) {
      const v = pullOffset(dy);
      expect(v).toBeGreaterThanOrEqual(prev);
      expect(v).toBeLessThan(PULL_MAX);
      prev = v;
    }
  });
});

describe("pullPhase", () => {
  it("arms at the trigger distance", () => {
    expect(pullPhase(0)).toBe("idle");
    expect(pullPhase(PULL_TRIGGER - 1)).toBe("pulling");
    expect(pullPhase(PULL_TRIGGER)).toBe("armed");
  });
});

describe("indicatorOffset", () => {
  it("holds the trigger position while syncing", () => {
    expect(indicatorOffset(0, "syncing")).toBe(pullOffset(PULL_TRIGGER));
    expect(indicatorOffset(500, "done")).toBe(pullOffset(PULL_TRIGGER));
  });
});

describe("scrollEdges", () => {
  it("reports nothing hidden when content fits", () => {
    expect(scrollEdges(0, 300, 300)).toEqual({ start: false, end: false });
    expect(scrollEdges(0, 301, 300)).toEqual({ start: false, end: false });
  });

  it("reports the hidden side", () => {
    expect(scrollEdges(0, 800, 390)).toEqual({ start: false, end: true });
    expect(scrollEdges(200, 800, 390)).toEqual({ start: true, end: true });
    expect(scrollEdges(410, 800, 390)).toEqual({ start: true, end: false });
  });
});
