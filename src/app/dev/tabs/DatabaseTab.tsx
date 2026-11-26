"use client";

import { useState } from "react";
import { Button, Group } from "@/components/ui/Button";
import { toast } from "@/components/ui/Toast";
import type { DbHealth } from "@/lib/dev/db-health";
import { formatBytes } from "@/lib/dev/overview";
import { DataTable, devPost, fmtAgo, fmtMs, Meter, Note, Notes, Section, TabState, useDevData } from "../ui";

type DbResponse = DbHealth & { quotaBytes: number; diskBytes: number };

const RETENTION_TONE: Record<string, string> = {
  rule: "text-arrived",
  bounded: "text-ink-3",
  cascade: "text-ink-3",
  none: "text-missing-ink font-semibold",
};

const pct = (v: number | null) => (v === null ? "n/a" : `${(v * 100).toFixed(1)}%`);

export function DatabaseTab() {
  const { data, error, loading, reload } = useDevData<DbResponse>("/api/dev/db");
  const [showAllTables, setShowAllTables] = useState(false);
  const [resetting, setResetting] = useState(false);

  if (!data) return <TabState loading={loading} error={error} onRetry={reload} />;

  const tables = data.tables ?? [];
  const shownTables = showAllTables ? tables : tables.slice(0, 15);
  const noRule = tables.filter((t) => t.retention === "none");

  async function resetStats() {
    setResetting(true);
    const res = await devPost({ action: "reset_query_stats" });
    setResetting(false);
    if (!res.ok) return toast(String(res.data.error ?? "Couldn't reset"), "error");
    toast("Query stats reset");
    void reload();
  }

  return (
    <div className="space-y-6">
      <Section
        title="Free-tier limits"
        hint="Supabase Free: 500 MB database quota. The 2 GB disk turns read-only at 95%, and only VACUUM gives space back."
        action={
          <Button variant="secondary" onClick={() => void reload()} disabled={loading}>
            {loading ? "…" : "Refresh"}
          </Button>
        }
      >
        <Group className="space-y-4 p-4">
          {data.sizeBytes !== null ? (
            <Meter
              value={data.sizeBytes}
              max={data.quotaBytes}
              label={`Database ${formatBytes(data.sizeBytes)} of ${formatBytes(data.quotaBytes)}`}
            />
          ) : (
            <p className="text-[14px] text-ink-3">Database size: n/a</p>
          )}
          {data.walBytes !== null && data.sizeBytes !== null ? (
            <Meter
              value={data.sizeBytes + data.walBytes}
              max={data.diskBytes}
              label={`Disk (data + WAL ${formatBytes(data.walBytes)}) of ${formatBytes(data.diskBytes)}`}
            />
          ) : (
            <p className="text-[13px] text-ink-3">WAL size: n/a (this database role can&apos;t read it)</p>
          )}
          <div className="grid grid-cols-2 gap-3 text-[14px] sm:grid-cols-4">
            <Stat label="Table cache hits" value={pct(data.cache?.tableHit ?? null)} hint="aim ≥ 99%" />
            <Stat label="Index cache hits" value={pct(data.cache?.indexHit ?? null)} hint="aim ≥ 99%" />
            <Stat
              label="Connections"
              value={data.connections ? `${data.connections.total} / ${data.connections.max}` : "n/a"}
              hint={data.connections ? `${data.connections.active} active` : undefined}
            />
            <Stat label="Tables without a rule" value={String(noRule.length)} hint="need retention" />
          </div>
        </Group>
      </Section>

      <Section title="Tables" hint="Biggest first. Dead rows are space only VACUUM frees; lots of seq scans on a big table can mean a missing index.">
        <Group>
          <DataTable
            head={["Table", "Size", "Rows", "Dead", "Seq / idx scans", "Autovacuum", "Retention"]}
            rows={shownTables.map((t) => [
              <span key="n" className="font-semibold text-ink">
                {t.name}
              </span>,
              <span key="s" title={`table ${formatBytes(t.tableBytes)} · indexes ${formatBytes(t.indexBytes)}`}>
                {formatBytes(t.totalBytes)}
              </span>,
              t.estRows.toLocaleString(),
              <span key="d" className={t.estRows > 1000 && t.deadRows > t.estRows * 0.2 ? "font-semibold text-failed-ink" : ""}>
                {t.deadRows.toLocaleString()}
              </span>,
              `${t.seqScans.toLocaleString()} / ${t.idxScans.toLocaleString()}`,
              fmtAgo(t.lastAutovacuum),
              <span key="r" className={RETENTION_TONE[t.retention]}>
                {t.retentionNote}
              </span>,
            ])}
          />
          {tables.length > 15 && (
            <div className="border-t border-hairline p-2">
              <Button variant="plain" full onClick={() => setShowAllTables((v) => !v)}>
                {showAllTables ? "Show fewer" : `Show all ${tables.length} tables`}
              </Button>
            </div>
          )}
        </Group>
      </Section>

      <Section
        title="Slowest queries"
        hint="From pg_stat_statements, by total time since the last reset. Reset after a fix to see the effect."
        action={
          data.slowQueries.available ? (
            <Button variant="secondary" onClick={() => void resetStats()} disabled={resetting}>
              {resetting ? "Resetting…" : "Reset stats"}
            </Button>
          ) : undefined
        }
      >
        <Group>
          {!data.slowQueries.available ? (
            <Note>{data.slowQueries.note ?? "Not available."}</Note>
          ) : (
            <DataTable
              head={["Total", "Calls", "Mean", "Max", "Query"]}
              rows={data.slowQueries.rows.map((q) => [
                <span key="t" className="font-semibold text-ink">
                  {fmtMs(q.totalMs)}
                </span>,
                q.calls.toLocaleString(),
                fmtMs(q.meanMs),
                fmtMs(q.maxMs),
                <code key="q" className="block max-w-[560px] whitespace-pre-wrap break-words font-mono text-[12px] text-ink-2">
                  {q.query}
                </code>,
              ])}
            />
          )}
        </Group>
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Unused indexes" hint="Never read since stats reset. Each one slows writes and takes space.">
          <Group>
            <DataTable
              head={["Index", "Table", "Size"]}
              rows={(data.unusedIndexes ?? []).map((x) => [x.index, x.table, formatBytes(x.bytes)])}
              empty={data.unusedIndexes ? "None. Every index has been used." : "n/a"}
            />
          </Group>
        </Section>
        <Section title="Foreign keys without an index" hint="Deletes on the parent table scan this table for every row.">
          <Group>
            <DataTable
              head={["Table", "Columns", "Constraint"]}
              rows={(data.unindexedForeignKeys ?? []).map((x) => [x.table.replace(/"/g, ""), x.columns, x.constraint])}
              empty={data.unindexedForeignKeys ? "None." : "n/a"}
            />
          </Group>
        </Section>
      </div>

      <Section title="Long-running queries" hint="Running for more than 30 seconds right now.">
        <Group>
          <DataTable
            head={["PID", "Running", "State", "Query"]}
            rows={(data.longQueries ?? []).map((q) => [
              q.pid,
              fmtMs(q.seconds * 1000),
              q.state,
              <code key="q" className="block max-w-[560px] whitespace-pre-wrap break-words font-mono text-[12px]">
                {q.query}
              </code>,
            ])}
            empty={data.longQueries ? "None." : "n/a"}
          />
        </Group>
      </Section>

      <Section
        title="Supabase Data API exposure"
        hint="Tables with row-level security off that Supabase's anon or authenticated roles can read. The app doesn't use the Data API, so turning RLS on (with no policies) closes this without affecting the app: Prisma's owner role bypasses RLS."
      >
        <Group>
          {!data.security ? (
            <Note>n/a</Note>
          ) : !data.security.supabase ? (
            <Note>Not a Supabase database (no anon/authenticated roles). Nothing to check.</Note>
          ) : data.security.exposed.length === 0 ? (
            <Note>No exposed tables.</Note>
          ) : (
            <>
              <p className="px-4 pt-3 text-[14px] font-semibold text-missing-ink">
                {data.security.exposed.length} table{data.security.exposed.length === 1 ? "" : "s"} readable through the Data API
              </p>
              <DataTable
                head={["Table", "anon", "authenticated"]}
                rows={data.security.exposed.map((x) => [x.table, x.anon ? "can read" : "—", x.authenticated ? "can read" : "—"])}
              />
              <p className="px-4 pb-3 text-[13px] text-ink-3">
                Fix in a migration: <code className="font-mono">ALTER TABLE &quot;Name&quot; ENABLE ROW LEVEL SECURITY;</code> for each table,
                or turn off the Data API in Supabase settings.
              </p>
            </>
          )}
        </Group>
      </Section>

      <Notes notes={data.errors} />
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-[var(--radius-control)] bg-surface-subtle p-3">
      <p className="text-[12px] font-semibold text-ink-3">{label}</p>
      <p className="text-[18px] font-bold tabular-nums text-ink">{value}</p>
      {hint && <p className="text-[12px] text-ink-3">{hint}</p>}
    </div>
  );
}
