import { NextRequest, NextResponse, after } from "next/server";
import { buildTelegramReply, sendTelegramMessage } from "@/lib/telegram";
import { prisma } from "@/lib/prisma";
import { runTick } from "@/lib/worker/tick";

const STALE_SYNC_MS = 3 * 60_000;

export async function POST(req: NextRequest) {
  try {
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
    if (secret) {
      const header = req.headers.get("x-telegram-bot-api-secret-token");
      if (header !== secret) {
        return NextResponse.json({ error: "Invalid secret token" }, { status: 401 });
      }
    }

    const update = await req.json();
    const message = update?.message;
    const chatId = message?.chat?.id ? String(message.chat.id) : "";
    const text = typeof message?.text === "string" ? message.text : "";

    if (!chatId || !text) {
      return NextResponse.json({ ok: true });
    }

    // Auto-save owner chat ID on /start if not configured yet
    if (text.trim().startsWith("/start")) {
      const settings = await prisma.appSettings.findUnique({ where: { id: "default" } });
      if (!settings?.telegramChatId) {
        await prisma.appSettings.upsert({
          where: { id: "default" },
          create: { id: "default", telegramChatId: chatId },
          update: { telegramChatId: chatId },
        });
      }
      const welcome = [
        `Connected to Kyna Ops!`,
        `Your Telegram Chat ID (${chatId}) is linked for 8:00 PM daily return summaries.`,
        ``,
        `Try these commands anytime:`,
        `/today — Today's money, shipping, stock & returns`,
        `/ship — Parcels ready to ship & printer status`,
        `/stock — Low & out-of-stock items`,
        `/bump — Shopee Auto-Bump active slots`,
        `/money — Money credited today`,
        `/missing — Parcels driver marked returned but not scanned yet`,
        `/overdue — Failed Deliveries stuck > 10 days`,
      ].join("\n");
      await sendTelegramMessage(chatId, welcome);
      return NextResponse.json({ ok: true, reply: welcome });
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

    const reply = await buildTelegramReply(text);
    await sendTelegramMessage(chatId, reply);
    return NextResponse.json({ ok: true, reply });
  } catch (err) {
    console.error("[Telegram webhook error]", err);
    return NextResponse.json({ ok: true });
  }
}
