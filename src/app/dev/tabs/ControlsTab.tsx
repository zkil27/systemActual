"use client";

import { useState } from "react";
import { Button, Group } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmSheet";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Switch } from "@/components/ui/Switch";
import { toast } from "@/components/ui/Toast";
import type { EnvStatus } from "@/lib/dev/env-check";
import type { MigrationStatus } from "@/lib/dev/db-health";
import { formatBytes } from "@/lib/dev/overview";
import { MAX_MAINTENANCE_MESSAGE, type MaintenanceNotice } from "@/lib/ops-notice";
import { devPost, Dot, fmtAgo, fmtMs, fmtWhen, Note, Notes, Section, TabState, useDevData } from "../ui";

interface ControlsResponse {
  notes: Record<string, string>;
  build: { buildId: string; releaseId: number; vercelEnv: string; region: string | null; node: string; branch: string | null };
  migrations: MigrationStatus | null;
  printer: {
    name: string;
    lastSeenAt: string | null;
    agentVersion: string | null;
    lastBackupAt: string | null;
    lastBackupBytes: number | null;
    lastBackupError: string | null;
  } | null;
  switches: { workerPaused: boolean; maintenance: MaintenanceNotice | null };
  settings: { workerPaused: boolean; maintenanceMessage: string | null; maintenanceUntil: string | null } | null;
  env: EnvStatus[];
}

const DURATIONS = [
  { id: "30", label: "30 min" },
  { id: "120", label: "2 hours" },
  { id: "0", label: "Until off" },
] as const;

