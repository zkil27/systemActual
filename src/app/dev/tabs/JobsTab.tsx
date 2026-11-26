"use client";

import { useState } from "react";
import { Button, Group } from "@/components/ui/Button";
import { toast } from "@/components/ui/Toast";
import type { StepSummary } from "@/lib/dev/jobs";
import type { StepTiming } from "@/lib/dev/tick-context";
import { DataTable, devPost, Dot, fmtAgo, fmtMs, fmtWhen, Note, Notes, Section, TabState, useDevData } from "../ui";

interface JobsResponse {
  notes: Record<string, string>;
  runs: Array<{
    id: string;
    trigger: string;
    startedAt: string;
    durationMs: number;
    ran: boolean;
    ok: boolean;
    error: string | null;
    steps: StepTiming[];
    shopsTicked: number;
  }>;
  runCount24h: number | null;
  skipped24h: number | null;
  stepSummary: StepSummary[] | null;
  events: Array<{
    id: string;
    platform: string;
    eventType: string;
    orderSn: string | null;
    receivedAt: string;
    attempts: number;
    error: string | null;
  }> | null;
  eventCounts: { failed: number; waiting: number; processed24h: number } | null;
  shops: Array<{
    id: string;
    platform: string;
    shopName: string;
    connected: boolean;
    tokenExpiresAt: string | null;
    tokenErrorAt: string | null;
    tokenError: string | null;
    lastSyncedAt: string | null;
    writesEnabled: boolean;
  }> | null;
  apiStats: Array<{
    platform: string;
    shopKey: string;
    pathKey: string;
    calls: number;
    errors: number;
    throttled: number;
    avgMs: number;
  }> | null;
  printJobs: Array<{ id: string; kind: string; title: string; attempts: number; error: string | null; createdAt: string }> | null;
  aiUsage: Array<{
    id: string;
    provider: string;
    model: string;
    dayKey: string;
    requests: number;
    errors: number;
    tokensIn: number;
    tokensOut: number;
    cap: number | null;
  }> | null;
}

/** The tick has a 90 s budget; steps are coloured by how much of it they use. */
const TICK_BUDGET_MS = 90_000;

