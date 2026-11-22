"use client";

import { Check, RefreshCw } from "lucide-react";
import { PULL_TRIGGER, indicatorOffset } from "@/lib/ui/pull";
import type { PullToRefreshState } from "@/lib/ui/use-pull-to-refresh";

const LABEL = {
  idle: "Pull to sync",
  pulling: "Pull to sync",
  armed: "Release to sync",
  syncing: "Syncing…",
  done: "Synced",
} as const;

/**
 * The bubble that drops from under the top bar while the page is pulled.
 * The finger drives it directly; only the settle back up is animated.
 */
export function PullIndicator({ phase, dy, sidebar = true }: PullToRefreshState & { sidebar?: boolean }) {
  const visible = phase !== "idle";
  const offset = indicatorOffset(dy, phase);
  const progress = Math.min(1, dy / PULL_TRIGGER);
  const following = phase === "pulling" || phase === "armed";

  return (
    <div
      aria-hidden={!visible}
      className={`pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+48px)] z-20 flex justify-center ${sidebar ? "lg:top-16 lg:pl-60" : ""}`}
    >
      <div
        role="status"
        aria-live="polite"
        className={`flex h-10 items-center gap-2 rounded-full bg-surface pl-3 pr-4 text-[14px] font-semibold shadow-[var(--shadow-float)] ring-1 ring-ink/[0.08] motion-reduce:transition-none ${
          following ? "" : "transition-[transform,opacity] duration-300 ease-[var(--ease-ios)]"
        } ${phase === "armed" || phase === "syncing" ? "text-brand" : phase === "done" ? "text-arrived" : "text-ink-2"}`}
        style={{
          transform: `translateY(${visible ? offset - 40 : -56}px)`,
          opacity: visible ? Math.max(0.35, progress) : 0,
        }}
      >
        {phase === "done" ? (
          <Check className="anim-pop h-[18px] w-[18px]" strokeWidth={2.8} />
        ) : (
          <RefreshCw
            className={`h-[18px] w-[18px] ${phase === "syncing" ? "anim-spin" : ""}`}
            style={phase === "syncing" ? undefined : { transform: `rotate(${progress * 270}deg)` }}
          />
        )}
        <span>{visible ? LABEL[phase] : ""}</span>
      </div>
    </div>
  );
}
