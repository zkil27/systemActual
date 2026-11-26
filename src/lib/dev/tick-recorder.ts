import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { errorText, recordError } from "@/lib/dev/errors";
import { isMissingTableError } from "@/lib/dev/db-errors";
import { currentRecorder, type TickRecorder } from "@/lib/dev/tick-context";

/**
 * Writes one tick's collected timings and API counts: one WorkerRun row and
 * one ApiCallStat upsert statement per tick.
 */

export const WORKER_RUN_RETENTION_DAYS = 3;
export const API_CALL_STAT_RETENTION_DAYS = 30;

/** Logs a tick step failure and saves it to the developer error log. */
export function tickError(label: string, err: unknown) {
  console.error(`[tick] ${label}`, err);
  const { message, stack } = errorText(err);
  currentRecorder()?.step(`error:${label}`, 0, message);
  void recordError({ source: "worker", route: `tick/${label.replace(/\s+/g, "-")}`, message, stack });
}

export async function flushTickRecorder(
  rec: TickRecorder,
  meta: { trigger: string; startedAt: Date; durationMs: number; ran: boolean; shopsTicked: number; error?: string }
): Promise<void> {
  try {
    await prisma.workerRun.create({
      data: {
        trigger: meta.trigger,
        startedAt: meta.startedAt,
        durationMs: Math.round(meta.durationMs),
        ran: meta.ran,
        ok: !meta.error && rec.errors === 0,
        error: meta.error?.slice(0, 300) ?? null,
        steps: rec.steps as unknown as Prisma.InputJsonValue,
        shopsTicked: meta.shopsTicked,
      },
    });
    const buckets = [...rec.calls.values()];
    if (buckets.length > 0) {
      const rows = buckets.map(
        (b) =>
          Prisma.sql`(gen_random_uuid()::text, ${b.platform}, ${b.shopKey}, ${b.pathKey}, ${b.hour}, ${b.calls}, ${b.errors}, ${b.throttled}, ${b.totalMs}, NOW())`
      );
      await prisma.$executeRaw`
        INSERT INTO "ApiCallStat" ("id", "platform", "shopKey", "pathKey", "hour", "calls", "errors", "throttled", "totalMs", "updatedAt")
        VALUES ${Prisma.join(rows)}
        ON CONFLICT ("platform", "shopKey", "pathKey", "hour") DO UPDATE SET
          "calls" = "ApiCallStat"."calls" + EXCLUDED."calls",
          "errors" = "ApiCallStat"."errors" + EXCLUDED."errors",
          "throttled" = "ApiCallStat"."throttled" + EXCLUDED."throttled",
          "totalMs" = "ApiCallStat"."totalMs" + EXCLUDED."totalMs",
          "updatedAt" = NOW()`;
    }
  } catch (err) {
    // Before the migration is applied the tables don't exist; stay quiet then.
    if (!isMissingTableError(err)) console.error("[tick-recorder] flush failed", err);
  }
}

export async function pruneDevTables(now: Date = new Date()): Promise<void> {
  const runCutoff = new Date(now.getTime() - WORKER_RUN_RETENTION_DAYS * 24 * 3600_000);
  const callCutoff = new Date(now.getTime() - API_CALL_STAT_RETENTION_DAYS * 24 * 3600_000);
  await Promise.all([
    prisma.workerRun.deleteMany({ where: { startedAt: { lt: runCutoff } } }),
    prisma.apiCallStat.deleteMany({ where: { hour: { lt: callCutoff } } }),
  ]);
}
