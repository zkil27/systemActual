"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { haptic } from "@/lib/ui/motion";
import { OverviewTab } from "./tabs/OverviewTab";
import { DatabaseTab } from "./tabs/DatabaseTab";
import { ErrorsTab } from "./tabs/ErrorsTab";
import { JobsTab } from "./tabs/JobsTab";
import { ControlsTab } from "./tabs/ControlsTab";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "database", label: "Database" },
  { id: "errors", label: "Errors" },
  { id: "jobs", label: "Jobs" },
  { id: "controls", label: "Controls" },
] as const;

type TabId = (typeof TABS)[number]["id"];

const isTab = (v: string | null): v is TabId => TABS.some((t) => t.id === v);

export function DevClient({ email }: { email: string }) {
  const [tab, setTab] = useState<TabId>("overview");

  // Remember the tab in the URL so a refresh stays put.
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (isTab(t)) setTab(t);
  }, []);
  const choose = (next: TabId) => {
    haptic("select");
    setTab(next);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    window.history.replaceState(null, "", url.toString());
  };

  return (
    <AppShell
      title="Developer"
      backHref="/settings"
      backLabel="Settings"
      width="wide"
      subtitle={<p className="text-[14px] text-ink-3">Only you can see this · {email}</p>}
    >
      <nav aria-label="Developer sections" className="-mx-5 mb-5 overflow-x-auto px-5 lg:mx-0 lg:px-0">
        <div className="inline-flex gap-1 rounded-[var(--radius-control)] bg-surface-track/80 p-[3px]">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-current={tab === t.id ? "page" : undefined}
              onClick={() => choose(t.id)}
              className={`pressable h-10 whitespace-nowrap rounded-[9px] px-4 text-[15px] transition-colors ${
                tab === t.id
                  ? "bg-surface font-bold text-ink shadow-[0_1px_3px_rgb(15_23_42/0.12)] dark:ring-1 dark:ring-white/10"
                  : "font-semibold text-ink-2 hover:text-ink"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </nav>

      {tab === "overview" && <OverviewTab onOpen={choose} />}
      {tab === "database" && <DatabaseTab />}
      {tab === "errors" && <ErrorsTab />}
      {tab === "jobs" && <JobsTab />}
      {tab === "controls" && <ControlsTab />}
    </AppShell>
  );
}

export type { TabId };
