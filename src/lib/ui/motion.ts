/** Motion constants shared by CSS-in-JS transitions and the count-up hook. */
export const DURATION = {
  fast: 120,
  base: 250,
  sheet: 350,
  slow: 400,
} as const;

export const EASE_IOS = "cubic-bezier(0.32, 0.72, 0, 1)";

export function clamp01(t: number): number {
  if (Number.isNaN(t)) return 0;
  return Math.min(1, Math.max(0, t));
}

/** Exponential ease-out: fast start, gentle landing. Exactly 0 at 0, 1 at 1. */
export function easeOutExpo(t: number): number {
  const x = clamp01(t);
  return x === 1 ? 1 : 1 - Math.pow(2, -10 * x);
}

export function interpolate(from: number, to: number, t: number): number {
  return from + (to - from) * clamp01(t);
}

/** The integer a counter shows `elapsedMs` into a count from `from` to `to`. */
export function countFrame(
  from: number,
  to: number,
  elapsedMs: number,
  durationMs: number = DURATION.slow
): number {
  if (durationMs <= 0) return to;
  return Math.round(interpolate(from, to, easeOutExpo(elapsedMs / durationMs)));
}

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Named haptics (Android vibrate, iPhone switch tick). See `haptics.ts`. */
export { haptic, type HapticKind } from "@/lib/ui/haptics";
