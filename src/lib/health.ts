import { PrintJobStatus, WaveStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isOnline } from "@/lib/print/device";
import { getOpsSwitches } from "@/lib/maintenance";

export type HealthLevel = "ok" | "warn" | "bad";

export interface HealthCheck {
  id: string;
  label: string;
  level: HealthLevel;
  detail: string;
}

export interface HealthSummary {
  level: HealthLevel;
  checks: HealthCheck[];
  checkedAt: string;
}

export interface HealthInput {
  now: Date;
  shops: Array<{
    id?: string;
    platform: string;
    shopName: string;
    connected: boolean;
    lastSyncedAt: Date | null;
    tokenError: string | null;
  }>;
  /** End of the last worker tick (lock release) or when the running one expires. */
  workerLockedUntil: Date | null;
  workerRunning: boolean;
  printer: {
    lastSeenAt: Date | null;
    paused: boolean;
    agentVersion: string | null;
    printerStatus: string | null;
    lastBackupAt: Date | null;
    lastBackupError: string | null;
  } | null;
  queuedJobs: number;
  failedJobs24h: number;
  runningWave: boolean;
  /** Developer kill switch: background sync is stopped on purpose. */
  workerPaused?: boolean;
  /** Maintenance banner text while it's showing. */
  maintenanceMessage?: string | null;
}

const MIN = 60_000;

