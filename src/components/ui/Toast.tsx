"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { AlertCircle, Check } from "lucide-react";
import { haptic } from "@/lib/ui/motion";
import { toastTiming, type ToastTone } from "@/lib/ui/toast-tone";

type Tone = ToastTone;
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

/**
 * Show a short confirmation from anywhere. Replaces the previous one.
 * Pass { haptic: true } to buzz too: an error haptic for errors, a success
 * tick otherwise. Call it from a tap handler where you can, for the iPhone.
 */
export function toast(message: string, tone: Tone = "success", opts?: { haptic?: boolean }) {
  if (opts?.haptic) haptic(tone === "error" ? "error" : "success");
  current = { id: ++seq, message, tone };
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Mount once per screen. Floats under the top bar; leaves after 2.6s, or 3.6s for errors. */
export function Toaster({ className = "" }: { className?: string }) {
  const state = useSyncExternalStore(
    subscribe,
    () => current,
    () => null
  );
  const [exitingId, setExitingId] = useState<number | null>(null);

  useEffect(() => {
    if (!state) return;
    const id = state.id;
    const timing = toastTiming(state.tone);
    const exitTimer = setTimeout(() => setExitingId(id), timing.exitAtMs);
    const clearTimer = setTimeout(() => {
      if (current?.id === id) {
        current = null;
        emit();
      }
    }, timing.durationMs);
    return () => {
      clearTimeout(exitTimer);
      clearTimeout(clearTimer);
    };
  }, [state]);

  const isExiting = state !== null && exitingId === state.id;

  return (
    <div
      aria-live="polite"
      className={`pointer-events-none fixed inset-x-0 z-[60] flex justify-center px-4 ${className}`}
      style={{ top: "calc(env(safe-area-inset-top) + 64px)" }}
    >
      {state && (
        <div
          key={state.id}
          role={toastTiming(state.tone).role}
          className={`${isExiting ? "anim-toast-out" : "anim-rise-in"} flex max-w-sm items-center gap-2 rounded-full bg-[#0f172a] px-4 py-2.5 text-sm font-semibold text-white shadow-[var(--shadow-float)] dark:bg-[#1f1f24] dark:ring-1 dark:ring-white/12`}
        >
          {state.tone === "success" ? (
            <Check className="anim-pop h-4 w-4 shrink-0 text-emerald-300" strokeWidth={3} />
          ) : (
            <span className="anim-pop inline-flex shrink-0">
              <AlertCircle className="anim-shake-sm h-4 w-4 text-red-300" />
            </span>
          )}
          <span>{state.message}</span>
        </div>
      )}
    </div>
  );
}
