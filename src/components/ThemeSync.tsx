"use client";

import { useEffect } from "react";
import {
  THEME_STORAGE_KEY,
  applyThemeToDocument,
  emitThemeChange,
  getThemePreference,
} from "@/lib/ui/theme";

/** Keeps the active theme synced with OS appearance changes and other open tabs. */
export function ThemeSync() {
  useEffect(() => {
    applyThemeToDocument(getThemePreference());

    const mq =
      typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-color-scheme: dark)")
        : null;

    const onMediaChange = () => {
      const pref = getThemePreference();
      if (pref === "system") {
        applyThemeToDocument(pref);
        emitThemeChange();
      }
    };

    const onStorage = (e: StorageEvent) => {
      if (e.key === THEME_STORAGE_KEY || e.key === null) {
        applyThemeToDocument(getThemePreference());
        emitThemeChange();
      }
    };

    mq?.addEventListener("change", onMediaChange);
    window.addEventListener("storage", onStorage);
    return () => {
      mq?.removeEventListener("change", onMediaChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  return null;
}
