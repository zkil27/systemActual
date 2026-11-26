"use client";

import { useState } from "react";
import { Button, Group } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmSheet";
import { toast } from "@/components/ui/Toast";
import { devPost, fmtAgo, fmtWhen, Note, Section, TabState, useDevData } from "../ui";

interface ErrorRow {
  id: string;
  fingerprint: string;
  source: string;
  route: string | null;
  message: string;
  stack: string | null;
  buildId: string | null;
  count: number;
  actorType: string | null;
  lastUserAgent: string | null;
  firstAt: string;
  lastAt: string;
}

const SOURCE_TONE: Record<string, string> = {
  server: "bg-missing-soft text-missing-ink",
  worker: "bg-failed-soft text-failed-ink",
  client: "bg-brand-soft text-brand",
};

const SOURCES = ["all", "server", "worker", "client"] as const;

export function ErrorsTab() {
  const { data, error, loading, reload } = useDevData<{ errors: ErrorRow[]; retentionDays: number }>("/api/dev/errors");
  const [open, setOpen] = useState<string | null>(null);
  const [source, setSource] = useState<(typeof SOURCES)[number]>("all");
  const { confirm, sheet } = useConfirm();

  if (!data) return <TabState loading={loading} error={error} onRetry={reload} />;
  const rows = data.errors.filter((e) => source === "all" || e.source === source);
  const dayAgo = Date.now() - 24 * 3600_000;

  async function resolve(id: string) {
    const res = await devPost({ action: "resolve_error", id });
    if (!res.ok) return toast(String(res.data.error ?? "Couldn't remove"), "error");
    toast("Marked fixed. It comes back if it happens again.");
    void reload();
  }

  async function clearAll() {
    const ok = await confirm({
      title: "Clear the error log?",
      message: "Removes every error group. New errors are still recorded.",
      confirmLabel: "Clear all",
      danger: true,
    });
    if (!ok) return;
    const res = await devPost({ action: "clear_errors" });
    if (!res.ok) return toast(String(res.data.error ?? "Couldn't clear"), "error");
    toast(`Cleared ${res.data.count ?? 0}`);
    void reload();
  }

  return (
    <div className="space-y-4">
      <Section
        title="Error log"
        hint={`Grouped by kind; repeats add to the count. Kept ${data.retentionDays} days after the last time it happened.`}
        action={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => void reload()} disabled={loading}>
              {loading ? "…" : "Refresh"}
            </Button>
            {data.errors.length > 0 && (
              <Button variant="danger" onClick={() => void clearAll()}>
                Clear all
              </Button>
            )}
          </div>
        }
      >
        <div className="flex flex-wrap gap-1.5 px-1">
          {SOURCES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSource(s)}
              aria-pressed={source === s}
              className={`pressable h-9 rounded-full px-3.5 text-[14px] font-semibold capitalize ${
                source === s ? "bg-ink text-ink-inverse" : "bg-surface-muted text-ink-2"
              }`}
            >
              {s} {s === "all" ? data.errors.length : data.errors.filter((e) => e.source === s).length}
            </button>
          ))}
        </div>
        <Group className="divide-y divide-hairline">
          {rows.length === 0 && <Note>No errors recorded. 🎉</Note>}
          {rows.map((e) => {
            const isOpen = open === e.id;
            const isNew = Date.parse(e.firstAt) >= dayAgo;
            return (
              <div key={e.id}>
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => setOpen(isOpen ? null : e.id)}
                  className="pressable-row flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-surface-subtle"
                >
                  <span className="mt-0.5 min-w-[42px] rounded-full bg-surface-muted px-2 py-0.5 text-center text-[13px] font-bold tabular-nums text-ink">
                    ×{e.count}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block break-words text-[15px] font-semibold text-ink">{e.message}</span>
                    <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-ink-3">
                      <span className={`rounded px-1.5 py-0.5 font-semibold ${SOURCE_TONE[e.source] ?? ""}`}>{e.source}</span>
                      {isNew && <span className="rounded bg-missing px-1.5 py-0.5 font-bold text-white">new</span>}
                      {e.route && <span className="font-mono">{e.route}</span>}
                      <span>last {fmtAgo(e.lastAt)}</span>
                    </span>
                  </span>
                </button>
                {isOpen && (
                  <div className="space-y-3 bg-surface-subtle px-4 pb-4 pt-2 text-[13px]">
                    <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-ink-2">
                      <dt className="text-ink-3">First seen</dt>
                      <dd>{fmtWhen(e.firstAt)}</dd>
                      <dt className="text-ink-3">Last seen</dt>
                      <dd>{fmtWhen(e.lastAt)}</dd>
                      <dt className="text-ink-3">Build</dt>
                      <dd className="font-mono">{e.buildId?.slice(0, 8) ?? "—"}</dd>
                      {e.actorType && (
                        <>
                          <dt className="text-ink-3">Who</dt>
                          <dd>{e.actorType.toLowerCase()}</dd>
                        </>
                      )}
                      {e.lastUserAgent && (
                        <>
                          <dt className="text-ink-3">Device</dt>
                          <dd className="break-words">{e.lastUserAgent}</dd>
                        </>
                      )}
                    </dl>
                    {e.stack ? (
                      <pre className="max-h-72 overflow-auto rounded-[var(--radius-control)] bg-surface p-3 font-mono text-[12px] leading-relaxed text-ink-2">
                        {e.stack}
                      </pre>
                    ) : (
                      <p className="text-ink-3">No stack trace.</p>
                    )}
                    <Button variant="secondary" onClick={() => void resolve(e.id)}>
                      Mark fixed
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </Group>
      </Section>
      {sheet}
    </div>
  );
}
