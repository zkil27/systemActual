import { NextRequest, NextResponse, after } from "next/server";
import { parseApprovalCallbackData } from "@/lib/approvals/rules";
import { approveActionRequest, rejectActionRequest } from "@/lib/approvals/service";
import {
  answerTelegramCallback,
  buildTelegramReply,
  editTelegramMessageText,
  sendTelegramMessage,
} from "@/lib/telegram";
import { isAuthorizedTelegramChat, parseTelegramStartCode, verifyTelegramSecret } from "@/lib/telegram-auth";
import { prisma } from "@/lib/prisma";
import { runTick } from "@/lib/worker/tick";
import {
  buildOpsConfirmPrompt,
  executeOpsCallback,
  HELP_TEXT,
  isConfirmableOpsCommand,
  parseCommand,
  parseOpsCallbackData,
} from "@/lib/telegram-commands";

const STALE_SYNC_MS = 3 * 60_000;
const TELEGRAM_PAIR_LOCK_ID = "telegram-pair";

export async function POST(req: NextRequest) {
  try {
    const auth = verifyTelegramSecret(req.headers.get("x-telegram-bot-api-secret-token"));
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const update = await req.json();
    const callback = update?.callback_query;
    if (callback?.id) {
      const cbChatId = callback?.message?.chat?.id ? String(callback.message.chat.id) : "";
      const cbMsgId = typeof callback?.message?.message_id === "number" ? callback.message.message_id : 0;
      const settings = await prisma.appSettings.findUnique({ where: { id: "default" } });
      if (!isAuthorizedTelegramChat(cbChatId, settings?.telegramChatId)) {
        await answerTelegramCallback(String(callback.id), "Not authorized.");
        return NextResponse.json({ ok: true });
      }
      const rawCbData = typeof callback.data === "string" ? callback.data : "";
      const opsCb = parseOpsCallbackData(rawCbData);
      if (opsCb) {
        const outcome = await executeOpsCallback(opsCb.action, opsCb.cmd);
        if (outcome.triggerManualSync) {
          after(() => runTick("manual").catch((err) => console.error("[telegram sync]", err)));
        }
        await answerTelegramCallback(String(callback.id), outcome.toast);
        if (cbChatId && cbMsgId) {
          await editTelegramMessageText(
            cbChatId,
            cbMsgId,
            outcome.text,
            outcome.replyMarkup ?? { inline_keyboard: [] }
          );
        }
        return NextResponse.json({ ok: true });
      }

      const parsed = parseApprovalCallbackData(rawCbData);
      if (!parsed) {
        await answerTelegramCallback(String(callback.id), "Unknown button.");
        return NextResponse.json({ ok: true });
      }
      const actor = { type: "OWNER" as const, id: null, name: "Owner (Telegram)" };
      const outcome =
        parsed.action === "approve"
          ? await approveActionRequest(parsed.id, { actor })
          : await rejectActionRequest(parsed.id, { actor });

      const toastText = outcome.ok
        ? parsed.action === "approve"
          ? "Sent to buyer!"
          : "Rejected."
        : outcome.error;
      await answerTelegramCallback(String(callback.id), toastText);

      const originalText = typeof callback?.message?.text === "string" ? callback.message.text : "";
      const statusLine = outcome.ok
        ? parsed.action === "approve"
          ? "STATUS: APPROVED & SENT"
          : "STATUS: REJECTED"
        : `STATUS: ${outcome.error}`;
      if (cbChatId && cbMsgId) {
        await editTelegramMessageText(
          cbChatId,
          cbMsgId,
          originalText ? `${originalText}\n\n${statusLine}` : statusLine
        );
      }
      return NextResponse.json({ ok: true });
    }

    const message = update?.message;
    const chatId = message?.chat?.id ? String(message.chat.id) : "";
    const text = typeof message?.text === "string" ? message.text : "";

    if (!chatId || !text) {
      return NextResponse.json({ ok: true });
    }

    const settings = await prisma.appSettings.findUnique({ where: { id: "default" } });
    const trimmed = text.trim();

    if (trimmed.toLowerCase().startsWith("/start")) {
      if (settings?.telegramChatId) {
        if (!isAuthorizedTelegramChat(chatId, settings.telegramChatId)) {
          await sendTelegramMessage(chatId, "This bot is private to the store owner.");
          return NextResponse.json({ ok: true });
        }
      } else {
        const pairCode = parseTelegramStartCode(trimmed);
        const now = new Date();
        const pairLock = pairCode
          ? await prisma.workerLock.findUnique({ where: { id: TELEGRAM_PAIR_LOCK_ID } })
          : null;
        const validPair = Boolean(
          pairLock &&
            pairCode &&
            pairLock.lockedUntil.getTime() > now.getTime() &&
            pairLock.holder === pairCode
        );
        if (!validPair) {
          await sendTelegramMessage(
            chatId,
            [
              `To connect this Telegram chat to Kyna Ops:`,
              `1. Open Kyna Ops → Settings → Telegram and tap "Generate pairing code" (or enter your Chat ID: ${chatId}).`,
              `2. Send /start <code> here within 10 minutes.`,
            ].join("\n")
          );
          return NextResponse.json({ ok: true });
        }
        await prisma.$transaction([
          prisma.appSettings.upsert({
            where: { id: "default" },
            create: { id: "default", telegramChatId: chatId },
            update: { telegramChatId: chatId },
          }),
          prisma.workerLock.deleteMany({ where: { id: TELEGRAM_PAIR_LOCK_ID } }),
        ]);
      }

      const welcome = [
        `Connected to Kyna Ops!`,
        `Your Telegram Chat ID (${chatId}) is linked for the daily summary and alerts`,
        `(printer offline, failed prints, stalled waves, stock-outs, dispute deadlines).`,
        ``,
        HELP_TEXT,
      ].join("\n");
      await sendTelegramMessage(chatId, welcome);
      return NextResponse.json({ ok: true });
    }

    // Only the linked owner chat can query store numbers or trigger background syncs.
    if (!isAuthorizedTelegramChat(chatId, settings?.telegramChatId)) {
      return NextResponse.json({ ok: true });
    }

    // Free opportunistic sync if shops haven't synced recently.
    const stale = await prisma.shopConnection.count({
      where: {
        isDemo: false,
        accessToken: { not: null },
        OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: new Date(Date.now() - STALE_SYNC_MS) } }],
      },
    });
    if (stale > 0) {
      after(() => runTick("webhook").catch((err) => console.error("[telegram bg tick]", err)));
    }

    const parsedCmd = parseCommand(text);
    if (parsedCmd && isConfirmableOpsCommand(parsedCmd.cmd)) {
      const prompt = buildOpsConfirmPrompt(parsedCmd.cmd);
      await sendTelegramMessage(chatId, prompt.text, prompt.replyMarkup);
      return NextResponse.json({ ok: true });
    }

    const reply = await buildTelegramReply(text);
    await sendTelegramMessage(chatId, reply);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[Telegram webhook error]", err);
    return NextResponse.json({ ok: true });
  }
}
