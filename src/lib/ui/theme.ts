"use client";

import { useSyncExternalStore } from "react";
import { prefersReducedMotion } from "@/lib/ui/motion";

export const THEME_STORAGE_KEY = "kyna:theme";

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_COLORS = {
  light: "#f4f7f8",
  dark: "#09090b",
} as const;

export function parseThemePreference(raw: string | null): ThemePreference {
  if (raw === "light" || raw === "dark" || raw === "system") return raw;
  return "light";
}

export function resolveTheme(pref: ThemePreference, systemDark: boolean): ResolvedTheme {
  if (pref === "dark") return "dark";
  if (pref === "system") return systemDark ? "dark" : "light";
  return "light";
}

/** Runs synchronously in <head> before first paint to prevent a light/dark flash. */
export const THEME_INIT_SCRIPT = `(function(){try{var k=${JSON.stringify(
  THEME_STORAGE_KEY
)};var p=localStorage.getItem(k);if(p!=="light"&&p!=="dark"&&p!=="system")p="light";var sys=typeof window.matchMedia==="function"&&window.matchMedia("(prefers-color-scheme: dark)").matches;var d=p==="dark"||(p==="system"&&sys);var r=document.documentElement;r.classList.toggle("dark",d);r.dataset.theme=p;r.style.colorScheme=d?"dark":"light";var c=d?${JSON.stringify(
  THEME_COLORS.dark
)}:${JSON.stringify(
  THEME_COLORS.light
)};var ms=document.querySelectorAll('meta[name="theme-color"]');for(var i=0;i<ms.length;i++)ms[i].setAttribute("content",c);}catch(e){}})();`;

const listeners = new Set<() => void>();
let transitionTimer: ReturnType<typeof setTimeout> | null = null;

export function emitThemeChange(): void {
  for (const listener of listeners) listener();
}

export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSystemDark(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function getThemePreference(): ThemePreference {
  if (typeof window === "undefined") return "light";
  try {
    return parseThemePreference(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "light";
  }
}

export function getResolvedTheme(): ResolvedTheme {
  return resolveTheme(getThemePreference(), getSystemDark());
}

export function applyThemeToDocument(
  pref: ThemePreference,
  opts?: { animate?: boolean }
): ResolvedTheme {
  const resolved = resolveTheme(pref, getSystemDark());
  if (typeof document === "undefined") return resolved;

  const root = document.documentElement;
  const shouldAnimate = Boolean(opts?.animate) && !prefersReducedMotion();

  if (shouldAnimate) {
    root.classList.add("theme-transition");
    if (transitionTimer) clearTimeout(transitionTimer);
    transitionTimer = setTimeout(() => {
      root.classList.remove("theme-transition");
      transitionTimer = null;
    }, 240);
  }

  root.classList.toggle("dark", resolved === "dark");
  root.dataset.theme = pref;
  root.style.colorScheme = resolved;

  const color = THEME_COLORS[resolved];
  const metas = document.querySelectorAll('meta[name="theme-color"]');
  for (let i = 0; i < metas.length; i++) {
    metas[i].setAttribute("content", color);
  }

  return resolved;
}

export function setThemePreference(pref: ThemePreference): void {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, pref);
    } catch {
      // Private browsing / restricted storage
    }
  }
  applyThemeToDocument(pref, { animate: true });
  emitThemeChange();
}

const serverTheme = (): ThemePreference => "light";
const serverResolved = (): ResolvedTheme => "light";

export function useTheme(): {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (pref: ThemePreference) => void;
} {
  const preference = useSyncExternalStore(subscribeTheme, getThemePreference, serverTheme);
  const resolved = useSyncExternalStore(subscribeTheme, getResolvedTheme, serverResolved);
  return { preference, resolved, setPreference: setThemePreference };
}
