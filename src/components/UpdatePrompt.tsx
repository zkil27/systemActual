"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, X } from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import { Button } from "@/components/ui/Button";
import { LATEST_RELEASE_ID, RELEASES, type Release } from "@/lib/releases";
import {
  DEV_BUILD_ID,
  decideUpdate,
  isChunkLoadError,
  parseVersionResponse,
  releasesSince,
  type UpdateKind,
} from "@/lib/update-check";

const CLIENT = {
  buildId: process.env.NEXT_PUBLIC_BUILD_ID || DEV_BUILD_ID,
  releaseId: LATEST_RELEASE_ID,
};

const CHECK_THROTTLE_MS = 60_000;
const POLL_MS = 5 * 60_000;
const SNOOZE_MS = 30 * 60_000;
/** Away this long counts as "reopened the app": snoozes and dismissals reset. */
const REOPEN_AFTER_MS = 5 * 60_000;

const RANK: Record<UpdateKind, number> = { none: 0, minor: 1, major: 2 };

function formatDate(date: string) {
  const d = new Date(`${date}T00:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

const PREVIEW_PARAM = "preview-update";

function reloadApp() {
  // Drop the preview flag, or the reload would show the preview again.
  const url = new URL(window.location.href);
  if (url.searchParams.has(PREVIEW_PARAM)) {
    url.searchParams.delete(PREVIEW_PARAM);
    window.location.replace(url.toString());
    return;
  }
  window.location.reload();
}

/**
 * Home-screen apps and long-lived tabs keep running the old JS after a deploy.
 * This polls /api/version and, when a newer build is live, shows release notes
 * (major) or a small refresh banner (minor). Mount once in the root layout.
 */
export function UpdatePrompt() {
  const [kind, setKind] = useState<UpdateKind>("none");
  const [releases, setReleases] = useState<Release[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  const snoozedUntil = useRef(0);
  const lastCheckAt = useRef(0);
  const hiddenAt = useRef<number | null>(null);
  const inFlight = useRef(false);

  const raise = useCallback((next: UpdateKind) => {
    setKind((prev) => (RANK[next] > RANK[prev] ? next : prev));
  }, []);

  const check = useCallback(
    async (force = false) => {
      if (CLIENT.buildId === DEV_BUILD_ID) return;
      if (inFlight.current) return;
      if (!force && Date.now() - lastCheckAt.current < CHECK_THROTTLE_MS) return;
      inFlight.current = true;
      lastCheckAt.current = Date.now();
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (!res.ok) return;
        const server = parseVersionResponse(await res.json());
        if (!server) return;
        const next = decideUpdate(CLIENT, server);
        if (next === "none") return;
        raise(next);
        if (next === "major") {
          setReleases(releasesSince(server.releases, CLIENT.releaseId));
          if (Date.now() >= snoozedUntil.current) setSheetOpen(true);
        }
      } catch {
        // Offline or mid-deploy. Try again on the next wake.
      } finally {
        inFlight.current = false;
      }
    },
    [raise]
  );

  // Preview without a deploy: add ?preview-update=major (or minor) to any URL.
  useEffect(() => {
    const preview = new URLSearchParams(window.location.search).get(PREVIEW_PARAM);
    if (preview === "major") {
      setReleases(RELEASES.slice(0, 3));
      setKind("major");
      setSheetOpen(true);
    } else if (preview === "minor") {
      setKind("minor");
    }
  }, []);

  useEffect(() => {
    if (CLIENT.buildId === DEV_BUILD_ID) return;

    let timer: ReturnType<typeof setInterval> | null = null;
    const startPolling = () => {
      if (timer) return;
      timer = setInterval(() => void check(true), POLL_MS);
    };
    const stopPolling = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };

    const onVisibility = () => {
      if (document.hidden) {
        hiddenAt.current = Date.now();
        stopPolling();
        return;
      }
      const awayMs = hiddenAt.current === null ? 0 : Date.now() - hiddenAt.current;
      hiddenAt.current = null;
      if (awayMs >= REOPEN_AFTER_MS) {
        snoozedUntil.current = 0;
        setBannerDismissed(false);
      }
      startPolling();
      void check(awayMs >= REOPEN_AFTER_MS);
    };
    const onFocus = () => void check();
    const onOnline = () => void check(true);

    const onError = (e: ErrorEvent) => {
      if (isChunkLoadError(e.error ?? e.message)) raise("minor");
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      if (isChunkLoadError(e.reason)) raise("minor");
    };

    void check(true);
    if (!document.hidden) startPolling();

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      stopPolling();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, [check, raise]);

  const later = useCallback(() => {
    snoozedUntil.current = Date.now() + SNOOZE_MS;
    setSheetOpen(false);
  }, []);

  const showBanner = kind !== "none" && !sheetOpen && !bannerDismissed;

  return (
    <>
      <Sheet open={sheetOpen} onClose={later} title="New update available">
        <p className="text-[15px] leading-relaxed text-ink-2">
          A newer version of Kyna Ops is ready. Refresh to start using it.
        </p>

        {releases.length > 0 && (
          <div className="mt-4 space-y-4">
            {releases.map((r) => (
              <section key={r.id} className="rounded-[var(--radius-card)] bg-surface-subtle p-4">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="text-[16px] font-bold text-ink">{r.title}</h3>
                  <span className="shrink-0 text-[13px] text-ink-3">{formatDate(r.date)}</span>
                </div>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-[15px] leading-snug text-ink-2 marker:text-ink-3">
                  {r.changes.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}

        <div className="mt-6 flex flex-col gap-2">
          <Button full onClick={reloadApp}>
            <RefreshCw className="h-[18px] w-[18px]" strokeWidth={2.4} />
            Refresh now
          </Button>
          <Button full variant="plain" onClick={later}>
            Later
          </Button>
        </div>
      </Sheet>

      {showBanner && (
        <div
          className="pointer-events-none fixed inset-x-0 z-[55] flex justify-center px-4"
          style={{ top: "calc(env(safe-area-inset-top) + 8px)" }}
        >
          <div
            role="status"
            className="anim-rise-in pointer-events-auto flex max-w-sm items-center gap-1 rounded-full bg-[#0f172a] py-1 pl-4 pr-1 text-sm font-semibold text-white shadow-[var(--shadow-float)] dark:bg-[#1f1f24] dark:ring-1 dark:ring-white/12"
          >
            <span>{kind === "major" ? "New update ready" : "Update available"}</span>
            <button
              type="button"
              onClick={reloadApp}
              className="pressable ml-1 flex h-9 items-center gap-1.5 rounded-full bg-brand-solid px-3 font-bold text-on-brand"
            >
              <RefreshCw className="h-4 w-4" strokeWidth={2.6} />
              Refresh
            </button>
            <button
              type="button"
              onClick={() => setBannerDismissed(true)}
              aria-label="Dismiss"
              className="pressable flex h-9 w-9 items-center justify-center rounded-full text-white/70 hover:text-white"
            >
              <X className="h-4 w-4" strokeWidth={2.6} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
