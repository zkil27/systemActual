import { prisma } from "@/lib/prisma";
import { getDailyTruthReport } from "@/lib/analytics/daily-returns";
import { formatTelegramDailyBrief } from "@/lib/reports/brief";
import { formatManilaDateTime } from "@/lib/time";
import { missingWhere, overdueWhere } from "@/lib/returns/rules";

export async function sendTelegramMessage(chatId: string, text: string): Promise<boolean> {
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
      }),
    });
    return res.ok;
  } catch (err) {
    console.error("[Telegram send error]", err);
    return false;
  }
}

export async function notifyOwnerTelegram(text: string): Promise<boolean> {
  const settings = await prisma.appSettings.findUnique({ where: { id: "default" } });
  if (!settings?.telegramChatId) return false;
  return sendTelegramMessage(settings.telegramChatId, text);
}

/**
 * Deterministic command & keyword router for the owner's free Telegram bot.
 * Supports /today, /failed, /returns, /missing, /overdue plus simple English/Taglish keywords.
 */
export async function buildTelegramReply(rawInput: string): Promise<string> {
  const text = rawInput.trim().toLowerCase();

  if (text.startsWith("/missing") || text.includes("missing") || text.includes("kulang") || text.includes("wala pa")) {
    const missing = await prisma.returnParcel.findMany({
      where: missingWhere,
      orderBy: { courierReturnedToSellerAt: "desc" },
      take: 15,
    });
    if (missing.length === 0) {
      return "ALL CLEAR — 0 missing parcels right now. Every parcel marked returned by couriers has been scanned at your warehouse.";
    }
    const lines = [
      `MISSING PARCELS (${missing.length})`,
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
    return lines.join("\n");
  }

  if (text.startsWith("/overdue") || text.includes("overdue") || text.includes("stuck")) {
    const settings = await prisma.appSettings.findUnique({ where: { id: "default" } });
    const days = settings?.overdueRtsDays ?? 10;
    const overdue = await prisma.returnParcel.findMany({
      where: overdueWhere(days),
      orderBy: { digitalReturnTaggedAt: "asc" },
      take: 15,
    });
    if (overdue.length === 0) {
      return `No overdue Failed Delivery parcels (> ${days} days in transit).`;
    }
    const lines = [`OVERDUE FAILED DELIVERIES (> ${days} days, ${overdue.length} total)`, ``];
    for (const p of overdue) {
      const track = p.rtsTrackingNumber || p.forwardTrackingNumber || p.orderSn;
      lines.push(
        `• ${track} (${p.courier}) — ${p.itemSummary}\n  Tagged: ${formatManilaDateTime(p.digitalReturnTaggedAt)}`
      );
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
      `• Est. Unit Cost at Risk: PHP ${fd.taggedEstCostPhp.toLocaleString("en-PH")}`,
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
    ].join("\n");
  }

  if (text.startsWith("/yesterday") || text.includes("yesterday") || text.includes("kahapon")) {
    const report = await getDailyTruthReport({ range: "yesterday" });
    return formatTelegramDailyBrief(report);
  }

  const report = await getDailyTruthReport({ range: "today" });
  return formatTelegramDailyBrief(report);
}
