import { PrintJobStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { devRoute, section } from "@/lib/dev/route";
import { parseSteps, summarizeSteps } from "@/lib/dev/jobs";
import { MAX_EVENT_ATTEMPTS } from "@/lib/integrations/inbox";
import { configuredProviders, PROVIDERS, type ProviderId } from "@/lib/ai/providers/catalog";

export const dynamic = "force-dynamic";

/** Daily request cap for an AiUsage row, from the provider catalog. Null when there isn't one. */
function aiCap(provider: string, model: string): number | null {
  const spec = PROVIDERS[provider as ProviderId];
  if (!spec) return null;
  if (model === "*") return spec.shared?.requestsPerDay ?? null;
  const configured = configuredProviders().find((p) => p.spec.id === provider);
  return configured?.models.find((m) => m.model === model)?.requestsPerDay ?? null;
}

export async function GET() {
  return devRoute(async () => {
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 24 * 3600_000);
    const weekAgo = new Date(now.getTime() - 7 * 24 * 3600_000);
    const notes: Record<string, string> = {};

    const [runs24h, events, eventCounts, shops, apiStats, printJobs, aiUsage] = await Promise.all([
      section(notes, "runs", () =>
        prisma.workerRun.findMany({ where: { startedAt: { gte: dayAgo } }, orderBy: { startedAt: "desc" }, take: 1500 })
      ),
      section(notes, "events", () =>
        prisma.integrationEvent.findMany({
          where: {
            processedAt: null,
            OR: [{ attempts: { gte: MAX_EVENT_ATTEMPTS } }, { receivedAt: { lt: new Date(now.getTime() - 10 * 60_000) } }],
          },
          orderBy: { receivedAt: "desc" },
          take: 50,
          select: { id: true, platform: true, eventType: true, orderSn: true, receivedAt: true, attempts: true, error: true },
        })
      ),
      section(notes, "events", async () => {
        const [failed, waiting, processed24h] = await Promise.all([
          prisma.integrationEvent.count({ where: { processedAt: null, attempts: { gte: MAX_EVENT_ATTEMPTS } } }),
          prisma.integrationEvent.count({ where: { processedAt: null, attempts: { lt: MAX_EVENT_ATTEMPTS } } }),
          prisma.integrationEvent.count({ where: { processedAt: { gte: dayAgo } } }),
        ]);
        return { failed, waiting, processed24h };
      }),
      section(notes, "shops", () =>
        prisma.shopConnection.findMany({
          where: { isDemo: false },
          orderBy: { platform: "asc" },
          select: {
            id: true,
            platform: true,
            shopName: true,
            accessToken: true,
            tokenExpiresAt: true,
            tokenErrorAt: true,
            tokenError: true,
            lastSyncedAt: true,
            writesEnabled: true,
          },
        })
      ),
      section(notes, "api", () =>
        prisma.apiCallStat.groupBy({
          by: ["platform", "shopKey", "pathKey"],
          where: { hour: { gte: dayAgo } },
          _sum: { calls: true, errors: true, throttled: true, totalMs: true },
          orderBy: { _sum: { calls: "desc" } },
          take: 60,
        })
      ),
      section(notes, "print", () =>
        prisma.printJob.findMany({
          where: { status: PrintJobStatus.FAILED, createdAt: { gte: weekAgo } },
          orderBy: { createdAt: "desc" },
          take: 30,
          select: { id: true, kind: true, title: true, attempts: true, error: true, createdAt: true },
        })
      ),
      section(notes, "ai", () =>
        prisma.aiUsage.findMany({ where: { updatedAt: { gte: dayAgo } }, orderBy: [{ provider: "asc" }, { model: "asc" }], take: 40 })
      ),
    ]);

    return {
      notes,
      runs: (runs24h ?? []).slice(0, 40).map((r) => ({ ...r, steps: parseSteps(r.steps) })),
      runCount24h: runs24h?.length ?? null,
      skipped24h: runs24h ? runs24h.filter((r) => !r.ran).length : null,
      stepSummary: runs24h ? summarizeSteps(runs24h.filter((r) => r.ran)) : null,
      events,
      eventCounts,
      shops: shops?.map(({ accessToken, ...s }) => ({ ...s, connected: Boolean(accessToken) })) ?? null,
      apiStats:
        apiStats?.map((a) => ({
          platform: a.platform,
          shopKey: a.shopKey,
          pathKey: a.pathKey,
          calls: a._sum.calls ?? 0,
          errors: a._sum.errors ?? 0,
          throttled: a._sum.throttled ?? 0,
          avgMs: a._sum.calls ? Math.round((a._sum.totalMs ?? 0) / a._sum.calls) : 0,
        })) ?? null,
      printJobs,
      aiUsage: aiUsage?.map((u) => ({ ...u, cap: aiCap(u.provider, u.model) })) ?? null,
    };
  });
}
