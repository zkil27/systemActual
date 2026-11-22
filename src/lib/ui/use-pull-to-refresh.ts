"use client";

import { useEffect, useRef, useState } from "react";
import { haptic } from "@/lib/ui/motion";
import { PULL_TRIGGER, pullPhase, type PullPhase } from "@/lib/ui/pull";

const DONE_MS = 900;

export interface PullToRefreshState {
  phase: PullPhase;
  /** Raw finger travel in px while pulling; 0 otherwise. */
  dy: number;
}

function pullBlocked(target: EventTarget | null): boolean {
  if (window.scrollY > 0) return true;
  // A Sheet locks body scroll while open; pulls belong to the sheet then.
  if (document.body.style.overflow === "hidden") return true;
  const el = target instanceof Element ? target : null;
  return Boolean(el?.closest('[role="dialog"],[data-no-pull],input,textarea,select,video'));
}

/**
 * Pull down from the top of the page to sync, like a phone browser.
 * Touch only; mouse and pen never start it. Horizontal drags (chip rows)
 * are let through. The native pull-to-reload is turned off in globals.css.
 */
export function usePullToRefresh(
  onRefresh: (() => Promise<unknown> | void) | undefined,
  enabled = true
): PullToRefreshState {
  const [state, setState] = useState<PullToRefreshState>({ phase: "idle", dy: 0 });
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;
  const busyRef = useRef(false);

  const hasRefresh = Boolean(onRefresh);

  useEffect(() => {
    if (!enabled || !hasRefresh) return;

    let start: { x: number; y: number } | null = null;
    let decided: "pull" | "ignore" | null = null;
    let dy = 0;
    let armed = false;
    let frame = 0;

    const push = (next: PullToRefreshState) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setState(next));
    };

    const reset = () => {
      start = null;
      decided = null;
      dy = 0;
      armed = false;
    };

    const onStart = (e: TouchEvent) => {
      if (busyRef.current || e.touches.length !== 1 || pullBlocked(e.target)) {
        reset();
        return;
      }
      start = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      decided = null;
      dy = 0;
      armed = false;
    };

    const onMove = (e: TouchEvent) => {
      if (!start || decided === "ignore") return;
      const t = e.touches[0];
      const rawDy = t.clientY - start.y;
      const rawDx = t.clientX - start.x;

      if (decided === null) {
        if (Math.abs(rawDx) < 6 && Math.abs(rawDy) < 6) return;
        decided = rawDy > 0 && Math.abs(rawDy) > Math.abs(rawDx) && window.scrollY <= 0 ? "pull" : "ignore";
        if (decided === "ignore") return;
      }

      if (e.cancelable) e.preventDefault();
      dy = Math.max(0, rawDy);
      const nowArmed = dy >= PULL_TRIGGER;
      if (nowArmed && !armed) haptic(8);
      armed = nowArmed;
      push({ phase: pullPhase(dy), dy });
    };

    const onEnd = async () => {
      if (decided !== "pull") {
        reset();
        return;
      }
      const fire = armed;
      reset();
      if (!fire) {
        push({ phase: "idle", dy: 0 });
        return;
      }
      busyRef.current = true;
      push({ phase: "syncing", dy: PULL_TRIGGER });
      try {
        await onRefreshRef.current?.();
      } catch {
        // Pages report their own errors with a toast.
      }
      push({ phase: "done", dy: PULL_TRIGGER });
      setTimeout(() => {
        busyRef.current = false;
        push({ phase: "idle", dy: 0 });
      }, DONE_MS);
    };

    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd);
    document.addEventListener("touchcancel", onEnd);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", onEnd);
    };
  }, [enabled, hasRefresh]);

  return state;
}
