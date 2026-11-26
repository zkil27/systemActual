import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { actorFromSession, recordAudit } from "@/lib/audit";
import { devRoute, section } from "@/lib/dev/route";
import { getDeveloperSession, devNotFound } from "@/lib/dev/access";
import { checkEnv } from "@/lib/dev/env-check";
import { getMigrationStatus, resetSlowQueries } from "@/lib/dev/db-health";
import { getOpsSwitches, MAX_MAINTENANCE_MESSAGE } from "@/lib/maintenance";
import { LATEST_RELEASE_ID } from "@/lib/releases";
import { runTick } from "@/lib/worker/tick";
import { ensureFreshToken } from "@/lib/connectors/tokens";

export const dynamic = "force-dynamic";
/** "Run tick now" can use the whole 90 s tick budget. */
export const maxDuration = 120;

export async function GET() {
  return devRoute(async () => {
    const notes: Record<string, string> = {};
    const [migrations, printer, switches] = await Promise.all([
      section(notes, "migrations", getMigrationStatus),
      section(notes, "backup", () =>
        prisma.printDevice.findFirst({
          orderBy: { createdAt: "desc" },
          select: { name: true, lastSeenAt: true, agentVersion: true, lastBackupAt: true, lastBackupBytes: true, lastBackupError: true },
        })
      ),
      getOpsSwitches(),
    ]);
    const settings = await section(notes, "switches", () =>
      prisma.appSettings.findUnique({
        where: { id: "default" },
        select: { workerPaused: true, maintenanceMessage: true, maintenanceUntil: true },
      })
    );
    return {
      notes,
      build: {
        buildId: process.env.NEXT_PUBLIC_BUILD_ID || "dev",
        releaseId: LATEST_RELEASE_ID,
        vercelEnv: process.env.VERCEL_ENV ?? "local",
        region: process.env.VERCEL_REGION ?? null,
        node: process.version,
        branch: process.env.VERCEL_GIT_COMMIT_REF ?? null,
      },
      migrations,
      printer,
      switches,
      settings,
      env: checkEnv(),
    };
  });
}

type Body = Record<string, unknown>;

export async function POST(request: Request) {
  const body = ((await request.json().catch(() => ({}))) ?? {}) as Body;
  const action = typeof body.action === "string" ? body.action : "";

  // Thrown outside devRoute on purpose so it reaches Next's onRequestError, like a real crash.
  if (action === "test_server_error") {
    if (!(await getDeveloperSession())) return devNotFound();
    throw new Error(`Test server error from Developer › Controls (${new Date().toISOString().slice(0, 16)})`);
  }

  return devRoute(async (session) => {
    const actor = actorFromSession(session);
    const audit = (what: string, entityId: string, after?: unknown) =>
      recordAudit({ actor, action: `dev.${what}`, entity: "Developer", entityId, after });

    switch (action) {
      case "run_tick": {
        const result = await runTick("manual");
        await audit("run_tick", "worker", { ran: result.ran, ms: result.ms });
        return { ok: true, ran: result.ran, ms: result.ms, shops: result.shops };
      }
      case "set_worker_paused": {
        const paused = body.paused === true;
        await prisma.appSettings.upsert({
          where: { id: "default" },
          create: { id: "default", workerPaused: paused },
          update: { workerPaused: paused },
        });
        await audit("worker_paused", "worker", { paused });
        return { ok: true, paused };
      }
      case "set_maintenance": {
        const message = typeof body.message === "string" ? body.message.trim().slice(0, MAX_MAINTENANCE_MESSAGE) : "";
        if (!message) return NextResponse.json({ error: "Write the message people should see." }, { status: 400 });
        const minutes = Number(body.minutes);
        const until = Number.isFinite(minutes) && minutes > 0 ? new Date(Date.now() + Math.min(minutes, 7 * 24 * 60) * 60_000) : null;
        await prisma.appSettings.upsert({
          where: { id: "default" },
          create: { id: "default", maintenanceMessage: message, maintenanceUntil: until },
          update: { maintenanceMessage: message, maintenanceUntil: until },
        });
        await audit("maintenance_on", "maintenance", { message, until });
        return { ok: true };
      }
      case "clear_maintenance": {
        await prisma.appSettings.update({
          where: { id: "default" },
          data: { maintenanceMessage: null, maintenanceUntil: null },
        });
        await audit("maintenance_off", "maintenance");
        return { ok: true };
      }
      case "reset_query_stats": {
        await resetSlowQueries();
        await audit("reset_query_stats", "database");
        return { ok: true };
      }
      case "retry_event":
      case "retry_failed_events": {
        const where =
          action === "retry_event"
            ? { id: String(body.id ?? ""), processedAt: null }
            : { processedAt: null, error: { not: null } };
        const res = await prisma.integrationEvent.updateMany({ where, data: { attempts: 0, claimedAt: null } });
        await audit("retry_events", action === "retry_event" ? String(body.id ?? "") : "all", { count: res.count });
        return { ok: true, count: res.count };
      }
      case "refresh_token": {
        const conn = await prisma.shopConnection.findUnique({ where: { id: String(body.shopConnectionId ?? "") } });
        if (!conn) return NextResponse.json({ error: "Shop not found." }, { status: 404 });
        // A null expiry counts as due, so this refreshes now instead of waiting for the margin.
        await ensureFreshToken({ ...conn, tokenExpiresAt: null });
        const fresh = await prisma.shopConnection.findUnique({ where: { id: conn.id }, select: { tokenExpiresAt: true } });
        await audit("refresh_token", conn.id, { shop: conn.shopName });
        return { ok: true, expiresAt: fresh?.tokenExpiresAt ?? null };
      }
      case "resolve_error": {
        await prisma.appError.deleteMany({ where: { id: String(body.id ?? "") } });
        return { ok: true };
      }
      case "clear_errors": {
        const res = await prisma.appError.deleteMany({});
        await audit("clear_errors", "errors", { count: res.count });
        return { ok: true, count: res.count };
      }
      default:
        return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    }
  });
}