export function ago(from: Date | null, now: Date): string {
  if (!from) return "never";
  const m = Math.max(0, Math.round((now.getTime() - from.getTime()) / MIN));
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const PRINTER_TROUBLE = /offline|error|paper|jam|door|toner|stopped|paused/i;

/** Turn raw timestamps and counts into a few plain-English checks. Pure. */
export function assessHealth(i: HealthInput): HealthSummary {
  const checks: HealthCheck[] = [];
  const now = i.now;
  const age = (d: Date | null) => (d ? now.getTime() - d.getTime() : Infinity);

  const connectedShops = i.shops.filter((s) => s.connected);
  const countByPlatform = new Map<string, number>();
  for (const s of connectedShops) {
    countByPlatform.set(s.platform, (countByPlatform.get(s.platform) ?? 0) + 1);
  }

  for (const s of connectedShops) {
    const platformName = s.platform === "SHOPEE" ? "Shopee" : "TikTok";
    const multiOnPlatform = (countByPlatform.get(s.platform) ?? 0) > 1;
    const label = multiOnPlatform && s.shopName ? `${platformName} (${s.shopName}) sync` : `${platformName} sync`;
    const id = `shop:${s.id ?? s.platform}`;
    if (s.tokenError) {
      checks.push({ id, label, level: "bad", detail: `Reconnect needed: ${s.tokenError}` });
      continue;
    }
    const lag = age(s.lastSyncedAt);
    checks.push({
      id,
      label,
      level: lag > 60 * MIN ? "bad" : lag > 15 * MIN ? "warn" : "ok",
      detail: `Last synced ${ago(s.lastSyncedAt, now)}`,
    });
  }
  if (!connectedShops.length) {
    checks.push({ id: "shops", label: "Shops", level: "warn", detail: "No shop connected yet" });
  }

  const workerAge = i.workerRunning ? 0 : age(i.workerLockedUntil);
  if (i.workerPaused) {
    checks.push({
      id: "worker",
      label: "Background sync",
      level: "bad",
      detail: "Paused by the developer. Orders, returns and stock aren't syncing.",
    });
  } else {
    checks.push({
      id: "worker",
      label: "Background sync",
      level: workerAge > 30 * MIN ? "bad" : workerAge > 10 * MIN ? "warn" : "ok",
      detail: i.workerRunning ? "Running now" : `Last ran ${ago(i.workerLockedUntil, now)}`,
    });
  }

  if (!i.printer) {
    checks.push({ id: "printer", label: "Printer PC", level: "warn", detail: "Not set up" });
  } else {
    const online = isOnline(i.printer.lastSeenAt, now);
    const trouble = i.printer.printerStatus && PRINTER_TROUBLE.test(i.printer.printerStatus);
    const needed = i.queuedJobs > 0 || i.runningWave;
    checks.push({
      id: "printer",
      label: "Printer PC",
      level: !online ? (needed ? "bad" : "warn") : trouble ? "bad" : i.printer.paused ? "warn" : "ok",
      detail: [
        online ? "Online" : `Offline since ${ago(i.printer.lastSeenAt, now)}`,
        i.printer.paused ? "paused" : null,
        trouble ? `printer says “${i.printer.printerStatus}”` : null,
        i.queuedJobs ? `${i.queuedJobs} waiting` : null,
        i.printer.agentVersion ? `agent ${i.printer.agentVersion}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
    });
    const backupAge = age(i.printer.lastBackupAt);
    checks.push({
      id: "backup",
      label: "Nightly backup",
      level: i.printer.lastBackupError ? "bad" : backupAge > 36 * 60 * MIN ? "warn" : "ok",
      detail: i.printer.lastBackupError
        ? `Failed: ${i.printer.lastBackupError}`
        : i.printer.lastBackupAt
          ? `Last backup ${ago(i.printer.lastBackupAt, now)}`
          : "No backup reported yet",
    });
  }

  if (i.maintenanceMessage) {
    checks.push({ id: "maintenance", label: "Maintenance", level: "warn", detail: i.maintenanceMessage });
  }

  checks.push({
    id: "print-jobs",
    label: "Print jobs",
    level: i.failedJobs24h > 0 ? "warn" : "ok",
    detail: i.failedJobs24h ? `${i.failedJobs24h} failed in 24h` : "No failures in 24h",
  });

  const level: HealthLevel = checks.some((c) => c.level === "bad")
    ? "bad"
    : checks.some((c) => c.level === "warn")
      ? "warn"
      : "ok";
  return { level, checks, checkedAt: now.toISOString() };
}

export async function getHealthSummary(now: Date = new Date()): Promise<HealthSummary> {
  const dayAgo = new Date(now.getTime() - 24 * 3600_000);
  const [shops, lock, printer, queuedJobs, failedJobs24h, runningWave, switches] = await Promise.all([
    prisma.shopConnection.findMany({
      where: { isDemo: false },
      select: { id: true, platform: true, shopName: true, accessToken: true, lastSyncedAt: true, tokenError: true, tokenErrorAt: true },
      orderBy: [{ platform: "asc" }, { shopName: "asc" }],
    }),
    prisma.workerLock.findUnique({ where: { id: "tick" } }),
    prisma.printDevice.findFirst({ orderBy: { createdAt: "desc" } }),
    prisma.printJob.count({ where: { status: { in: [PrintJobStatus.QUEUED, PrintJobStatus.PRINTING] } } }),
    prisma.printJob.count({ where: { status: PrintJobStatus.FAILED, createdAt: { gte: dayAgo } } }),
    prisma.wave.count({ where: { status: WaveStatus.RUNNING } }),
    getOpsSwitches(now),
  ]);
  return assessHealth({
    now,
    shops: shops.map((s) => ({
      id: s.id,
      platform: s.platform,
      shopName: s.shopName,
      connected: Boolean(s.accessToken),
      lastSyncedAt: s.lastSyncedAt,
      tokenError: s.tokenErrorAt ? (s.tokenError ?? "token refresh failing") : null,
    })),
    workerLockedUntil: lock?.lockedUntil ?? null,
    workerRunning: Boolean(lock?.holder && lock.lockedUntil.getTime() > now.getTime()),
    printer: printer
      ? {
          lastSeenAt: printer.lastSeenAt,
          paused: printer.paused,
          agentVersion: printer.agentVersion,
          printerStatus: printer.printerStatus,
          lastBackupAt: printer.lastBackupAt,
          lastBackupError: printer.lastBackupError,
        }
      : null,
    queuedJobs,
    failedJobs24h,
    runningWave: runningWave > 0,
    workerPaused: switches.workerPaused,
    maintenanceMessage: switches.maintenance?.message ?? null,
  });
}
