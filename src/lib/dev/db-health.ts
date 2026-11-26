import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { retentionFor, type RetentionKind } from "@/lib/dev/retention-map";

/**
 * Read-only Postgres health queries for Developer › Database. Every query is
 * fixed SQL; nothing here takes SQL from the browser. Each section fails on
 * its own (shown as "n/a") so one missing grant doesn't blank the tab.
 */

/** Supabase Free: 500 MB database quota; the 2 GB disk goes read-only at 95%. */
export const DB_QUOTA_BYTES = 500 * 1024 * 1024;
export const DISK_BYTES = 2 * 1024 * 1024 * 1024;

export interface TableStat {
  name: string;
  totalBytes: number;
  tableBytes: number;
  indexBytes: number;
  estRows: number;
  deadRows: number;
  seqScans: number;
  idxScans: number;
  lastAutovacuum: string | null;
  retention: RetentionKind;
  retentionNote: string;
}

export interface SlowQuery {
  query: string;
  calls: number;
  totalMs: number;
  meanMs: number;
  maxMs: number;
  rows: number;
}

export interface DbHealth {
  sizeBytes: number | null;
  walBytes: number | null;
  tables: TableStat[] | null;
  cache: { tableHit: number | null; indexHit: number | null } | null;
  unusedIndexes: Array<{ table: string; index: string; bytes: number }> | null;
  unindexedForeignKeys: Array<{ table: string; constraint: string; columns: string }> | null;
  connections: { total: number; active: number; max: number } | null;
  longQueries: Array<{ pid: number; seconds: number; state: string; query: string }> | null;
  slowQueries: { available: boolean; rows: SlowQuery[]; note?: string };
  security: { supabase: boolean; exposed: Array<{ table: string; anon: boolean; authenticated: boolean }> } | null;
  errors: Record<string, string>;
}

async function attempt<T>(label: string, errors: Record<string, string>, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    errors[label] = (err instanceof Error ? err.message : String(err)).split("\n").slice(-1)[0]!.slice(0, 200);
    return null;
  }
}

const n = (v: unknown): number => (typeof v === "bigint" ? Number(v) : typeof v === "number" ? v : Number(v ?? 0) || 0);

/** Schema that holds pg_stat_statements ("extensions" on Supabase), or null when it isn't installed. */
async function statStatementsSchema(): Promise<string | null> {
  const rows = await prisma.$queryRaw<Array<{ schema: string }>>`
    SELECT n.nspname AS schema FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
    WHERE e.extname = 'pg_stat_statements'`;
  return rows[0]?.schema ?? null;
}

const quoteIdent = (s: string) => `"${s.replace(/"/g, '""')}"`;

export async function getSlowQueries(limit = 20): Promise<DbHealth["slowQueries"]> {
  const schema = await statStatementsSchema();
  if (!schema) return { available: false, rows: [], note: "pg_stat_statements is not installed." };
  const view = Prisma.raw(`${quoteIdent(schema)}.pg_stat_statements`);
  const rows = await prisma.$queryRaw<
    Array<{ query: string; calls: unknown; total_ms: unknown; mean_ms: unknown; max_ms: unknown; rows: unknown }>
  >`
    SELECT left(s.query, 600) AS query, s.calls::float8 AS calls, s.total_exec_time AS total_ms,
           s.mean_exec_time AS mean_ms, s.max_exec_time AS max_ms, s.rows::float8 AS rows
    FROM ${view} s
    WHERE s.dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
      AND s.query NOT ILIKE '%pg_stat_statements%'
    ORDER BY s.total_exec_time DESC
    LIMIT ${limit}`;
  return {
    available: true,
    rows: rows.map((r) => ({
      query: r.query,
      calls: n(r.calls),
      totalMs: n(r.total_ms),
      meanMs: n(r.mean_ms),
      maxMs: n(r.max_ms),
      rows: n(r.rows),
    })),
  };
}

export async function resetSlowQueries(): Promise<void> {
  const schema = await statStatementsSchema();
  if (!schema) throw new Error("pg_stat_statements is not installed.");
  // executeRaw: the function returns void, which queryRaw can't deserialize.
  await prisma.$executeRaw`SELECT ${Prisma.raw(`${quoteIdent(schema)}.pg_stat_statements_reset()`)}`;
}

