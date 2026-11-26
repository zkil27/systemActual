import { prisma } from "@/lib/prisma";
import { devRoute, section } from "@/lib/dev/route";
import { assessDevOverview } from "@/lib/dev/overview";
import { DB_QUOTA_BYTES, getDbSize, getMigrationStatus } from "@/lib/dev/db-health";
import { getOpsSwitches } from "@/lib/maintenance";
import { MAX_EVENT_ATTEMPTS } from "@/lib/integrations/inbox";
import { TICK_BUDGET_MS } from "@/lib/worker/tick";

export const dynamic = "force-dynamic";

export async function GET() {
  return devRoute(async () => {
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 24 * 3600_000);
    const notes: Record<string, string> = {};
    const [dbBytes, errorKinds, newKinds, lastRun, failedEvents, stuckEvents, printer, migrations, shops, switches, throttled] =
      await Promise.all([
        section(notes, "db", getDbSize),
        section(notes, "errors", () => prisma.appError.count({ where: { lastAt: { gte: dayAgo } } })),
        section(notes, "errors", () => prisma.appError.count({ where: { firstAt: { gte: dayAgo } } })),
        section(notes, "tick", () =>
          prisma.workerRun.findFirst({
            where: { ran: true },
            orderBy: { startedAt: "desc" },
            select: { startedAt: true, durationMs: true, ok: true },
          })
        ),
        section(notes, "events", () =>
          prisma.integrationEvent.count({ where: { processedAt: null, attempts: { gte: MAX_EVENT_ATTEMPTS } } })
        ),
        section(notes, "events", () =>
          prisma.integrationEvent.count({
            where: {
              processedAt: null,
              attempts: { lt: MAX_EVENT_ATTEMPTS },
              receivedAt: { lt: new Date(now.getTime() - 10 * 60_000) },
            },
          })
        ),
        section(notes, "backup", () => prisma.printDevice.findFirst({ orderBy: { createdAt: "desc" } })),
        section(notes, "migrations", getMigrationStatus),
        section(notes, "tokens", () =>
          prisma.shopConnection.findMany({
            where: { isDemo: false, accessToken: { not: null } },
            select: { shopName: true, tokenExpiresAt: true, tokenErrorAt: true, tokenError: true },
            orderBy: { platform: "asc" },
          })
        ),
        getOpsSwitches(now),
        section(notes, "throttle", async () => {
          const r = await prisma.apiCallStat.aggregate({ where: { hour: { gte: dayAgo } }, _sum: { throttled: true } });
          return r._sum.throttled ?? 0;
        }),
      ]);

    const cards = assessDevOverview({
      now,
      dbBytes,
      dbQuotaBytes: DB_QUOTA_BYTES,
      errors24h: errorKinds,
      newErrorGroups24h: newKinds,
      lastRun,
      tickBudgetMs: TICK_BUDGET_MS,
      failedEvents,
      stuckEvents,
      lastBackupAt: printer?.lastBackupAt ?? null,
      backupError: printer?.lastBackupError ?? null,
      pendingMigrations: migrations && migrations.expected.length > 0 ? migrations.pending.length : null,
      tokens: (shops ?? []).map((s) => ({
        shopName: s.shopName,
        expiresAt: s.tokenExpiresAt,
        error: s.tokenErrorAt ? (s.tokenError ?? "Token refresh failing") : null,
      })),
      workerPaused: switches.workerPaused,
      maintenanceOn: Boolean(switches.maintenance),
      throttled24h: throttled,
    });
    return { cards, notes, checkedAt: now.toISOString() };
  });
}
