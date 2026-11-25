import crypto from "crypto";
import { Platform, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isChatWebhook } from "@/lib/chats/webhook";

/**
 * Webhook inbox. Every Shopee/TikTok push is stored before we answer, so:
 * - a resend of the same push is handled once, and
 * - a push whose handling crashed (function killed, timeout) is retried by
 *   the worker tick instead of being lost until the next poll.
 */

export const MAX_EVENT_ATTEMPTS = 5;
/** A claim older than this was abandoned (crashed function). */
export const EVENT_CLAIM_TIMEOUT_MS = 2 * 60_000;
/** The tick leaves fresh events to the webhook's own after() for this long. */
export const EVENT_GRACE_MS = 30_000;
/** Kept short: at peak there are thousands of pushes a day and the free database is 500 MB. */
export const PROCESSED_EVENT_RETENTION_DAYS = 3;
export const FAILED_EVENT_RETENTION_DAYS = 30;

type Raw = Record<string, unknown>;

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) : null;

/** Dedupe key: TikTok's notification id when present, else a hash of the exact body (a resend is byte-identical). */
export function eventKey(platform: Platform, payload: Raw, rawBody: string): string {
  const prefix = platform === Platform.SHOPEE ? "shopee" : "tiktok";
  const notificationId = platform === Platform.TIKTOK ? str(payload.tts_notification_id) : null;
  if (notificationId) return `${prefix}:n:${notificationId}`;
  return `${prefix}:h:${crypto.createHash("sha256").update(rawBody).digest("hex")}`;
}

export interface EventFields {
  eventType: string;
  orderSn: string | null;
  shopExternalId: string | null;
  isChat: boolean;
  isCancel: boolean;
  /** Raw status for the fast cancel ("IN_CANCEL", "CANCELLED", ...). */
  cancelStatus: string | null;
}

/** What a push is about, from its payload. Same rules the routes used before. */
export function eventFields(platform: Platform, payload: Raw): EventFields {
  const data = (payload?.data ?? {}) as Raw;
  const shopExternalId = str(payload?.shop_id);
  if (platform === Platform.SHOPEE) {
    const orderSn = str(data.ordersn) ?? str(data.order_sn);
    const status = String(data.status ?? "").toUpperCase();
    const isCancel = Boolean(orderSn && (status === "IN_CANCEL" || status === "CANCELLED"));
    return {
      eventType: str(payload.code) ?? "unknown",
      orderSn,
      shopExternalId,
      isChat: false,
      isCancel,
      cancelStatus: isCancel ? status : null,
    };
  }
  const isChat = isChatWebhook(data);
  const orderSn = isChat ? null : str(data.order_id);
  const status = String(data.order_status ?? "").toUpperCase();
  const cancel = String(data.cancel_status ?? "").toUpperCase();
  const isCancel = Boolean(orderSn && (status === "CANCELLED" || cancel.includes("CANCEL")));
  return {
    eventType: str(payload.type) ?? (isChat ? "chat" : "unknown"),
    orderSn,
    shopExternalId,
    isChat,
    isCancel,
    cancelStatus: isCancel ? (status === "CANCELLED" ? "CANCELLED" : cancel) : null,
  };
}

/** Stores a push. Returns its id, or null when this exact push was already stored. */
export async function storeEvent(platform: Platform, payload: Raw, rawBody: string): Promise<string | null> {
  const fields = eventFields(platform, payload);
  const externalKey = eventKey(platform, payload, rawBody);
  // ON CONFLICT DO NOTHING instead of create() + catch, so resends don't spam prisma:error logs.
  const created = await prisma.integrationEvent.createMany({
    data: [
      {
        platform,
        eventType: fields.eventType.slice(0, 80),
        externalKey,
        shopExternalId: fields.shopExternalId,
        orderSn: fields.orderSn,
        payload: payload as Prisma.InputJsonValue,
      },
    ],
    skipDuplicates: true,
  });
  if (created.count === 0) return null;
  const row = await prisma.integrationEvent.findUnique({ where: { externalKey }, select: { id: true } });
  return row?.id ?? null;
}

/** Can this event be taken now? Pure; mirrors the claim query. */
export function isClaimable(
  ev: { processedAt: Date | null; claimedAt: Date | null; attempts: number },
  now: Date
): boolean {
  if (ev.processedAt || ev.attempts >= MAX_EVENT_ATTEMPTS) return false;
  return !ev.claimedAt || now.getTime() - ev.claimedAt.getTime() > EVENT_CLAIM_TIMEOUT_MS;
}

/** Takes the event for this function. Only one caller wins. */
export async function claimEvent(id: string, now: Date = new Date()): Promise<boolean> {
  const res = await prisma.integrationEvent.updateMany({
    where: {
      id,
      processedAt: null,
      attempts: { lt: MAX_EVENT_ATTEMPTS },
      OR: [{ claimedAt: null }, { claimedAt: { lt: new Date(now.getTime() - EVENT_CLAIM_TIMEOUT_MS) } }],
    },
    data: { claimedAt: now, attempts: { increment: 1 } },
  });
  return res.count === 1;
}

export type EventHandler = (platform: Platform, fields: EventFields) => Promise<void>;

/** Claims, handles and marks one event. Errors are stored; the tick retries. */
export async function processEvent(id: string, handler: EventHandler, now: Date = new Date()): Promise<boolean> {
  if (!(await claimEvent(id, now))) return false;
  const ev = await prisma.integrationEvent.findUnique({ where: { id }, select: { platform: true, payload: true } });
  if (!ev) return false;
  try {
    await handler(ev.platform, eventFields(ev.platform, (ev.payload ?? {}) as Raw));
    await prisma.integrationEvent.update({ where: { id }, data: { processedAt: new Date(), error: null } });
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.integrationEvent
      .update({ where: { id }, data: { error: message.slice(0, 500), claimedAt: null } })
      .catch(() => undefined);
    console.error("[inbox] event failed", id, message);
    return false;
  }
}

/** Worker tick: retry events whose webhook handling never finished. */
export async function drainIntegrationEvents(
  deadline: number,
  handler: EventHandler,
  now: Date = new Date(),
  batch = 25
): Promise<number> {
  const events = await prisma.integrationEvent.findMany({
    where: {
      processedAt: null,
      attempts: { lt: MAX_EVENT_ATTEMPTS },
      receivedAt: { lt: new Date(now.getTime() - EVENT_GRACE_MS) },
      OR: [{ claimedAt: null }, { claimedAt: { lt: new Date(now.getTime() - EVENT_CLAIM_TIMEOUT_MS) } }],
    },
    orderBy: { receivedAt: "asc" },
    take: batch,
    select: { id: true },
  });
  let done = 0;
  for (const ev of events) {
    if (Date.now() > deadline) break;
    if (await processEvent(ev.id, handler)) done++;
  }
  return done;
}

export async function pruneIntegrationEvents(now: Date = new Date()): Promise<number> {
  const day = 24 * 3600_000;
  const res = await prisma.integrationEvent.deleteMany({
    where: {
      OR: [
        { processedAt: { lt: new Date(now.getTime() - PROCESSED_EVENT_RETENTION_DAYS * day) } },
        { receivedAt: { lt: new Date(now.getTime() - FAILED_EVENT_RETENTION_DAYS * day) } },
      ],
    },
  });
  return res.count;
}
