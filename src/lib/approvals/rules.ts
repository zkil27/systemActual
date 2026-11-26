export type ActionRequestStatusValue =
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "EXPIRED"
  | "DONE"
  | "FAILED";

/** Pending approval cards expire automatically after 24 hours. */
export const ACTION_REQUEST_TTL_MS = 24 * 3600_000;

const CALLBACK_RE = /^ar:(approve|reject):([a-zA-Z0-9_-]{8,64})$/;

/** Parses Telegram inline button callback data (`ar:approve:<id>` / `ar:reject:<id>`). */
export function parseApprovalCallbackData(
  raw: string | null | undefined
): { action: "approve" | "reject"; id: string } | null {
  if (!raw) return null;
  const m = CALLBACK_RE.exec(raw.trim());
  if (!m) return null;
  return {
    action: m[1] as "approve" | "reject",
    id: m[2],
  };
}

/** Checks whether a request may still be approved or rejected at `now`. */
export function canDecideActionRequest(
  status: ActionRequestStatusValue,
  expiresAt: Date | null,
  now: Date = new Date()
): { ok: true } | { ok: false; reason: string } {
  if (status !== "PENDING") {
    return { ok: false, reason: `Already ${status.toLowerCase()}.` };
  }
  if (expiresAt && expiresAt.getTime() <= now.getTime()) {
    return { ok: false, reason: "This approval expired." };
  }
  return { ok: true };
}

/** Formats a compact Telegram approval card for an owner 1-tap decision. */
export function formatApprovalTelegramCard(opts: {
  title: string;
  buyerName: string;
  topic: string;
  buyerPreview: string;
  replyText: string;
  needsCheck?: boolean;
  baseUrl?: string | null;
}): string {
  const cleanPreview = opts.buyerPreview.trim().slice(0, 220);
  const cleanReply = opts.replyText.trim().slice(0, 500);
  const base = opts.baseUrl?.trim().replace(/\/$/, "");
  const lines = [
    `APPROVAL NEEDED — ${opts.title}`,
    `Buyer: ${opts.buyerName} · Topic: ${opts.topic}${opts.needsCheck ? " (Needs your check)" : ""}`,
    ``,
    `Buyer wrote: "${cleanPreview}"`,
    `Suggested reply: "${cleanReply}"`,
  ];
  if (base) {
    lines.push(``, `Edit or review in app: ${base}/approvals`);
  }
  return lines.join("\n");
}

/** Telegram Bot API inline_keyboard payload with 1-tap Approve & send / Reject buttons. */
export function buildApprovalInlineKeyboard(requestId: string): {
  inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
} {
  return {
    inline_keyboard: [
      [
        { text: "Approve & send", callback_data: `ar:approve:${requestId}` },
        { text: "Reject", callback_data: `ar:reject:${requestId}` },
      ],
    ],
  };
}
