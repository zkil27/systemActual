"use client";

import { useEffect, useState } from "react";
import { Wrench } from "lucide-react";
import { parseMaintenanceNotice, VERSION_EVENT, type MaintenanceNotice } from "@/lib/ops-notice";

/**
 * A notice bar at the top of every screen while the developer has turned on
 * maintenance (Developer › Controls). Checks /api/version when the app opens or
 * comes back into view, and otherwise reuses <UpdatePrompt />'s poll.
 */
export function MaintenanceBanner() {
  const [notice, setNotice] = useState<MaintenanceNotice | null>(null);

  useEffect(() => {
    let lastFetch = 0;
    const apply = (body: unknown) => setNotice(parseMaintenanceNotice(body));
    const load = async () => {
      if (Date.now() - lastFetch < 30_000) return;
      lastFetch = Date.now();
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (res.ok) apply(await res.json());
      } catch {
        // Offline; keep what we have.
      }
    };
    const onVersion = (e: Event) => apply((e as CustomEvent).detail);
    const onVisible = () => {
      if (!document.hidden) void load();
    };
    void load();
    window.addEventListener(VERSION_EVENT, onVersion);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener(VERSION_EVENT, onVersion);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // Hide on time without waiting for the next check.
  useEffect(() => {
    if (!notice?.until) return;
    const ms = Date.parse(notice.until) - Date.now();
    if (ms <= 0) {
      setNotice(null);
      return;
    }
    const t = setTimeout(() => setNotice(null), Math.min(ms, 2 ** 31 - 1));
    return () => clearTimeout(t);
  }, [notice]);

  if (!notice) return null;
  return (
    <div
      role="status"
      className="relative z-50 bg-failed-soft pt-[env(safe-area-inset-top)] text-failed-ink"
    >
      <p className="mx-auto flex max-w-3xl items-center justify-center gap-2 px-4 py-2 text-center text-[14px] font-semibold">
        <Wrench className="h-4 w-4 shrink-0" strokeWidth={2.4} aria-hidden="true" />
        <span>{notice.message}</span>
      </p>
    </div>
  );
}
