"use client";

import { useEffect, useRef, useState } from "react";
import { DURATION, countFrame, prefersReducedMotion } from "@/lib/ui/motion";

/**
 * Counts from the previous value to the new one. The first render counts up
 * from 0 so a fresh report reads as "just arrived". Under Reduce Motion it
 * shows the value straight away.
 */
export function useAnimatedNumber(value: number, durationMs: number = DURATION.slow): number {
  // Always 0 on the first render so server and client HTML match.
  const [shown, setShown] = useState(0);
  const fromRef = useRef(shown);
  const shownRef = useRef(shown);
  shownRef.current = shown;

  useEffect(() => {
    if (prefersReducedMotion()) {
      setShown(value);
      return;
    }
    fromRef.current = shownRef.current;
    if (fromRef.current === value) return;

    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const next = countFrame(fromRef.current, value, now - start, durationMs);
      setShown(next);
      if (now - start < durationMs) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, durationMs]);

  return shown;
}

const defaultFormat = (n: number) => n.toLocaleString("en-PH");

export function AnimatedNumber({
  value,
  className,
  format = defaultFormat,
}: {
  value: number;
  className?: string;
  format?: (value: number) => string;
}) {
  const shown = useAnimatedNumber(value);
  return (
    <span className={`tabular-nums ${className ?? ""}`}>
      {/* Screen readers get the real value, not the in-between frames. */}
      <span aria-hidden="true">{format(shown)}</span>
      <span className="sr-only">{format(value)}</span>
    </span>
  );
}
