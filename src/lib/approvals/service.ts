import { ActionRequestStatus, ChatDraftStatus, Prisma } from "@prisma/client";
import { recordAudit, type AuditActor } from "@/lib/audit";
import { checkReplyText } from "@/lib/chats/send";
import { sendChatMessage } from "@/lib/chats/service";
import { prisma } from "@/lib/prisma";
import { notifyOwnerTelegram } from "@/lib/telegram";
import {
  ACTION_REQUEST_TTL_MS,
  buildApprovalInlineKeyboard,
  canDecideActionRequest,
  formatApprovalTelegramCard,
  type ActionRequestStatusValue,
} from "./rules";

export interface ChatReplyPayload {
  conversationId: string;
  draftId?: string | null;
  buyerName: string;
  buyerMessageId: string;
  buyerPreview: string;
  text: string;
  topic: string;
  needsCheck?: boolean;
}

export interface ActionRequestDto {
  id: string;
  kind: string;
  status: ActionRequestStatusValue;
  title: string;
  summary: string;
  payload: Record<string, unknown>;
  conversationId: string | null;
  proposedBy: string;
  expiresAt: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  result: Record<string, unknown> | null;
  error: string | null;
  createdAt: string;
}

function asObj(value: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function toDto(row: {
  id: string;
  kind: string;
  status: ActionRequestStatus;
  title: string;
  summary: string;
  payloadJson: Prisma.JsonValue;
  conversationId: string | null;
  proposedBy: string;
  expiresAt: Date | null;
  decidedBy: string | null;
  decidedAt: Date | null;
  resultJson: Prisma.JsonValue | null;
  error: string | null;
  createdAt: Date;
}): ActionRequestDto {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    title: row.title,
    summary: row.summary,
    payload: asObj(row.payloadJson),
    conversationId: row.conversationId,
    proposedBy: row.proposedBy,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
    result: row.resultJson ? asObj(row.resultJson) : null,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function expireStaleActionRequests(now: Date = new Date()): Promise<number> {
  const res = await prisma.actionRequest.updateMany({
    where: {
      status: ActionRequestStatus.PENDING,
      expiresAt: { lt: now },
    },
    data: { status: ActionRequestStatus.EXPIRED },
  });
  return res.count;
}

export async function listActionRequests(opts?: {
  status?: ActionRequestStatus | "ALL";
  kind?: string;
}): Promise<ActionRequestDto[]> {
  await expireStaleActionRequests();
  const where: Prisma.ActionRequestWhereInput = {};
  if (opts?.status && opts.status !== "ALL") {
    where.status = opts.status;
  }
  if (opts?.kind) {
    where.kind = opts.kind;
  }
  const rows = await prisma.actionRequest.findMany({
    where,
    orderBy: [{ createdAt: "desc" }],
    take: 80,
  });
  return rows.map(toDto);
}

export async function countPendingActionRequests(): Promise<number> {
  await expireStaleActionRequests();
  return prisma.actionRequest.count({
    where: { status: ActionRequestStatus.PENDING },
  });
}

export async function createChatReplyApproval(input: {
  conversationId: string;
  draftId?: string | null;
  buyerName: string;
  buyerMessageId: string;
  buyerPreview: string;
  replyText: string;
  topic: string;
  needsCheck?: boolean;
  proposedBy: string;
}): Promise<{ created: boolean; request: ActionRequestDto }> {
  const dedupeKey = `chat.reply:${input.conversationId}:${input.buyerMessageId}`;
  const expiresAt = new Date(Date.now() + ACTION_REQUEST_TTL_MS);
  const payload: ChatReplyPayload = {
    conversationId: input.conversationId,
    draftId: input.draftId ?? null,
    buyerName: input.buyerName,
    buyerMessageId: input.buyerMessageId,
    buyerPreview: input.buyerPreview,
    text: input.replyText,
    topic: input.topic,
    needsCheck: Boolean(input.needsCheck),
  };

  try {
    const row = await prisma.actionRequest.create({
      data: {
        kind: "chat.reply",
        status: ActionRequestStatus.PENDING,
        title: `Reply to ${input.buyerName}`,
        summary: input.buyerPreview.trim().slice(0, 240) || "Buyer question",
        payloadJson: payload as unknown as Prisma.InputJsonValue,
        conversationId: input.conversationId,
        proposedBy: input.proposedBy,
        dedupeKey,
        expiresAt,
      },
    });

    const card = formatApprovalTelegramCard({
      title: row.title,
      buyerName: input.buyerName,
      topic: input.topic,
      buyerPreview: input.buyerPreview,
      replyText: input.replyText,
      needsCheck: input.needsCheck,
      baseUrl: process.env.APP_BASE_URL,
    });
    await notifyOwnerTelegram(card, buildApprovalInlineKeyboard(row.id)).catch((err) =>
      console.error("[approvals] telegram notify", err)
    );

    return { created: true, request: toDto(row) };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const existing = await prisma.actionRequest.findUniqueOrThrow({
        where: { dedupeKey },
      });
      return { created: false, request: toDto(existing) };
    }
    throw err;
  }
}

export async function approveActionRequest(
  id: string,
  opts: { actor: AuditActor; editedText?: string }
): Promise<{ ok: true; request: ActionRequestDto } | { ok: false; error: string }> {
  const now = new Date();
  const claimed = await prisma.actionRequest.updateMany({
    where: {
      id,
      status: ActionRequestStatus.PENDING,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    data: {
      status: ActionRequestStatus.APPROVED,
      decidedBy: opts.actor.name,
      decidedAt: now,
    },
  });

  if (claimed.count !== 1) {
    const existing = await prisma.actionRequest.findUnique({ where: { id } });
    if (!existing) return { ok: false, error: "Approval request not found." };
    if (
      existing.status === ActionRequestStatus.PENDING &&
      existing.expiresAt &&
      existing.expiresAt.getTime() <= now.getTime()
    ) {
      await prisma.actionRequest.update({
        where: { id },
        data: { status: ActionRequestStatus.EXPIRED },
      });
    }
    const check = canDecideActionRequest(existing.status, existing.expiresAt, now);
    return {
      ok: false,
      error: check.ok ? "Another tap already handled this approval." : check.reason,
    };
  }

  const req = await prisma.actionRequest.findUniqueOrThrow({ where: { id } });
  if (req.kind !== "chat.reply") {
    const failed = await prisma.actionRequest.update({
      where: { id },
      data: {
        status: ActionRequestStatus.FAILED,
        error: `Unsupported approval kind: ${req.kind}`,
      },
    });
    return { ok: false, error: failed.error ?? "Unsupported approval kind." };
  }

  const payload = asObj(req.payloadJson) as unknown as Partial<ChatReplyPayload>;
  const checked = checkReplyText(opts.editedText !== undefined ? opts.editedText : payload.text);
  if (!checked.ok) {
    await prisma.actionRequest.update({
      where: { id },
      data: { status: ActionRequestStatus.FAILED, error: checked.error },
    });
    return { ok: false, error: checked.error };
  }

  if (!payload.conversationId) {
    await prisma.actionRequest.update({
      where: { id },
      data: { status: ActionRequestStatus.FAILED, error: "Missing chat conversation id." },
    });
    return { ok: false, error: "Missing chat conversation id." };
  }

  try {
    const sent = await sendChatMessage(payload.conversationId, `ar_${id}`, {
      text: checked.text,
    });
    if (sent.status !== "SENT") {
      throw new Error("TikTok couldn't deliver the reply right now.");
    }
    if (payload.draftId) {
      await prisma.chatDraft
        .updateMany({
          where: { id: payload.draftId, status: ChatDraftStatus.PENDING },
          data: { status: ChatDraftStatus.USED },
        })
        .catch(() => {});
    }
    const done = await prisma.actionRequest.update({
      where: { id },
      data: {
        status: ActionRequestStatus.DONE,
        resultJson: {
          messageId: sent.id,
          sentText: checked.text,
        },
      },
    });
    await recordAudit({
      actor: opts.actor,
      action: "approval.approved",
      entity: "ActionRequest",
      entityId: id,
      after: {
        kind: req.kind,
        conversationId: payload.conversationId,
        messageId: sent.id,
        edited: Boolean(opts.editedText && opts.editedText.trim() !== payload.text?.trim()),
      },
    });
    return { ok: true, request: toDto(done) };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Couldn't send reply.";
    await prisma.actionRequest.update({
      where: { id },
      data: { status: ActionRequestStatus.FAILED, error: message.slice(0, 300) },
    });
    await recordAudit({
      actor: opts.actor,
      action: "approval.failed",
      entity: "ActionRequest",
      entityId: id,
      after: { kind: req.kind, error: message.slice(0, 200) },
    });
    return { ok: false, error: message };
  }
}

export async function rejectActionRequest(
  id: string,
  opts: { actor: AuditActor; reason?: string }
): Promise<{ ok: true; request: ActionRequestDto } | { ok: false; error: string }> {
  const now = new Date();
  const res = await prisma.actionRequest.updateMany({
    where: {
      id,
      status: ActionRequestStatus.PENDING,
    },
    data: {
      status: ActionRequestStatus.REJECTED,
      decidedBy: opts.actor.name,
      decidedAt: now,
      error: opts.reason?.trim().slice(0, 200) || null,
    },
  });
  if (res.count !== 1) {
    const existing = await prisma.actionRequest.findUnique({ where: { id } });
    if (!existing) return { ok: false, error: "Approval request not found." };
    const check = canDecideActionRequest(existing.status, existing.expiresAt, now);
    return {
      ok: false,
      error: check.ok ? "Already decided." : check.reason,
    };
  }

  const row = await prisma.actionRequest.findUniqueOrThrow({ where: { id } });
  const payload = asObj(row.payloadJson) as { draftId?: string | null };
  if (payload.draftId) {
    await prisma.chatDraft
      .updateMany({
        where: { id: payload.draftId, status: ChatDraftStatus.PENDING },
        data: { status: ChatDraftStatus.DISMISSED },
      })
      .catch(() => {});
  }

  await recordAudit({
    actor: opts.actor,
    action: "approval.rejected",
    entity: "ActionRequest",
    entityId: id,
    after: {
      kind: row.kind,
      conversationId: row.conversationId,
      reason: opts.reason?.trim() || null,
    },
  });

  return { ok: true, request: toDto(row) };
}