export function JobsTab() {
  const { data, error, loading, reload } = useDevData<JobsResponse>("/api/dev/jobs");
  const [openRun, setOpenRun] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  if (!data) return <TabState loading={loading} error={error} onRetry={reload} />;

  async function act(key: string, body: Record<string, unknown>, done: (d: Record<string, unknown>) => string) {
    setBusy(key);
    const res = await devPost(body);
    setBusy(null);
    if (!res.ok) return toast(String(res.data.error ?? "Didn't work"), "error");
    toast(done(res.data));
    void reload();
  }

  const apiTotals = (data.apiStats ?? []).reduce(
    (t, a) => ({ calls: t.calls + a.calls, errors: t.errors + a.errors, throttled: t.throttled + a.throttled }),
    { calls: 0, errors: 0, throttled: 0 }
  );

  return (
    <div className="space-y-6">
      <Section
        title="Worker ticks (24h)"
        hint={
          data.runCount24h === null
            ? undefined
            : `${data.runCount24h} ticks · ${data.skipped24h ?? 0} skipped (another tick was running or the worker is paused). Steps are slowest first.`
        }
        action={
          <Button variant="secondary" onClick={() => void reload()} disabled={loading}>
            {loading ? "…" : "Refresh"}
          </Button>
        }
      >
        <Group>
          <DataTable
            head={["Step", "Runs", "Avg", "p95", "Max", "Errors"]}
            rows={(data.stepSummary ?? []).map((s) => [
              <span key="n" className="font-semibold text-ink">
                {s.name}
              </span>,
              s.runs,
              fmtMs(s.avgMs),
              <span key="p" className={s.p95Ms > TICK_BUDGET_MS * 0.5 ? "font-semibold text-failed-ink" : ""}>
                {fmtMs(s.p95Ms)}
              </span>,
              fmtMs(s.maxMs),
              <span key="e" className={s.errors ? "font-semibold text-missing-ink" : ""}>
                {s.errors}
              </span>,
            ])}
            empty={data.stepSummary ? "No ticks recorded in the last 24 hours." : "n/a"}
          />
        </Group>
      </Section>

      <Section title="Recent ticks">
        <Group className="divide-y divide-hairline">
          {data.runs.length === 0 && <Note>No ticks recorded yet.</Note>}
          {data.runs.map((r) => {
            const isOpen = openRun === r.id;
            const level = !r.ran ? "warn" : r.ok ? "ok" : "bad";
            return (
              <div key={r.id}>
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => setOpenRun(isOpen ? null : r.id)}
                  className="pressable-row flex w-full items-center gap-3 px-4 py-2.5 text-left text-[14px] hover:bg-surface-subtle"
                >
                  <Dot level={level} />
                  <span className="w-28 shrink-0 text-ink-2">{fmtWhen(r.startedAt)}</span>
                  <span className="w-16 shrink-0 tabular-nums font-semibold text-ink">{fmtMs(r.durationMs)}</span>
                  <span className="min-w-0 truncate text-ink-3">
                    {r.trigger}
                    {!r.ran ? " · skipped" : ` · ${r.shopsTicked} shop${r.shopsTicked === 1 ? "" : "s"}`}
                    {r.error ? ` · ${r.error}` : ""}
                  </span>
                </button>
                {isOpen && (
                  <ul className="space-y-1 bg-surface-subtle px-4 pb-3 pt-1 text-[13px]">
                    {r.steps.length === 0 && <li className="text-ink-3">No steps recorded.</li>}
                    {r.steps.map((s, i) => (
                      <li key={i} className="flex items-center gap-3">
                        <span className="w-36 shrink-0 truncate font-mono text-ink-2">{s.name}</span>
                        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-track">
                          <span
                            className={`block h-full rounded-full ${s.error ? "bg-missing" : "bg-brand-solid"}`}
                            style={{ width: `${Math.max(1, Math.min(100, (s.ms / TICK_BUDGET_MS) * 100))}%` }}
                          />
                        </span>
                        <span className="w-14 shrink-0 text-right tabular-nums text-ink-2">{fmtMs(s.ms)}</span>
                        {s.error && <span className="min-w-0 basis-full truncate text-missing-ink">{s.error}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </Group>
      </Section>

      <Section
        title="Webhook inbox"
        hint={
          data.eventCounts
            ? `${data.eventCounts.processed24h} handled in 24h · ${data.eventCounts.waiting} waiting · ${data.eventCounts.failed} gave up after 5 tries`
            : undefined
        }
        action={
          (data.events?.length ?? 0) > 0 ? (
            <Button
              variant="secondary"
              disabled={busy === "retry-all"}
              onClick={() => void act("retry-all", { action: "retry_failed_events" }, (d) => `Queued ${d.count ?? 0} for the next tick`)}
            >
              Retry all
            </Button>
          ) : undefined
        }
      >
        <Group>
          <DataTable
            head={["Received", "Platform", "Event", "Order", "Tries", "Error", ""]}
            rows={(data.events ?? []).map((e) => [
              fmtWhen(e.receivedAt),
              e.platform,
              e.eventType,
              e.orderSn ?? "—",
              e.attempts,
              <span key="e" className="block max-w-[280px] break-words text-missing-ink">
                {e.error ?? "not handled yet"}
              </span>,
              <Button
                key="r"
                variant="plain"
                disabled={busy === e.id}
                onClick={() => void act(e.id, { action: "retry_event", id: e.id }, () => "Queued for the next tick")}
              >
                Retry
              </Button>,
            ])}
            empty={data.events ? "No failed or stuck events." : "n/a"}
          />
        </Group>
      </Section>

      <Section title="Shop connections" hint="Tokens refresh themselves 30 minutes before they expire, during a tick.">
        <Group className="divide-y divide-hairline">
          {(data.shops ?? []).length === 0 && <Note>No shops connected.</Note>}
          {(data.shops ?? []).map((s) => {
            const expired = s.tokenExpiresAt ? Date.parse(s.tokenExpiresAt) < Date.now() : false;
            return (
              <div key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <Dot level={s.tokenErrorAt ? "bad" : !s.connected || expired ? "warn" : "ok"} />
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-semibold text-ink">
                    {s.shopName} <span className="font-normal text-ink-3">· {s.platform}</span>
                  </p>
                  <p className="text-[13px] text-ink-3">
                    {s.connected ? `Token ${expired ? "expired" : "expires"} ${fmtAgo(s.tokenExpiresAt)}` : "Not connected"} · synced{" "}
                    {fmtAgo(s.lastSyncedAt)} · writes {s.writesEnabled ? "on" : "off"}
                  </p>
                  {s.tokenError && <p className="text-[13px] text-missing-ink">{s.tokenError}</p>}
                </div>
                {s.connected && (
                  <Button
                    variant="secondary"
                    disabled={busy === s.id}
                    onClick={() =>
                      void act(s.id, { action: "refresh_token", shopConnectionId: s.id }, (d) => `Refreshed · expires ${fmtAgo(String(d.expiresAt ?? ""))}`)
                    }
                  >
                    {busy === s.id ? "Refreshing…" : "Refresh token"}
                  </Button>
                )}
              </div>
            );
          })}
        </Group>
      </Section>

      <Section
        title="Marketplace API calls (24h)"
        hint={`Counted during worker ticks. ${apiTotals.calls.toLocaleString()} calls · ${apiTotals.errors} errors · ${apiTotals.throttled} rate-limited (429).`}
      >
        <Group>
          <DataTable
            head={["Platform", "Shop", "Endpoint", "Calls", "Errors", "429s", "Avg"]}
            rows={(data.apiStats ?? []).map((a) => [
              a.platform,
              <span key="s" className="font-mono text-[12px]">
                {a.shopKey === "-" ? "—" : `…${a.shopKey.slice(-6)}`}
              </span>,
              <span key="p" className="font-mono text-[12px]">
                {a.pathKey}
              </span>,
              a.calls.toLocaleString(),
              <span key="e" className={a.errors ? "text-missing-ink" : ""}>
                {a.errors}
              </span>,
              <span key="t" className={a.throttled ? "font-semibold text-failed-ink" : ""}>
                {a.throttled}
              </span>,
              fmtMs(a.avgMs),
            ])}
            empty={data.apiStats ? "No calls recorded in the last 24 hours." : "n/a"}
          />
        </Group>
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="AI usage today" hint="Requests against each free tier's daily cap.">
          <Group>
            <DataTable
              head={["Provider", "Model", "Requests", "Errors", "Tokens in/out"]}
              rows={(data.aiUsage ?? []).map((u) => [
                u.provider,
                <span key="m" className="font-mono text-[12px]">
                  {u.model === "*" ? "all models" : u.model}
                </span>,
                <span key="r" className={u.cap && u.requests >= u.cap * 0.8 ? "font-semibold text-failed-ink" : ""}>
                  {u.requests}
                  {u.cap ? ` / ${u.cap}` : ""}
                </span>,
                u.errors,
                `${u.tokensIn.toLocaleString()} / ${u.tokensOut.toLocaleString()}`,
              ])}
              empty={data.aiUsage ? "No AI calls in the last 24 hours." : "n/a"}
            />
          </Group>
        </Section>
        <Section title="Failed print jobs (7 days)">
          <Group>
            <DataTable
              head={["When", "Kind", "Title", "Error"]}
              rows={(data.printJobs ?? []).map((p) => [
                fmtWhen(p.createdAt),
                p.kind,
                p.title,
                <span key="e" className="text-missing-ink">
                  {p.error ?? "—"}
                </span>,
              ])}
              empty={data.printJobs ? "No failures." : "n/a"}
            />
          </Group>
        </Section>
      </div>

      <Notes notes={data.notes} />
    </div>
  );
}
