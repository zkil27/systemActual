export type ToastTone = "success" | "error";

/** How a toast of each tone is announced and how long it stays. */
export interface ToastTiming {
  /** Errors interrupt the screen reader; confirmations wait their turn. */
  role: "status" | "alert";
  /** When the exit animation starts. */
  exitAtMs: number;
  /** When it's removed, after the 180ms exit. */
  durationMs: number;
}

const EXIT_MS = 180;

export function toastTiming(tone: ToastTone): ToastTiming {
  const durationMs = tone === "error" ? 3600 : 2600;
  return {
    role: tone === "error" ? "alert" : "status",
    exitAtMs: durationMs - EXIT_MS,
    durationMs,
  };
}
