import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { actorFromSession, recordAudit } from "@/lib/audit";
import { getOwnerSession } from "@/lib/auth";
import { isMissingTableError } from "@/lib/dev/db-errors";
import { prisma } from "@/lib/prisma";
import { getVapidConfig, labelFromUserAgent } from "@/lib/push";

const subscribeSchema = z.object({
  endpoint: z
    .string()
    .trim()
    .url()
    .max(2048)
    .refine((u) => u.startsWith("https://"), "Push endpoint must use HTTPS."),
  keys: z.object({
    p256dh: z.string().trim().min(10).max(512),
    auth: z.string().trim().min(6).max(256),
  }),
  deviceLabel: z.string().trim().max(80).optional(),
});

const deleteSchema = z
  .object({
    id: z.string().trim().min(1).optional(),
    endpoint: z.string().trim().min(1).optional(),
  })
  .refine((d) => Boolean(d.id || d.endpoint), "Specify id or endpoint.");

export async function GET() {
  const owner = await getOwnerSession();
  if (!owner) {
    return NextResponse.json({ error: "Owner sign-in required." }, { status: 401 });
  }

  const vapid = getVapidConfig();
  let devices: Array<{
    id: string;
    endpoint: string;
    deviceLabel: string | null;
    createdAt: Date;
    lastUsedAt: Date | null;
  }> = [];
  let migrationPending = false;

  try {
    devices = await prisma.pushSubscription.findMany({
      where: { ownerUserId: owner.userId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        endpoint: true,
        deviceLabel: true,
        createdAt: true,
        lastUsedAt: true,
      },
    });
  } catch (err) {
    if (isMissingTableError(err)) {
      migrationPending = true;
    } else {
      throw err;
    }
  }

  return NextResponse.json({
    configured: Boolean(vapid),
    migrationPending,
    publicKey: vapid?.publicKey ?? null,
    devices: devices.map((d) => ({
      id: d.id,
      endpoint: d.endpoint,
      deviceLabel: d.deviceLabel || "Browser",
      createdAt: d.createdAt.toISOString(),
      lastUsedAt: d.lastUsedAt?.toISOString() ?? null,
    })),
  });
}

export async function POST(req: NextRequest) {
  const owner = await getOwnerSession();
  if (!owner) {
    return NextResponse.json({ error: "Owner sign-in required." }, { status: 401 });
  }
  if (!getVapidConfig()) {
    return NextResponse.json({ error: "Push notifications are not configured on the server." }, { status: 503 });
  }

  const body = await req.json().catch(() => null);
  const parsed = subscribeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid push subscription." },
      { status: 400 }
    );
  }

  const ua = req.headers.get("user-agent")?.slice(0, 300) ?? null;
  const deviceLabel = parsed.data.deviceLabel || labelFromUserAgent(ua);

  const row = await prisma.pushSubscription.upsert({
    where: { endpoint: parsed.data.endpoint },
    create: {
      ownerUserId: owner.userId,
      endpoint: parsed.data.endpoint,
      p256dh: parsed.data.keys.p256dh,
      auth: parsed.data.keys.auth,
      deviceLabel,
      userAgent: ua,
    },
    update: {
      ownerUserId: owner.userId,
      p256dh: parsed.data.keys.p256dh,
      auth: parsed.data.keys.auth,
      deviceLabel,
      userAgent: ua,
    },
    select: { id: true, deviceLabel: true },
  });

  await recordAudit({
    actor: actorFromSession(owner),
    action: "push.subscribed",
    entity: "PushSubscription",
    entityId: row.id,
    after: { deviceLabel: row.deviceLabel },
  });

  return NextResponse.json({ ok: true, id: row.id, deviceLabel: row.deviceLabel });
}

export async function DELETE(req: NextRequest) {
  const owner = await getOwnerSession();
  if (!owner) {
    return NextResponse.json({ error: "Owner sign-in required." }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Specify which device to remove." }, { status: 400 });
  }

  const deleted = await prisma.pushSubscription.deleteMany({
    where: {
      ownerUserId: owner.userId,
      ...(parsed.data.id ? { id: parsed.data.id } : {}),
      ...(parsed.data.endpoint ? { endpoint: parsed.data.endpoint } : {}),
    },
  });

  if (deleted.count > 0) {
    await recordAudit({
      actor: actorFromSession(owner),
      action: "push.unsubscribed",
      entity: "PushSubscription",
      entityId: parsed.data.id ?? "endpoint",
      after: { deleted: deleted.count },
    });
  }

  return NextResponse.json({ ok: true, deleted: deleted.count });
}
