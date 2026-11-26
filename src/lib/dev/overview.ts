import type { HealthLevel } from "@/lib/health";

/** Pure traffic-light cards for Developer › Overview. */

export interface DevOverviewInput {
  now: Date;
  dbBytes: number | null;
  dbQuotaBytes: number;
  errors24h: number | null;
  newErrorGroups24h: number | null;
  lastRun: { startedAt: Date; durationMs: number; ok: boolean } | null;
  tickBudgetMs: number;
  failedEvents: number | null;
  stuckEvents: number | null;
  lastBackupAt: Date | null;
  backupError: string | null;
  pendingMigrations: number | null;
  tokens: Array<{ shopName: string; expiresAt: Date | null; error: string | null }>;
  workerPaused: boolean;
  maintenanceOn: boolean;
  throttled24h: number | null;
}

export interface DevCard {
  id: string;
  label: string;
  level: HealthLevel;
  value: string;
  detail: string;
}

const MB = 1024 * 1024;
const MIN = 60_000;

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * MB) return `${(bytes / (1024 * MB)).toFixed(2)} GB`;
  if (bytes >= MB) return `${(bytes / MB).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export function formatAgo(from: Date | null, now: Date): string {
  if (!from) return "never";
  const m = Math.round((now.getTime() - from.getTime()) / MIN);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function assessDevOverview(i: DevOverviewInput): DevCard[] {
  const cards: DevCard[] = [];
  const now = i.now.getTime();

  if (i.dbBytes === null) {
    cards.push({ id: "db", label: "Database size", level: "warn", value: "n/a", detail: "Couldn't read the size" });
  } else {
    const pct = i.dbBytes / i.dbQuotaBytes;
    cards.push({
      id: "db",
      label: "Database size",
      level: pct >= 0.9 ? "bad" : pct >= 0.7 ? "warn" : "ok",
      value: `${Math.round(pct * 100)}%`,
      detail: `${formatBytes(i.dbBytes)} of ${formatBytes(i.dbQuotaBytes)} free quota`,
    });
  }

  if (i.errors24h !== null) {
    cards.push({
      id: "errors",
      label: "Errors (24h)",
      level: (i.newErrorGroups24h ?? 0) > 0 ? "bad" : i.errors24h > 0 ? "warn" : "ok",
      value: String(i.errors24h),
      detail: i.newErrorGroups24h ? `${i.newErrorGroups24h} new kind${i.newErrorGroups24h === 1 ? "" : "s"}` : "No new kinds",
    });
  }

  if (i.workerPaused) {
    cards.push({ id: "tick", label: "Worker", level: "bad", value: "Paused", detail: "Turn it back on in Controls" });
  } else if (!i.lastRun) {
    cards.push({ id: "tick", label: "Worker", level: "warn", value: "—", detail: "No tick recorded yet" });
  } else {
    const age = now - i.lastRun.startedAt.getTime();
    const slow = i.lastRun.durationMs > i.tickBudgetMs * 0.9;
    cards.push({
      id: "tick",
      label: "Worker",
      level: age > 30 * MIN || !i.lastRun.ok ? "bad" : age > 10 * MIN || slow ? "warn" : "ok",
      value: `${(i.lastRun.durationMs / 1000).toFixed(1)}s`,
      detail: `Last tick ${formatAgo(i.lastRun.startedAt, i.now)}${i.lastRun.ok ? "" : " · had errors"}${slow ? " · near time limit" : ""}`,
    });
  }

  if (i.failedEvents !== null) {
    cards.push({
      id: "events",
      label: "Webhook inbox",
      level: i.failedEvents > 0 ? "bad" : (i.stuckEvents ?? 0) > 0 ? "warn" : "ok",
      value: String(i.failedEvents),
      detail: i.failedEvents ? "failed events to retry" : i.stuckEvents ? `${i.stuckEvents} waiting` : "All handled",
    });
  }

  const backupAge = i.lastBackupAt ? now - i.lastBackupAt.getTime() : Infinity;
  cards.push({
    id: "backup",
    label: "Backup",
    level: i.backupError ? "bad" : backupAge > 36 * 60 * MIN ? "warn" : "ok",
    value: i.lastBackupAt ? formatAgo(i.lastBackupAt, i.now) : "none",
    detail: i.backupError ? `Failed: ${i.backupError}` : "Nightly pg_dump on the printer PC",
  });

  if (i.pendingMigrations !== null) {
    cards.push({
      id: "migrations",
      label: "Migrations",
      level: i.pendingMigrations > 0 ? "bad" : "ok",
      value: i.pendingMigrations > 0 ? `${i.pendingMigrations} pending` : "Up to date",
      detail: i.pendingMigrations > 0 ? "Run npm run db:deploy" : "Database matches this build",
    });
  }

  for (const t of i.tokens) {
    const left = t.expiresAt ? t.expiresAt.getTime() - now : null;
    cards.push({
      id: `token:${t.shopName}`,
      label: `${t.shopName} token`,
      level: t.error ? "bad" : left !== null && left < 0 ? "warn" : "ok",
      value: t.error ? "Error" : left === null ? "—" : left < 0 ? "Expired" : `${Math.round(left / MIN)}m left`,
      detail: t.error ?? "Refreshes itself before it expires",
    });
  }

  if (i.throttled24h !== null) {
    cards.push({
      id: "throttle",
      label: "Rate limits (24h)",
      level: i.throttled24h > 20 ? "bad" : i.throttled24h > 0 ? "warn" : "ok",
      value: String(i.throttled24h),
      detail: "Marketplace 429 replies during ticks",
    });
  }

  if (i.maintenanceOn) {
    cards.push({ id: "maintenance", label: "Maintenance", level: "warn", value: "On", detail: "Banner showing on every screen" });
  }

  return cards;
}
