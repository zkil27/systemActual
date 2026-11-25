import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HAPTIC_MIN_GAP_MS,
  HAPTIC_PATTERNS,
  haptic,
  hapticPattern,
  resetHapticsForTests,
  shouldFire,
} from "@/lib/ui/haptics";
import { toastTiming } from "@/lib/ui/toast-tone";

afterEach(() => {
  resetHapticsForTests();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("hapticPattern", () => {
  it("keeps the patterns staff already know", () => {
    expect(hapticPattern("success")).toBe(18);
    expect(hapticPattern("error")).toEqual([30, 40, 30]);
    expect(hapticPattern("pin-wrong")).toEqual([40, 50, 40]);
  });

  it("keeps selection lighter than a tap, and a tap lighter than success", () => {
    expect(HAPTIC_PATTERNS.select).toBeLessThan(HAPTIC_PATTERNS.tap as number);
    expect(HAPTIC_PATTERNS.tap).toBeLessThan(HAPTIC_PATTERNS.success as number);
  });
});

describe("shouldFire", () => {
  it("fires the first time and after the gap, not inside it", () => {
    expect(shouldFire(null, 1000)).toBe(true);
    expect(shouldFire(1000, 1000 + HAPTIC_MIN_GAP_MS - 1)).toBe(false);
    expect(shouldFire(1000, 1000 + HAPTIC_MIN_GAP_MS)).toBe(true);
  });
});

describe("haptic", () => {
  it("never throws without vibrate or a document", () => {
    vi.stubGlobal("navigator", { userAgent: "node" });
    expect(() => haptic("tap")).not.toThrow();
  });

  it("never throws when vibrate itself throws", () => {
    vi.stubGlobal("navigator", {
      vibrate: () => {
        throw new Error("no gesture");
      },
    });
    expect(() => haptic("error")).not.toThrow();
  });

  it("vibrates with the named pattern and throttles close repeats", () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const vibrate = vi.fn(() => true);
    vi.stubGlobal("navigator", { vibrate });
    haptic("error");
    haptic("tap");
    expect(vibrate).toHaveBeenCalledTimes(1);
    expect(vibrate).toHaveBeenCalledWith([30, 40, 30]);
    vi.setSystemTime(10_000 + HAPTIC_MIN_GAP_MS);
    haptic("select");
    expect(vibrate).toHaveBeenLastCalledWith(6);
  });
});

describe("toastTiming", () => {
  it("announces errors as alerts and keeps them up longer", () => {
    expect(toastTiming("error")).toEqual({ role: "alert", exitAtMs: 3420, durationMs: 3600 });
    expect(toastTiming("success")).toEqual({ role: "status", exitAtMs: 2420, durationMs: 2600 });
  });
});
