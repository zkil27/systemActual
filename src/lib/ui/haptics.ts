/**
 * Named haptics for phones.
 *
 * - Android (staff): `navigator.vibrate` with short patterns.
 * - iPhone (owner): Safari has no vibrate. Tapping the label of a hidden
 *   `<input type="checkbox" switch>` (Safari 17.4+) makes iOS play its own
 *   switch tick. It only works inside a tap handler, so results that arrive
 *   later (a network reply) can't tick on iPhone; the bloom confirms those.
 *   Apple doesn't document this, and it does nothing when System Haptics is
 *   off, so everything here fails quietly.
 */

export type HapticKind = "tap" | "select" | "success" | "warn" | "error" | "pin-wrong";

/** Android vibration patterns in ms. Kept close to the feel staff already know. */
export const HAPTIC_PATTERNS: Record<HapticKind, number | number[]> = {
  tap: 10,
  select: 6,
  success: 18,
  warn: [16, 60, 16],
  error: [30, 40, 30],
  "pin-wrong": [40, 50, 40],
};

/** Two haptics closer than this feel like one buzz; skip the second. */
export const HAPTIC_MIN_GAP_MS = 40;

export function hapticPattern(kind: HapticKind): number | number[] {
  return HAPTIC_PATTERNS[kind];
}

export function shouldFire(lastAt: number | null, now: number, gap = HAPTIC_MIN_GAP_MS): boolean {
  return lastAt === null || now - lastAt >= gap;
}

let lastAt: number | null = null;
let iosLabel: HTMLLabelElement | null = null;

function canVibrate(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
}

function isAppleTouch(): boolean {
  if (typeof navigator === "undefined" || typeof document === "undefined") return false;
  const ua = navigator.userAgent || "";
  // iPadOS reports itself as a Mac; touch points tell them apart.
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1);
}

function iosSwitchLabel(): HTMLLabelElement | null {
  if (iosLabel && iosLabel.isConnected) return iosLabel;
  if (typeof document === "undefined" || !document.body) return null;
  const id = "kyna-haptic-switch";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.id = id;
  input.setAttribute("switch", "");
  input.tabIndex = -1;
  input.setAttribute("aria-hidden", "true");
  const label = document.createElement("label");
  label.htmlFor = id;
  label.setAttribute("aria-hidden", "true");
  label.appendChild(input);
  // Visually hidden but still rendered; display:none would lose the tick.
  label.style.cssText =
    "position:fixed;left:0;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;clip-path:inset(50%);";
  document.body.appendChild(label);
  iosLabel = label;
  return label;
}

function tickIos(): void {
  const label = iosSwitchLabel();
  if (!label) return;
  const prev = document.activeElement as HTMLElement | null;
  label.click();
  // Keep the keyboard up if a text field had focus (e.g. the chat reply box).
  if (prev && prev !== document.activeElement && typeof prev.focus === "function") {
    prev.focus({ preventScroll: true });
  }
}

/**
 * Play a named haptic. Call it straight from a tap handler where you can, so
 * the iPhone path works too. Never throws.
 */
export function haptic(kind: HapticKind = "tap"): void {
  try {
    const now = Date.now();
    if (!shouldFire(lastAt, now)) return;
    lastAt = now;
    if (canVibrate()) {
      navigator.vibrate(hapticPattern(kind));
      return;
    }
    if (isAppleTouch()) tickIos();
  } catch {
    // Some browsers throw without a user gesture. Haptics are a nicety.
  }
}

/** Test-only: forget the throttle. */
export function resetHapticsForTests(): void {
  lastAt = null;
}
