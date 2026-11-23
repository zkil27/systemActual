import { prisma } from "@/lib/prisma";
import { notifyOwnerTelegram } from "@/lib/telegram";

/** At most one "new buyer messages" Telegram alert per window; the rest are grouped. */
export const CHAT_ALERT_WINDOW_MS = 2 * 60_000;
const CHAT_ALERT_LOCK_ID = "chat-alert";

export interface ChatAlertState {
  /** When the last alert went out. */
  lastSentAt: Date | null;
  /** Messages that arrived since then and haven't been alerted. */
  pending: number;
}

export function chatAlertText(count: number, baseUrl?: string | null): string {
  const what = count === 1 ? "1 new buyer message" : `${count} new buyer messages`;
  const base = baseUrl?.trim().replace(/\/$/, "");
  return base ? `${what}. Open Chats: ${base}/chats` : `${what}. Open Chats in Kyna Ops.`;
}

/**
 * Pure: given the stored state and `incoming` new messages, whether to send an
 * alert now (and for how many messages), and the state to save.
 */
export function planChatAlert(
  state: ChatAlertState,
  incoming: number,
  now: Date
): { sendCount: number | null; next: ChatAlertState } {
  const pending = state.pending + Math.max(0, incoming);
  if (pending <= 0) return { sendCount: null, next: { ...state, pending: 0 } };
  const windowOpen = !state.lastSentAt || now.getTime() - state.lastSentAt.getTime() >= CHAT_ALERT_WINDOW_MS;
  if (!windowOpen) return { sendCount: null, next: { ...state, pending } };
  return { sendCount: pending, next: { lastSentAt: now, pending: 0 } };
}

export interface ChatAlertDeps {
  load: () => Promise<ChatAlertState>;
  save: (state: ChatAlertState) => Promise<void>;
  send: (text: string) => Promise<boolean>;
  now: () => Date;
  baseUrl?: string | null;
}

// The state lives in a WorkerLock row: lockedUntil = last alert, holder = pending count.
const defaultDeps: ChatAlertDeps = {
  async load() {
    const row = await prisma.workerLock.findUnique({ where: { id: CHAT_ALERT_LOCK_ID } });
    const pending = Number.parseInt(row?.holder ?? "0", 10);
    return { lastSentAt: row?.lockedUntil ?? null, pending: Number.isFinite(pending) ? pending : 0 };
  },
  async save(state) {
    const lockedUntil = state.lastSentAt ?? new Date(0);
    await prisma.workerLock.upsert({
      where: { id: CHAT_ALERT_LOCK_ID },
      create: { id: CHAT_ALERT_LOCK_ID, lockedUntil, holder: String(state.pending) },
      update: { lockedUntil, holder: String(state.pending) },
    });
  },
  send: notifyOwnerTelegram,
  now: () => new Date(),
  baseUrl: process.env.APP_BASE_URL,
};

/**
 * Tell the owner on Telegram that buyers wrote. Sample messages don't alert
 * unless `includeSample` is set. Call with `count: 0` to flush grouped alerts.
 * Returns true when an alert was sent.
 */
export async function notifyNewBuyerMessage(
  opts: { count?: number; sample?: boolean; includeSample?: boolean } = {},
  deps: ChatAlertDeps = defaultDeps
): Promise<boolean> {
  if (opts.sample && !opts.includeSample) return false;
  const state = await deps.load();
  const plan = planChatAlert(state, opts.count ?? 1, deps.now());
  if (plan.sendCount === null) {
    if (plan.next.pending !== state.pending) await deps.save(plan.next);
    return false;
  }
  const sent = await deps.send(chatAlertText(plan.sendCount, deps.baseUrl));
  // Keep the messages pending if Telegram isn't set up or failed, so they go out later.
  await deps.save(sent ? plan.next : { ...state, pending: plan.sendCount });
  return sent;
}
