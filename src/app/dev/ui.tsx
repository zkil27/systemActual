"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Group } from "@/components/ui/Button";
import type { HealthLevel } from "@/lib/health";

/** Shared bits for the Developer tabs. */

export const LEVEL_DOT: Record<HealthLevel, string> = { ok: "bg-arrived", warn: "bg-failed", bad: "bg-missing" };

export function Dot({ level }: { level: HealthLevel }) {
  return <span aria-hidden="true" className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${LEVEL_DOT[level]}`} />;
}

export function useDevData<T>(url: string): {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => Promise<void>;
} {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(url, { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : `HTTP ${res.status}`);
      setData(body as T);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [url]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, error, loading, reload };
}

export async function devPost(body: Record<string, unknown>): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  try {
    const res = await fetch("/api/dev/controls", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: res.ok, data };
  } catch {
    return { ok: false, data: { error: "Network error" } };
  }
}

export function Section({
  title,
  hint,
  action,
  children,
}: {
  title: string;
  hint?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-end justify-between gap-3 px-1">
        <div className="min-w-0">
          <h2 className="text-[17px] font-bold text-ink">{title}</h2>
          {hint && <p className="text-[13px] text-ink-3">{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Note({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-3 text-[14px] text-ink-3">{children}</p>;
}

/** Loading, error, and "nothing here" states for a whole tab. */
export function TabState({ loading, error, onRetry }: { loading: boolean; error: string | null; onRetry: () => void }) {
  if (error) {
    return (
      <Group className="space-y-3 p-4">
        <p className="text-[15px] text-missing-ink">{error}</p>
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      </Group>
    );
  }
  if (loading) return <p className="px-1 text-[15px] text-ink-3">Loading…</p>;
  return null;
}

/** Wide data tables scroll sideways inside their card instead of widening the page. */
export function DataTable({
  head,
  rows,
  empty = "Nothing here.",
}: {
  head: React.ReactNode[];
  rows: React.ReactNode[][];
  empty?: string;
}) {
  if (rows.length === 0) return <Note>{empty}</Note>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-left text-[13px] tabular-nums">
        <thead className="border-b border-hairline text-ink-3">
          <tr>
            {head.map((h, i) => (
              <th key={i} className="whitespace-nowrap px-3 py-2 font-semibold first:pl-4 last:pr-4">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-hairline text-ink-2">
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j} className="px-3 py-2 align-top first:pl-4 last:pr-4">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Horizontal fill bar for usage against a limit. */
export function Meter({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max > 0 ? Math.min(1, value / max) : 0;
  const tone = pct >= 0.9 ? "bg-missing" : pct >= 0.7 ? "bg-failed" : "bg-arrived";
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between gap-3 text-[14px]">
        <span className="text-ink-2">{label}</span>
        <span className="tabular-nums font-semibold text-ink">{Math.round(pct * 100)}%</span>
      </div>
      <div
        className="h-2 overflow-hidden rounded-full bg-surface-track"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
      >
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.max(2, pct * 100)}%` }} />
      </div>
    </div>
  );
}

export function fmtMs(ms: number): string {
  if (ms >= 10_000) return `${(ms / 1000).toFixed(0)}s`;
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}

export function fmtWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function fmtAgo(iso: string | null | undefined): string {
  if (!iso) return "never";
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (m < 0) return `in ${fmtDuration(-m)}`;
  if (m < 1) return "just now";
  return `${fmtDuration(m)} ago`;
}

function fmtDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export function Notes({ notes }: { notes: Record<string, string> | undefined }) {
  const entries = Object.entries(notes ?? {});
  if (entries.length === 0) return null;
  return (
    <Group className="space-y-1 p-4">
      {entries.map(([k, v]) => (
        <p key={k} className="text-[13px] text-ink-3">
          <span className="font-semibold text-ink-2">{k}:</span> {v}
        </p>
      ))}
    </Group>
  );
}