export function ControlsTab() {
  const { data, error, loading, reload } = useDevData<ControlsResponse>("/api/dev/controls");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("Kyna Ops is being updated. Some screens may be slow for a few minutes.");
  const [duration, setDuration] = useState<(typeof DURATIONS)[number]["id"]>("30");
  const { confirm, sheet } = useConfirm();

  if (!data) return <TabState loading={loading} error={error} onRetry={reload} />;
  const switchesReady = data.settings !== null;

  async function act(key: string, body: Record<string, unknown>, done: (d: Record<string, unknown>) => string) {
    setBusy(key);
    const res = await devPost(body);
    setBusy(null);
    if (!res.ok) {
      toast(String(res.data.error ?? "Didn't work"), "error");
      return false;
    }
    toast(done(res.data));
    void reload();
    return true;
  }

  async function togglePause(next: boolean) {
    if (next) {
      const ok = await confirm({
        title: "Pause the background worker?",
        message: "Orders, returns, stock pushes, waves, chats and the 8 PM brief stop until you turn it back on. The owner sees “Paused by the developer” in Settings › Health.",
        confirmLabel: "Pause worker",
        danger: true,
      });
      if (!ok) return;
    }
    await act("pause", { action: "set_worker_paused", paused: next }, () => (next ? "Worker paused" : "Worker running again"));
  }

  async function testServerError() {
    setBusy("server-error");
    await fetch("/api/dev/controls", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "test_server_error" }),
    }).catch(() => undefined);
    setBusy(null);
    toast("Thrown on the server. Check Errors in a few seconds.");
  }

  function testClientError() {
    // Thrown outside React so the global handler (not an error boundary) reports it.
    setTimeout(() => {
      throw new Error(`Test client error from Developer › Controls (${new Date().toISOString().slice(0, 16)})`);
    }, 0);
    toast("Thrown in this browser. Check Errors in a few seconds.");
  }

  const env = data.env;
  const missingRequired = env.filter((e) => e.required && !e.set);
  const groups = [...new Set(env.map((e) => e.group))];
  const m = data.migrations;

  return (
    <div className="space-y-6">
      <Section title="Worker">
        <Group className="divide-y divide-hairline">
          <div className="flex items-center justify-between gap-4 px-4 py-3">
            <span className="min-w-0">
              <span className="block text-[16px] text-ink">Pause background worker</span>
              <span className="block text-[13px] text-ink-3">Kill switch for every tick: printer PC, webhooks and cron.</span>
            </span>
            <Switch
              label="Pause background worker"
              checked={data.switches.workerPaused}
              disabled={!switchesReady || busy === "pause"}
              onChange={(next) => void togglePause(next)}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <span className="min-w-0">
              <span className="block text-[16px] text-ink">Run a tick now</span>
              <span className="block text-[13px] text-ink-3">Takes up to 90 seconds. Skips if one is already running.</span>
            </span>
            <Button
              variant="secondary"
              disabled={busy === "tick" || data.switches.workerPaused}
              onClick={() => void act("tick", { action: "run_tick" }, (d) => (d.ran ? `Tick done in ${fmtMs(Number(d.ms ?? 0))}` : "Skipped: another tick is running"))}
            >
              {busy === "tick" ? "Running…" : "Run tick"}
            </Button>
          </div>
        </Group>
      </Section>

      <Section title="Maintenance banner" hint="Shows a notice bar at the top of every screen, including staff phones. Updates within about 5 minutes on open phones.">
        <Group className="space-y-3 p-4">
          {data.switches.maintenance ? (
            <>
              <p className="text-[15px] text-ink">
                <span className="font-semibold">On:</span> {data.switches.maintenance.message}
              </p>
              <p className="text-[13px] text-ink-3">
                {data.switches.maintenance.until ? `Hides itself ${fmtAgo(data.switches.maintenance.until)}` : "Until you turn it off"}
              </p>
              <Button
                variant="secondary"
                disabled={busy === "maint"}
                onClick={() => void act("maint", { action: "clear_maintenance" }, () => "Banner off")}
              >
                Turn off
              </Button>
            </>
          ) : (
            <>
              <label className="block">
                <span className="mb-1 block text-[13px] font-semibold text-ink-3">Message</span>
                <textarea
                  value={message}
                  maxLength={MAX_MAINTENANCE_MESSAGE}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={2}
                  className="w-full rounded-[var(--radius-control)] bg-surface-muted px-3 py-2 text-[16px] text-ink outline-none focus:ring-2 focus:ring-brand"
                />
              </label>
              <SegmentedControl label="How long" options={DURATIONS} value={duration} onChange={setDuration} />
              <Button
                disabled={!switchesReady || busy === "maint" || !message.trim()}
                onClick={() =>
                  void act("maint", { action: "set_maintenance", message, minutes: Number(duration) }, () => "Banner on")
                }
              >
                Show banner
              </Button>
            </>
          )}
        </Group>
      </Section>

      <Section title="Test the error log">
        <Group className="flex flex-wrap gap-2 p-4">
          <Button variant="secondary" disabled={busy === "server-error"} onClick={() => void testServerError()}>
            Throw server error
          </Button>
          <Button variant="secondary" onClick={testClientError}>
            Throw browser error
          </Button>
        </Group>
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="This build">
          <Group>
            <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-2 p-4 text-[14px]">
              <dt className="text-ink-3">Commit</dt>
              <dd className="font-mono text-ink">{data.build.buildId.slice(0, 10)}</dd>
              <dt className="text-ink-3">Branch</dt>
              <dd className="text-ink">{data.build.branch ?? "—"}</dd>
              <dt className="text-ink-3">Environment</dt>
              <dd className="text-ink">
                {data.build.vercelEnv}
                {data.build.region ? ` · ${data.build.region}` : ""}
              </dd>
              <dt className="text-ink-3">Release note</dt>
              <dd className="text-ink">#{data.build.releaseId}</dd>
              <dt className="text-ink-3">Node</dt>
              <dd className="text-ink">{data.build.node}</dd>
            </dl>
          </Group>
        </Section>

        <Section title="Backup" hint="Nightly pg_dump on the printer PC. Supabase Free has no backups of its own.">
          <Group>
            {!data.printer ? (
              <Note>No printer PC set up, so no nightly backup.</Note>
            ) : (
              <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-2 p-4 text-[14px]">
                <dt className="text-ink-3">Last backup</dt>
                <dd className="flex items-center gap-2 text-ink">
                  <Dot
                    level={
                      data.printer.lastBackupError
                        ? "bad"
                        : !data.printer.lastBackupAt || Date.now() - Date.parse(data.printer.lastBackupAt) > 36 * 3600_000
                          ? "warn"
                          : "ok"
                    }
                  />
                  {data.printer.lastBackupAt ? `${fmtWhen(data.printer.lastBackupAt)} (${fmtAgo(data.printer.lastBackupAt)})` : "never"}
                </dd>
                <dt className="text-ink-3">Size</dt>
                <dd className="text-ink">{data.printer.lastBackupBytes ? formatBytes(data.printer.lastBackupBytes) : "—"}</dd>
                {data.printer.lastBackupError && (
                  <>
                    <dt className="text-ink-3">Error</dt>
                    <dd className="text-missing-ink">{data.printer.lastBackupError}</dd>
                  </>
                )}
                <dt className="text-ink-3">PC</dt>
                <dd className="text-ink">
                  {data.printer.name} · seen {fmtAgo(data.printer.lastSeenAt)}
                  {data.printer.agentVersion ? ` · agent ${data.printer.agentVersion}` : ""}
                </dd>
              </dl>
            )}
          </Group>
        </Section>
      </div>

      <Section
        title="Migrations"
        hint={m ? `${m.applied.length} applied · ${m.pending.length} pending${m.failed.length ? ` · ${m.failed.length} failed` : ""}` : undefined}
      >
        <Group>
          {!m ? (
            <Note>Couldn&apos;t read migrations.</Note>
          ) : m.expected.length === 0 ? (
            <Note>This build doesn&apos;t carry a migration list (local dev server started before this change?).</Note>
          ) : m.pending.length === 0 && m.failed.length === 0 ? (
            <Note>The database matches this build.</Note>
          ) : (
            <ul className="divide-y divide-hairline text-[14px]">
              {m.failed.map((name) => (
                <li key={name} className="flex items-center gap-2 px-4 py-2.5">
                  <Dot level="bad" />
                  <span className="font-mono text-[13px] text-ink">{name}</span>
                  <span className="text-missing-ink">failed: fix, then prisma migrate resolve</span>
                </li>
              ))}
              {m.pending.map((name) => (
                <li key={name} className="flex items-center gap-2 px-4 py-2.5">
                  <Dot level="warn" />
                  <span className="font-mono text-[13px] text-ink">{name}</span>
                </li>
              ))}
              <li className="px-4 py-2.5 text-[13px] text-ink-3">
                Apply with <code className="font-mono">npm run db:deploy</code> (uses DIRECT_URL).
              </li>
            </ul>
          )}
          {m && m.unknown.length > 0 && (
            <p className="border-t border-hairline px-4 py-2.5 text-[13px] text-ink-3">
              In the database but not in this build: {m.unknown.join(", ")}
            </p>
          )}
        </Group>
      </Section>

      <Section
        title="Environment variables"
        hint={missingRequired.length ? `${missingRequired.length} required missing` : "Names only. Values never leave the server."}
      >
        <Group className="divide-y divide-hairline">
          {groups.map((g) => (
            <div key={g} className="px-4 py-3">
              <p className="mb-1.5 text-[13px] font-semibold text-ink-3">{g}</p>
              <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                {env
                  .filter((e) => e.group === g)
                  .map((e) => (
                    <li key={e.name} className="flex items-center gap-2 text-[13px]" title={e.purpose}>
                      <Dot level={e.set ? "ok" : e.required ? "bad" : "warn"} />
                      <span className="font-mono text-ink">{e.name}</span>
                      {!e.set && <span className="truncate text-ink-3">· {e.purpose} off</span>}
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </Group>
      </Section>

      <Notes notes={data.notes} />
      {sheet}
    </div>
  );
}
