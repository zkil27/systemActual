/** Staff PIN entry, as a pure function so the keypad logic is testable. */
export const PIN_LENGTH = 4;

export type PinKey = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "back" | "clear";

export interface PinResult {
  pin: string;
  /** True on the key press that completes the PIN. Submit right away; no delay. */
  submit: boolean;
}

export function applyPinKey(pin: string, key: string): PinResult {
  if (key === "back") return { pin: pin.slice(0, -1), submit: false };
  if (key === "clear") return { pin: "", submit: false };
  if (!/^\d$/.test(key) || pin.length >= PIN_LENGTH) return { pin, submit: false };
  const next = pin + key;
  return { pin: next, submit: next.length === PIN_LENGTH };
}

/** Map a physical keyboard key to a keypad key, for desktop use. */
export function keyFromKeyboard(key: string): PinKey | null {
  if (/^\d$/.test(key)) return key as PinKey;
  if (key === "Backspace") return "back";
  if (key === "Escape" || key === "Delete") return "clear";
  return null;
}
