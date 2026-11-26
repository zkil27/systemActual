import { describe, expect, it } from "vitest";
import {
  getSheetDepth,
  isTopSheet,
  pushSheet,
  removeSheet,
  resistDrag,
  shouldDismiss,
} from "@/lib/ui/sheet";

describe("shouldDismiss", () => {
  it("never closes on an upward drag or no drag", () => {
    expect(shouldDismiss(0, 2, 600)).toBe(false);
    expect(shouldDismiss(-200, 2, 600)).toBe(false);
  });

  it("closes after a long slow drag", () => {
    expect(shouldDismiss(170, 0.1, 600)).toBe(true);
  });

  it("stays open after a short slow drag", () => {
    expect(shouldDismiss(60, 0.1, 600)).toBe(false);
  });

  it("closes on a quick flick past a small distance", () => {
    expect(shouldDismiss(40, 0.9, 600)).toBe(true);
  });

  it("ignores a fast twitch that barely moved", () => {
    expect(shouldDismiss(10, 3, 600)).toBe(false);
  });

  it("uses a smaller distance for short sheets, but at least 80px", () => {
    expect(shouldDismiss(90, 0, 250)).toBe(true);
    expect(shouldDismiss(70, 0, 200)).toBe(false);
  });
});

describe("resistDrag", () => {
  it("passes downward drags through and damps upward ones", () => {
    expect(resistDrag(50)).toBe(50);
    expect(resistDrag(-100)).toBe(-20);
  });
});

describe("sheet stack helpers", () => {
  it("pushes, moves to top, reports depth and top status, and removes ids", () => {
    const first = Symbol("first");
    const second = Symbol("second");

    let stack = pushSheet([], first);
    expect(isTopSheet(stack, first)).toBe(true);
    expect(getSheetDepth(stack, first)).toBe(0);

    stack = pushSheet(stack, second);
    expect(isTopSheet(stack, first)).toBe(false);
    expect(isTopSheet(stack, second)).toBe(true);
    expect(getSheetDepth(stack, first)).toBe(0);
    expect(getSheetDepth(stack, second)).toBe(1);

    stack = pushSheet(stack, first);
    expect(isTopSheet(stack, first)).toBe(true);
    expect(getSheetDepth(stack, first)).toBe(1);

    stack = removeSheet(stack, first);
    expect(isTopSheet(stack, second)).toBe(true);
    expect(getSheetDepth(stack, first)).toBe(0);

    stack = removeSheet(stack, second);
    expect(isTopSheet(stack, second)).toBe(false);
  });
});
