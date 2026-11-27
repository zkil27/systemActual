import { sendNotification, setVapidDetails } from "web-push";
import { prisma } from "@/lib/prisma";
import { isMissingTableError } from "@/lib/dev/db-errors";
import { formatPushFromAlert, sanitizePushUrl, type PushPayload } from "@/lib/push-format";

export { formatPushFromAlert, labelFromUserAgent, sanitizePushUrl, type PushPayload } from "@/lib/push-format";

const DEFAULT_VAPID_SUBJECT = "mailto:ops@kyna.ph";
const PUSH_TTL_SECONDS = 3600;
const PUSH_TIMEOUT_MS = 8000;
const LAST_USED_UPDATE_MS = 6 * 60 * 60_000;

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

export function getVapidConfig(env: Record<string, string | undefined> = process.env): VapidConfig | null {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) return null;
  const rawSubject = env.VAPID_SUBJECT?.trim();
  const subject =
    rawSubject && (rawSubject.startsWith("mailto:") || rawSubject.startsWith("https://"))
      ? rawSubject
      : DEFAULT_VAPID_SUBJECT;
  return { publicKey, privateKey, subject };
}

export function isPushConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return getVapidConfig(env) !== null;
}

export async function hasActivePushSubscriptions(): Promise<boolean> {
  if (!isPushConfigured()) return false;
  try {
    const count = await prisma.pushSubscription.count();
    return count > 0;
  } catch (err) {
    if (isMissingTableError(err)) return false;
    console.error("[push] count subscriptions", err);
    return false;
  }
}

export interface PushSendSummary {
  sent: number;
  failed: number;
  pruned: number;
}

function getPushStatusCode(err: unknown): number | null {
  if (!err || typeof err !== "object") return null;
  const code = (err as { statusCode?: unknown }).statusCode;
  return typeof code === "number" ? code : null;
}

/**
 * Send a Web Push notification to all subscribed owner devices (or a single
 * owner / endpoint). Automatically removes expired 404/410 subscriptions.
 */
export async function sendOwnerPush(
  payload: PushPayload,
  opts?: { ownerUserId?: string; endpoint?: string }
): Promise<PushSendSummary> {
  const cfg = getVapidConfig();
  if (!cfg) return { sent: 0, failed: 0, pruned: 0 };

  let subs: Array<{
    id: string;
    endpoint: string;
    p256dh: string;
    auth: string;
    lastUsedAt: Date | null;
  }>;
  try {
    subs = await prisma.pushSubscription.findMany({
      where: {
        ...(opts?.ownerUserId ? { ownerUserId: opts.ownerUserId } : {}),
        ...(opts?.endpoint ? { endpoint: opts.endpoint } : {}),
      },
      select: { id: true, endpoint: true, p256dh: true, auth: true, lastUsedAt: true },
    });
  } catch (err) {
    if (isMissingTableError(err)) return { sent: 0, failed: 0, pruned: 0 };
    console.error("[push] load subscriptions", err);
    return { sent: 0, failed: 0, pruned: 0 };
  }

  if (subs.length === 0) return { sent: 0, failed: 0, pruned: 0 };

  setVapidDetails(cfg.subject, cfg.publicKey, cfg.privateKey);
  const body = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: sanitizePushUrl(payload.url),
    ...(payload.tag ? { tag: payload.tag } : {}),
  });

  const now = new Date();
  const staleIds: string[] = [];
  const touchIds: string[] = [];
  let sent = 0;
  let failed = 0;

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          body,
          { TTL: PUSH_TTL_SECONDS, timeout: PUSH_TIMEOUT_MS }
        );
        sent++;
        if (!sub.lastUsedAt || now.getTime() - sub.lastUsedAt.getTime() >= LAST_USED_UPDATE_MS) {
          touchIds.push(sub.id);
        }
      } catch (err) {
        const status = getPushStatusCode(err);
        if (status === 404 || status === 410) {
          staleIds.push(sub.id);
        } else {
          failed++;
          console.error("[push] send error", status ?? "", err instanceof Error ? err.message : err);
        }
      }
    })
  );

  if (staleIds.length > 0) {
    await prisma.pushSubscription.deleteMany({ where: { id: { in: staleIds } } }).catch(() => {});
  }
  if (touchIds.length > 0) {
    await prisma.pushSubscription
      .updateMany({ where: { id: { in: touchIds } }, data: { lastUsedAt: now } })
      .catch(() => {});
  }

  return { sent, failed, pruned: staleIds.length };
}

export async function notifyOwnerPushFromText(
  text: string,
  override?: Partial<PushPayload>
): Promise<PushSendSummary> {
  return sendOwnerPush(formatPushFromAlert(text, override));
}
