import { describe, expect, it } from "vitest";
import { applyPinKey, keyFromKeyboard } from "@/lib/ui/pin";

describe("applyPinKey", () => {
  it("adds digits one at a time without submitting early", () => {
    expect(applyPinKey("", "1")).toEqual({ pin: "1", submit: false });
    expect(applyPinKey("12", "3")).toEqual({ pin: "123", submit: false });
  });

  it("submits on the 4th digit", () => {
    expect(applyPinKey("123", "4")).toEqual({ pin: "1234", submit: true });
  });

  it("ignores extra digits once the PIN is full, and never re-submits", () => {
    expect(applyPinKey("1234", "5")).toEqual({ pin: "1234", submit: false });
  });

  it("backspace removes one digit and is safe on empty", () => {
    expect(applyPinKey("123", "back")).toEqual({ pin: "12", submit: false });
    expect(applyPinKey("", "back")).toEqual({ pin: "", submit: false });
  });

  it("clear empties the PIN", () => {
    expect(applyPinKey("123", "clear")).toEqual({ pin: "", submit: false });
  });

  it("ignores anything that isn't a digit or a known key", () => {
    expect(applyPinKey("12", "a")).toEqual({ pin: "12", submit: false });
    expect(applyPinKey("12", "12")).toEqual({ pin: "12", submit: false });
  });
});

describe("keyFromKeyboard", () => {
  it("maps digits, Backspace and Escape", () => {
    expect(keyFromKeyboard("7")).toBe("7");
    expect(keyFromKeyboard("Backspace")).toBe("back");
    expect(keyFromKeyboard("Escape")).toBe("clear");
    expect(keyFromKeyboard("Enter")).toBeNull();
  });
});
