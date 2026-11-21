import { PrintJobKind, PrintJobStatus, WaveItemStatus, WaveStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getDailyTruthReport } from "@/lib/analytics/daily-returns";
import { getCatalog } from "@/lib/catalog/garments";
import { getShopeeBumpStatus } from "@/lib/catalog/shopee-bump";
import { getMoneySummary } from "@/lib/money/summary";
import { isOnline } from "@/lib/print/device";
import { formatTelegramDailyBrief } from "@/lib/reports/brief";
import { formatManilaDateTime, getManilaRangeBounds } from "@/lib/time";
import { missingWhere, overdueWhere } from "@/lib/returns/rules";
import { getReadyCounts } from "@/lib/waves/build";

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
    ].join("\n");
  }

  if (text.startsWith("/ship") || text.startsWith("/waves") || text.includes("ready to ship")) {
    const now = new Date();
    const { start, end } = getManilaRangeBounds("today");
    const [ready, printedTodayCount, printDevice, printerQueuedCount, waveNeedAttentionCount] =
      await Promise.all([
        getReadyCounts(now),
        prisma.printJob.count({
          where: {
            kind: PrintJobKind.LABEL,
            status: PrintJobStatus.PRINTED,
            printedAt: { gte: start, lt: end },
          },
        }),
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
          .filter((v) => v.available !== null && v.available <= 5)
          .map((v) => ({ name: g.name, label: v.label, available: v.available! }))
      )
      .sort((a, b) => a.available - b.available);
    if (!low.length) {
      return `ALL STOCKED — No items at 5 pieces or below right now.`;
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