export async function getDbSize(): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ bytes: unknown }>>`
    SELECT pg_database_size(current_database())::float8 AS bytes`;
  return n(rows[0]?.bytes);
}

export async function getDbHealth(): Promise<DbHealth> {
  const errors: Record<string, string> = {};

  const [sizeBytes, walBytes, tables, cache, unusedIndexes, unindexedForeignKeys, connections, longQueries, slowQueries, security] =
    await Promise.all([
      attempt("size", errors, getDbSize),
      attempt("wal", errors, async () => {
        const r = await prisma.$queryRaw<Array<{ bytes: unknown }>>`
          SELECT coalesce(sum(size), 0)::float8 AS bytes FROM pg_ls_waldir()`;
        return n(r[0]?.bytes);
      }),
      attempt("tables", errors, async () => {
        const r = await prisma.$queryRaw<
          Array<{
            name: string;
            total_bytes: unknown;
            table_bytes: unknown;
            index_bytes: unknown;
            est_rows: unknown;
            dead_rows: unknown;
            seq_scan: unknown;
            idx_scan: unknown;
            last_autovacuum: Date | null;
          }>
        >`
          SELECT c.relname AS name,
                 pg_total_relation_size(c.oid)::float8 AS total_bytes,
                 pg_relation_size(c.oid)::float8 AS table_bytes,
                 pg_indexes_size(c.oid)::float8 AS index_bytes,
                 greatest(coalesce(s.n_live_tup, c.reltuples), 0)::float8 AS est_rows,
                 coalesce(s.n_dead_tup, 0)::float8 AS dead_rows,
                 coalesce(s.seq_scan, 0)::float8 AS seq_scan,
                 coalesce(s.idx_scan, 0)::float8 AS idx_scan,
                 s.last_autovacuum
          FROM pg_class c
          JOIN pg_namespace ns ON ns.oid = c.relnamespace
          LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
          WHERE ns.nspname = current_schema() AND c.relkind = 'r' AND c.relname <> '_prisma_migrations'
          ORDER BY pg_total_relation_size(c.oid) DESC`;
        return r.map((t): TableStat => {
          const rule = retentionFor(t.name);
          return {
            name: t.name,
            totalBytes: n(t.total_bytes),
            tableBytes: n(t.table_bytes),
            indexBytes: n(t.index_bytes),
            estRows: n(t.est_rows),
            deadRows: n(t.dead_rows),
            seqScans: n(t.seq_scan),
            idxScans: n(t.idx_scan),
            lastAutovacuum: t.last_autovacuum ? t.last_autovacuum.toISOString() : null,
            retention: rule.kind,
            retentionNote: rule.note,
          };
        });
      }),
      attempt("cache", errors, async () => {
        const r = await prisma.$queryRaw<Array<{ table_hit: unknown; index_hit: unknown }>>`
          SELECT
            (SELECT sum(heap_blks_hit)::float8 / nullif(sum(heap_blks_hit) + sum(heap_blks_read), 0) FROM pg_statio_user_tables) AS table_hit,
            (SELECT sum(idx_blks_hit)::float8 / nullif(sum(idx_blks_hit) + sum(idx_blks_read), 0) FROM pg_statio_user_indexes) AS index_hit`;
        const row = r[0];
        return {
          tableHit: row?.table_hit == null ? null : n(row.table_hit),
          indexHit: row?.index_hit == null ? null : n(row.index_hit),
        };
      }),
      attempt("unusedIndexes", errors, async () => {
        const r = await prisma.$queryRaw<Array<{ table: string; index: string; bytes: unknown }>>`
          SELECT s.relname AS table, s.indexrelname AS index, pg_relation_size(s.indexrelid)::float8 AS bytes
          FROM pg_stat_user_indexes s
          JOIN pg_index i ON i.indexrelid = s.indexrelid
          WHERE s.idx_scan = 0 AND NOT i.indisunique AND NOT i.indisprimary
          ORDER BY pg_relation_size(s.indexrelid) DESC
          LIMIT 30`;
        return r.map((x) => ({ table: x.table, index: x.index, bytes: n(x.bytes) }));
      }),
      attempt("unindexedForeignKeys", errors, async () => {
        return prisma.$queryRaw<Array<{ table: string; constraint: string; columns: string }>>`
          SELECT c.conrelid::regclass::text AS table, c.conname AS constraint,
                 string_agg(a.attname, ', ' ORDER BY a.attnum) AS columns
          FROM pg_constraint c
          JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
          WHERE c.contype = 'f'
            AND c.connamespace = current_schema()::regnamespace
            AND NOT EXISTS (
              SELECT 1 FROM pg_index i
              WHERE i.indrelid = c.conrelid
                AND (string_to_array(i.indkey::text, ' ')::int2[])[1:array_length(c.conkey, 1)] @> c.conkey
            )
          GROUP BY c.conrelid, c.conname
          ORDER BY 1, 2`;
      }),
      attempt("connections", errors, async () => {
        const r = await prisma.$queryRaw<Array<{ total: unknown; active: unknown; max: unknown }>>`
          SELECT count(*)::float8 AS total,
                 count(*) FILTER (WHERE state = 'active')::float8 AS active,
                 (SELECT setting::float8 FROM pg_settings WHERE name = 'max_connections') AS max
          FROM pg_stat_activity WHERE datname = current_database()`;
        return { total: n(r[0]?.total), active: n(r[0]?.active), max: n(r[0]?.max) };
      }),
      attempt("longQueries", errors, async () => {
        const r = await prisma.$queryRaw<Array<{ pid: unknown; seconds: unknown; state: string; query: string }>>`
          SELECT pid::float8 AS pid, extract(epoch FROM now() - query_start)::float8 AS seconds,
                 coalesce(state, '') AS state, left(query, 300) AS query
          FROM pg_stat_activity
          WHERE datname = current_database() AND state <> 'idle' AND pid <> pg_backend_pid()
            AND query_start < now() - interval '30 seconds'
          ORDER BY query_start ASC
          LIMIT 20`;
        return r.map((x) => ({ pid: n(x.pid), seconds: n(x.seconds), state: x.state, query: x.query }));
      }),
      attempt("slowQueries", errors, () => getSlowQueries()),
      attempt("security", errors, async () => {
        const roles = await prisma.$queryRaw<Array<{ rolname: string }>>`
          SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated')`;
        if (roles.length < 2) return { supabase: false, exposed: [] };
        const r = await prisma.$queryRaw<Array<{ table: string; anon: boolean; authenticated: boolean }>>`
          SELECT c.relname AS table,
                 has_table_privilege('anon', c.oid, 'SELECT') AS anon,
                 has_table_privilege('authenticated', c.oid, 'SELECT') AS authenticated
          FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
          WHERE ns.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
          ORDER BY c.relname`;
        return { supabase: true, exposed: r.filter((x) => x.anon || x.authenticated) };
      }),
    ]);

  return {
    sizeBytes,
    walBytes,
    tables,
    cache,
    unusedIndexes,
    unindexedForeignKeys,
    connections,
    longQueries,
    slowQueries: slowQueries ?? { available: false, rows: [], note: errors.slowQueries },
    security,
    errors,
  };
}

