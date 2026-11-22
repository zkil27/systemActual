/** Pure math for the pull-to-sync gesture and scrolling chip rows. */

/** How far the finger must drag (raw px) before releasing syncs. */
export const PULL_TRIGGER = 72;
/** The furthest the indicator travels, however far the finger goes. */
export const PULL_MAX = 110;

/**
 * Raw finger travel → indicator travel. Linear-ish up to the trigger point
 * (damped by half so it feels weighty), then rubber-bands toward PULL_MAX.
 */
export function pullOffset(dy: number): number {
  if (!(dy > 0)) return 0;
  const damped = dy * 0.5;
  const knee = PULL_TRIGGER * 0.5;
  if (damped <= knee) return damped;
  const extra = damped - knee;
  const room = PULL_MAX - knee;
  return knee + room * (1 - Math.exp(-extra / room));
}

export type PullPhase = "idle" | "pulling" | "armed" | "syncing" | "done";

/** Which phase a live pull is in, from raw finger travel. */
export function pullPhase(dy: number): "idle" | "pulling" | "armed" {
  if (!(dy > 0)) return "idle";
  return dy >= PULL_TRIGGER ? "armed" : "pulling";
}

/** Visible offset of the indicator, given raw travel and phase. */
export function indicatorOffset(dy: number, phase: PullPhase): number {
  if (phase === "syncing" || phase === "done") return pullOffset(PULL_TRIGGER);
  return pullOffset(dy);
}

export interface ScrollEdges {
  /** Content hidden off the start edge. */
  start: boolean;
  /** Content hidden off the end edge. */
  end: boolean;
}

/** Whether a horizontal scroller has more content on either side. 2px slack for subpixel widths. */
export function scrollEdges(scrollLeft: number, scrollWidth: number, clientWidth: number): ScrollEdges {
  const slack = 2;
  if (scrollWidth - clientWidth <= slack) return { start: false, end: false };
  return {
    start: scrollLeft > slack,
    end: scrollLeft + clientWidth < scrollWidth - slack,
  };
}
