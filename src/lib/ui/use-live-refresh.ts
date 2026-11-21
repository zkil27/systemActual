"use client";

import { useEffect, useRef, useState } from "react";
import type { SyncStatusPayload } from "@/lib/sync/status";

export interface RefreshDelayInput {
  syncing: boolean;
  catchingUp: boolean;
  activeHint?: boolean;
  activeMs?: number;
  catchUpMs?: number;
  idleMs?: number;
}

/** Pure delay selector for adaptive, low-overhead UI polling. */
export function computeRefreshDelayMs({
  syncing,
  catchingUp,
  activeHint = false,
  activeMs = 4_000,
  catchUpMs = 15_000,
  idleMs = 45_000,
}: RefreshDelayInput): number {
  if (syncing || activeHint) return activeMs;
  if (catchingUp) return catchUpMs;
  return idleMs;
}

export interface UseLiveRefreshOptions {
  /** Called silently when server sync data actually changed or a sync completed. */
  onRefresh: () => void | Promise<void>;
  /** Hint from the page payload that a background sync was just kicked off. */
  activeHint?: boolean;
  /** Disable polling (e.g. while another dedicated poller is running). */
  enabled?: boolean;
  /** Poll interval while a sync is actively running (default 4s). */
  activeMs?: number;
  /** Poll interval while a backlog/import is catching up (default 15s). */
  catchUpMs?: number;
  /** Idle change-stamp check interval while tab is visible (default 45s). */
  idleMs?: number;
  /** Minimum gap between focus/visibility checks (default 20s). */
  focusThrottleMs?: number;
}

/**
 * Keeps a page automatically in sync without heavy blind polling:
 * - Zero requests while the tab is hidden.
 * - Checks `/api/sync/status` (a ~5ms 2-query version stamp) on tab focus/reconnect
 *   and adaptively while visible.
 * - Only calls `onRefresh()` when `version` changes or an active sync finishes.
 */
export function useLiveRefresh({
  onRefresh,
  activeHint = false,
  enabled = true,
  activeMs = 4_000,
  catchUpMs = 15_000,
  idleMs = 45_000,
  focusThrottleMs = 20_000,
}: UseLiveRefreshOptions): { isSyncing: boolean } {
  const [isSyncing, setIsSyncing] = useState(activeHint);
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  const activeHintRef = useRef(activeHint);
  activeHintRef.current = activeHint;

  const lastVersionRef = useRef<string | null>(null);
  const wasSyncingRef = useRef<boolean>(activeHint);
  const lastCheckAtRef = useRef<number>(0);
  const kickFastRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (activeHint) {
      setIsSyncing(true);
      wasSyncingRef.current = true;
      kickFastRef.current?.();
    }
  }, [activeHint]);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let inFlight = false;

    const clearTimer = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const scheduleNext = (delayMs: number) => {
      clearTimer();
      if (cancelled || document.hidden) return;
      timer = setTimeout(() => {
        void check({ trigger: true });
      }, delayMs);
    };

    kickFastRef.current = () => {
      if (!cancelled && !document.hidden && !inFlight) {
        scheduleNext(activeMs);
      }
    };

    const check = async (opts?: { trigger?: boolean }) => {
      if (cancelled || document.hidden || inFlight) return;
      inFlight = true;
      lastCheckAtRef.current = Date.now();
      let nextDelay = idleMs;
      try {
        const url = opts?.trigger ? "/api/sync/status?trigger=1" : "/api/sync/status";
        const res = await fetch(url, { cache: "no-store" });
        if (res.ok && !cancelled) {
          const data: SyncStatusPayload = await res.json();
          const prevVersion = lastVersionRef.current;
          const versionChanged = prevVersion !== null && data.version !== prevVersion;
          const justFinished = wasSyncingRef.current && !data.syncing;

          lastVersionRef.current = data.version;
          wasSyncingRef.current = data.syncing;
          setIsSyncing(data.syncing);

          if (versionChanged || justFinished) {
            await onRefreshRef.current();
          }

          nextDelay = computeRefreshDelayMs({
            syncing: data.syncing,
            catchingUp: data.catchingUp,
            activeHint: false,
            activeMs,
            catchUpMs,
            idleMs,
          });
        }
      } catch {
        // Offline or transient network blip; back off cleanly to idleMs.
      } finally {
        inFlight = false;
        scheduleNext(nextDelay);
      }
    };

    const onWake = () => {
      if (document.hidden) {
        clearTimer();
        return;
      }
      const elapsed = Date.now() - lastCheckAtRef.current;
      if (elapsed >= focusThrottleMs) {
        void check({ trigger: true });
      } else {
        scheduleNext(focusThrottleMs - elapsed);
      }
    };

    const onOnline = () => {
      if (!document.hidden) void check({ trigger: true });
    };

    // Start fast if the page already told us a background sync was kicked off;
    // otherwise wait one idle/catch-up window before first status check.
    scheduleNext(
      computeRefreshDelayMs({
        syncing: false,
        catchingUp: false,
        activeHint: activeHintRef.current,
        activeMs,
        catchUpMs,
        idleMs,
      })
    );

    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("focus", onWake);
    window.addEventListener("online", onOnline);

    return () => {
      cancelled = true;
      kickFastRef.current = null;
      clearTimer();
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("focus", onWake);
      window.removeEventListener("online", onOnline);
    };
  }, [enabled, activeMs, catchUpMs, idleMs, focusThrottleMs]);

  return { isSyncing };
}