export interface MigrationStatus {
  expected: string[];
  applied: string[];
  pending: string[];
  failed: string[];
  /** In the database but not in this build (applied from a newer branch). */
  unknown: string[];
}

/** Pure: compare migration folders baked into the build with `_prisma_migrations`. */
export function compareMigrations(
  expected: readonly string[],
  rows: ReadonlyArray<{ name: string; finished: boolean; rolledBack: boolean }>
): MigrationStatus {
  const applied = rows.filter((r) => r.finished && !r.rolledBack).map((r) => r.name);
  const failed = rows.filter((r) => !r.finished && !r.rolledBack).map((r) => r.name);
  const appliedSet = new Set(applied);
  const expectedSet = new Set(expected);
  return {
    expected: [...expected],
    applied,
    pending: expected.filter((m) => !appliedSet.has(m)),
    failed,
    unknown: applied.filter((m) => !expectedSet.has(m)),
  };
}

export function expectedMigrations(): string[] {
  return (process.env.EXPECTED_MIGRATIONS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function getMigrationStatus(): Promise<MigrationStatus> {
  const rows = await prisma.$queryRaw<Array<{ name: string; finished: boolean; rolled_back: boolean }>>`
    SELECT migration_name AS name, finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS rolled_back
    FROM _prisma_migrations ORDER BY started_at`;
  return compareMigrations(
    expectedMigrations(),
    rows.map((r) => ({ name: r.name, finished: r.finished, rolledBack: r.rolled_back }))
  );
}
