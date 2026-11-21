"use client";

import { useCallback, useSyncExternalStore } from "react";

export const DESKTOP_QUERY = "(min-width: 1024px)";

/** Subscribe to a CSS media query; returns `false` during SSR to match mobile-first markup. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (cb: () => void) => {
      const m = window.matchMedia(query);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    [query]
  );

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false
  );
}
