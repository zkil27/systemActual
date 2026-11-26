import { PrintJobStatus, WaveItemStatus, WaveStatus } from "@prisma/client";
import { getProfitReport } from "@/lib/finance/report";
import { formatProfitTelegram } from "@/lib/finance/telegram";
import { returnCheckLine } from "@/lib/analytics/return-check";
import { prisma } from "@/lib/prisma";
import { getDailyTruthReport } from "@/lib/analytics/daily-returns";
import { getCatalog } from "@/lib/catalog/garments";
import { getShopeeBumpStatus } from "@/lib/catalog/shopee-bump";
import { getMoneySummary } from "@/lib/money/summary";
import { isOnline } from "@/lib/print/device";
import { countPrintedLabels } from "@/lib/print/jobs";
import { formatTelegramDailyBrief } from "@/lib/reports/brief";
import { getRealShopWhere } from "@/lib/shops";
import { formatManilaDateTime, getManilaRangeBounds } from "@/lib/time";
import { missingWhere, overdueWhere } from "@/lib/returns/rules";
import { getReadyCounts } from "@/lib/waves/build";
import { addHeld, HELD_LABELS } from "@/lib/waves/ready";

export async function sendTelegramMessage(
  chatId: string,
  text: string,
  replyMarkup?: Record<string, unknown>
): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token || !chatId) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      }),
    });
    return res.ok;
  } catch (err) {
    console.error("[Telegram send error]", err);
    return false;
  }
}

export async function notifyOwnerTelegram(
  text: string,
  replyMarkup?: Record<string, unknown>
): Promise<boolean> {
  const settings = await prisma.appSettings.findUnique({ where: { id: "default" } });
  if (!settings?.telegramChatId) return false;
  return sendTelegramMessage(settings.telegramChatId, text, replyMarkup);
}

export async function answerTelegramCallback(
  callbackQueryId: string,
  text: string
): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token || !callbackQueryId) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        callback_query_id: callbackQueryId,
        text: text.slice(0, 180),
      }),
    });
    return res.ok;
  } catch (err) {
    console.error("[Telegram answerCallbackQuery error]", err);
    return false;
  }
}

export async function editTelegramMessageText(
  chatId: string,
  messageId: number,
  text: string,
  replyMarkup: Record<string, unknown> = { inline_keyboard: [] }
): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token || !chatId || !messageId) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        text,
        disable_web_page_preview: true,
        reply_markup: replyMarkup,
      }),
    });
    return res.ok;
  } catch (err) {
    console.error("[Telegram editMessageText error]", err);
    return false;
  }
}

/**
 * Deterministic command & keyword router for the owner's free Telegram bot.
 * Supports /today, /failed, /returns, /missing, /overdue plus simple English/Taglish keywords.
 */
