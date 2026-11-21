"use client";

import { useEffect, useSyncExternalStore } from "react";
import { AlertCircle, Check } from "lucide-react";

type Tone = "success" | "error";
interface ToastState {
  id: number;
  message: string;
  tone: Tone;
}

let current: ToastState | null = null;
let seq = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

/** Show a short confirmation from anywhere. Replaces the previous one. */
export function toast(message: string, tone: Tone = "success") {
  current = { id: ++seq, message, tone };
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Mount once per screen. Floats under the top bar and leaves after 2.6s. */
export function Toaster({ className = "" }: { className?: string }) {
  const state = useSyncExternalStore(
    subscribe,
    () => current,
    () => null
  );

  useEffect(() => {
    if (!state) return;
    const id = state.id;
    const t = setTimeout(() => {
      if (current?.id === id) {
        current = null;
        emit();
      }
    }, 2600);
    return () => clearTimeout(t);
  }, [state]);

  return (
    <div
      aria-live="polite"
      className={`pointer-events-none fixed inset-x-0 z-[60] flex justify-center px-4 ${className}`}
      style={{ top: "calc(env(safe-area-inset-top) + 64px)" }}
    >
      {state && (
        <div
          key={state.id}
          role="status"
          className="anim-rise-in flex max-w-sm items-center gap-2 rounded-full bg-ink px-4 py-2.5 text-sm font-semibold text-white shadow-[var(--shadow-float)]"
        >
          {state.tone === "success" ? (
            <Check className="h-4 w-4 shrink-0 text-emerald-300" strokeWidth={3} />
          ) : (
            <AlertCircle className="h-4 w-4 shrink-0 text-red-300" />
          )}
          <span>{state.message}</span>
        </div>
      )}
    </div>
  );
}