export async function buildTelegramReply(rawInput: string): Promise<string> {
  // Exact commands first, so "/order failed-item" isn't caught by the "failed" keyword.
  const { buildOpsCommandReply } = await import("@/lib/telegram-commands");
  const ops = await buildOpsCommandReply(rawInput);
  if (ops !== null) return ops;

  const text = rawInput.trim().toLowerCase();

  if (text.startsWith("/missing") || text.includes("missing") || text.includes("kulang") || text.includes("wala pa")) {
    const [settings, realFilter] = await Promise.all([
      prisma.appSettings.findUnique({
        where: { id: "default" },
        select: { missingSinceAt: true },
      }),
      getRealShopWhere(),
    ]);
    const where = { ...realFilter, ...missingWhere(settings?.missingSinceAt ?? null) };
    const [totalMissing, missing] = await Promise.all([
      prisma.returnParcel.count({ where }),
      prisma.returnParcel.findMany({
        where,
        orderBy: { courierReturnedToSellerAt: "desc" },
        take: 15,
      }),
    ]);
    if (missing.length === 0) {
      return "ALL CLEAR — 0 missing parcels right now. Every parcel marked returned by couriers has been scanned at your warehouse.";
    }
    const lines = [
      `MISSING PARCELS (${totalMissing})`,
      `Driver marked returned, NOT scanned at warehouse yet:`,
      ``,
    ];
    for (const p of missing) {
      const typeLabel = p.category === "FAILED_DELIVERY" ? "Failed Delivery" : "Buyer Return";
      const track = p.rtsTrackingNumber || p.forwardTrackingNumber || p.orderSn;
      lines.push(
        `• ${track} (${p.courier})\n  ${typeLabel} — ${p.itemSummary}${p.variationName ? ` (${p.variationName})` : ""}\n  Driver marked back: ${formatManilaDateTime(p.courierReturnedToSellerAt)}`
      );
    }
    if (totalMissing > missing.length) {
      lines.push(`…and ${totalMissing - missing.length} more in Kyna Ops → Returns.`);
    }
    return lines.join("\n");
  }

  if (text.startsWith("/overdue") || text.includes("overdue") || text.includes("stuck")) {
    const [settings, realFilter] = await Promise.all([
      prisma.appSettings.findUnique({ where: { id: "default" } }),
      getRealShopWhere(),
    ]);
    const days = settings?.overdueRtsDays ?? 10;
    const where = { ...realFilter, ...overdueWhere(days, new Date(), settings?.missingSinceAt ?? null) };
    const [totalOverdue, overdue] = await Promise.all([
      prisma.returnParcel.count({ where }),
      prisma.returnParcel.findMany({
        where,
        orderBy: { digitalReturnTaggedAt: "asc" },
        take: 15,
      }),
    ]);
    if (overdue.length === 0) {
      return `No overdue Failed Delivery parcels (> ${days} days in transit).`;
    }
    const lines = [`OVERDUE FAILED DELIVERIES (> ${days} days, ${totalOverdue} total)`, ``];
    for (const p of overdue) {
      const track = p.rtsTrackingNumber || p.forwardTrackingNumber || p.orderSn;
      lines.push(
        `• ${track} (${p.courier}) — ${p.itemSummary}\n  Tagged: ${formatManilaDateTime(p.digitalReturnTaggedAt)}`
      );
    }
    if (totalOverdue > overdue.length) {
      lines.push(`…and ${totalOverdue - overdue.length} more in Kyna Ops → Returns.`);
    }
    return lines.join("\n");
  }

  if (text.startsWith("/failed") || text.includes("failed") || text.includes("rts")) {
    const report = await getDailyTruthReport({ range: "today" });
    const fd = report.failedDelivery;
    const lines = [
      `FAILED DELIVERY TODAY (${report.rangeLabel})`,
      `• Driver Tagged Today: ${fd.taggedCount} (${fd.taggedPieces} pcs)`,
      `• Driver Says Returned Today: ${fd.courierReturnedCount}`,
      `• Actually Arrived Today: ${fd.physicallyArrivedCount}`,
      `• Shopee: ${fd.shopeeTaggedCount} | TikTok: ${fd.tiktokTaggedCount}`,
      `• Cost at Risk (item + return shipping): PHP ${fd.taggedEstCostPhp.toLocaleString("en-PH")}`,
    ];
    if (fd.byCourier.length > 0) {
      lines.push(``);
      for (const row of fd.byCourier) {
        lines.push(`• ${row.courier}: ${row.tagged} tagged | ${row.arrived} arrived | ${row.missing} missing`);
      }
    }
    return lines.join("\n");
  }

  if (text.startsWith("/returns") || text.includes("refund") || text.includes("buyer return")) {
    const report = await getDailyTruthReport({ range: "today" });
    const rr = report.returnRefund;
    return [
      `BUYER RETURN / REFUND TODAY (${report.rangeLabel})`,
      `• Requested Today: ${rr.taggedCount} (${rr.taggedPieces} pcs)`,
      `• Driver Says Returned Today: ${rr.courierReturnedCount}`,
      `• Actually Arrived Today: ${rr.physicallyArrivedCount}`,
      `• Shopee: ${rr.shopeeTaggedCount} | TikTok: ${rr.tiktokTaggedCount}`,
      `• Dispute Deadlines < 24h: ${report.combined.urgentDeadlineCount}`,
      `• Return check: ${returnCheckLine(report.returnCheck) ?? "every checked parcel came back complete"}`,
      `• Refunded, not back: ${report.returnCheck.refundedNotBackCount}`,
    ].join("\n");
  }

  if (text.startsWith("/ship") || text.startsWith("/waves") || text.includes("ready to ship")) {
    const now = new Date();
    const { start, end } = getManilaRangeBounds("today");
    const [ready, printedTodayCount, printDevice, printerQueuedCount, waveNeedAttentionCount] =
      await Promise.all([
        getReadyCounts(now, { live: true }),
        countPrintedLabels(start, end),
        prisma.printDevice.findFirst({ orderBy: { createdAt: "desc" } }),
        prisma.printJob.count({
          where: { status: { in: [PrintJobStatus.QUEUED, PrintJobStatus.PRINTING] } },
        }),
        prisma.waveItem.count({
          where: {
            status: WaveItemStatus.FAILED,
            wave: {
              OR: [
                { status: WaveStatus.RUNNING },
                { status: WaveStatus.DONE, createdAt: { gte: start, lt: end } },
              ],
            },
          },
        }),
      ]);
    const printerOnline = printDevice ? isOnline(printDevice.lastSeenAt, now) : false;
    const lines = [
      `SHIPPING STATUS`,
      `• Ready to ship: ${ready.totalReady} (Shopee ${ready.byPlatform.SHOPEE} | TikTok ${ready.byPlatform.TIKTOK})`,
      ...(ready.coolingOff ? [`• Waiting 1h buyer cancel window: ${ready.coolingOff}`] : []),
      ...(() => {
        const held = addHeld(ready.held.SHOPEE, ready.held.TIKTOK);
        const parts = HELD_LABELS.filter(([k]) => held[k] > 0).map(([k, label]) => `${held[k]} ${label}`);
        return parts.length ? [`• Held: ${parts.join(", ")}`] : [];
      })(),
      ...(ready.live.TIKTOK !== null ? [`• TikTok Seller Center: ${ready.live.TIKTOK} to ship`] : []),
      `• Printed today: ${printedTodayCount}`,
      `• Printer PC: ${printerOnline ? "Online" : "Offline"}${printerQueuedCount ? ` (${printerQueuedCount} in queue)` : ""}`,
      ...(waveNeedAttentionCount ? [`• NEED ATTENTION: ${waveNeedAttentionCount} parcel(s) failed — open Waves`] : []),
    ];
    if (ready.byCourier.length) {
      lines.push(``);
      for (const c of ready.byCourier) lines.push(`• ${c.courier}: ${c.count}`);
    }
    return lines.join("\n");
  }

  if (text.startsWith("/stock") || text.includes("low stock") || text.includes("out of stock")) {
    const catalog = await getCatalog();
    const low = catalog
      .flatMap((g) =>
        g.variants
          .filter((v) => v.available !== null && v.available <= g.lowStockAt)
          .map((v) => ({ name: g.name, label: v.label, available: v.available! }))
      )
      .sort((a, b) => a.available - b.available);
    if (!low.length) {
      return `ALL STOCKED — Nothing at or below its low-stock line right now.`;
    }
    const lines = [`LOW / OUT OF STOCK (${low.length} variants)`, ``];
    for (const item of low.slice(0, 15)) {
      lines.push(`• ${item.available === 0 ? "OUT" : `${item.available} left`} — ${item.name} (${item.label})`);
    }
    if (low.length > 15) lines.push(`…and ${low.length - 15} more in Items & stock.`);
    return lines.join("\n");
  }

  if (text.startsWith("/bump") || text.includes("boost")) {
    const bump = await getShopeeBumpStatus();
    if (!bump.connected) return "Shopee is not connected yet.";
    const lines = [
      `SHOPEE AUTO-BUMP: ${bump.enabled ? "ON" : "OFF"} (${bump.boosted.length}/${bump.slotsTotal} active)`,
      ``,
    ];
    if (bump.boosted.length) {
      for (const b of bump.boosted) {
        const h = Math.floor(b.cooldownSecond / 3600);
        const m = Math.floor((b.cooldownSecond % 3600) / 60);
        lines.push(`• ${b.name} (${h > 0 ? `${h}h ${m}m` : `${m}m`} left)`);
      }
    } else {
      lines.push(`No items boosted right now. Turn on Auto-Bump in Items & stock.`);
    }
    return lines.join("\n");
  }

  if (text.startsWith("/profit") || text.includes("profit")) {
    const r = await getProfitReport();
    return formatProfitTelegram(r);
  }

  if (text.startsWith("/money") || text.includes("credited") || text.includes("sales")) {
    const { label, start, end } = getManilaRangeBounds("today");
    const m = await getMoneySummary(start, end);
    const peso = (n: number) => `PHP ${Math.round(n).toLocaleString("en-PH")}`;
    return [
      `MONEY CREDITED TODAY (${label})`,
      `• Total credited: ${peso(m.creditedPhp)}`,
      `• Shopee: ${peso(m.creditedShopeePhp)} | TikTok: ${peso(m.creditedTikTokPhp)}`,
      `• Orders placed (not yet credited): ${m.ordersPlacedCount} — ${peso(m.ordersPlacedPhp)}`,
    ].join("\n");
  }

  if (text.startsWith("/yesterday") || text.includes("yesterday") || text.includes("kahapon")) {
    const report = await getDailyTruthReport({ range: "yesterday" });
    return formatTelegramDailyBrief(report);
  }

  const report = await getDailyTruthReport({ range: "today" });
  return formatTelegramDailyBrief(report);
}
