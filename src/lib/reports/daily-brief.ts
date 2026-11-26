import { prisma } from "@/lib/prisma";
import { getDailyTruthReport } from "@/lib/analytics/daily-returns";
import {
  getOverduePurchaseOrders,
  getReorderSuggestions,
} from "@/lib/restock/service";
import { getManilaDateString } from "@/lib/time";
import { hasActivePushSubscriptions, sendOwnerPush } from "@/lib/push";
import { formatTelegramDailyBrief } from "./brief";
import { sendTelegramMessage } from "@/lib/telegram";

const MANILA_OFFSET_MIN = 8 * 60;

/**
 * The brief goes out once per Manila day, on the first tick at or after the
 * set time (stored in UTC; "12:00" = 8:00 PM Manila). There's no cron, so it
 * relies on a tick happening: the PC agent or any webhook after that time.
 */
export function isBriefDue(now: Date, briefUtc: string, sentOn: string | null): boolean {
  const [h, m] = briefUtc.split(":").map(Number);
  const utcMin = Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : 12 * 60;
  const briefManilaMin = (utcMin + MANILA_OFFSET_MIN) % 1440;
  const manila = new Date(now.getTime() + MANILA_OFFSET_MIN * 60_000);
  const nowMin = manila.getUTCHours() * 60 + manila.getUTCMinutes();
  return sentOn !== getManilaDateString(now) && nowMin >= briefManilaMin;
}

export async function sendDailyBriefIfDue(now: Date = new Date()): Promise<boolean> {
  const settings = await prisma.appSettings.findUnique({ where: { id: "default" } });
  if (!settings) return false;
  const hasTelegram = Boolean(settings.telegramChatId && process.env.TELEGRAM_BOT_TOKEN?.trim());
  const hasPush = await hasActivePushSubscriptions();
  if (!hasTelegram && !hasPush) return false;
  if (!isBriefDue(now, settings.telegramDailyBriefUtc, settings.dailyBriefSentOn)) return false;

  const today = getManilaDateString(now);
  // Claim today's brief first, so two ticks can't both send it.
  const claimed = await prisma.appSettings.updateMany({
    where: { id: "default", OR: [{ dailyBriefSentOn: null }, { dailyBriefSentOn: { not: today } }] },
    data: { dailyBriefSentOn: today },
  });
  if (claimed.count !== 1) return false;

  const [report, suggestions, overdue] = await Promise.all([
    getDailyTruthReport({ range: "today" }),
    getReorderSuggestions(now),
    getOverduePurchaseOrders(now),
  ]);
  const briefText = formatTelegramDailyBrief(report, {
    reorderSoonCount: suggestions.length,
    topLabels: suggestions
      .slice(0, 3)
      .map((s) => `${s.garmentName} (${s.variantLabel})`),
    overduePoCount: overdue.length,
  });

  const pushParts = [
    `${report.combined.missingNowCount} missing`,
    `${report.combined.overdueRtsCount} overdue`,
    `${report.combined.physicallyArrivedCount} arrived today`,
    ...(suggestions.length > 0 ? [`${suggestions.length} reorder soon`] : []),
    ...(overdue.length > 0 ? [`${overdue.length} overdue PO`] : []),
  ];

  const [telegramOk, pushRes] = await Promise.all([
    hasTelegram && settings.telegramChatId ? sendTelegramMessage(settings.telegramChatId, briefText) : Promise.resolve(false),
    hasPush
      ? sendOwnerPush({
          title: `Daily summary (${report.rangeLabel})`,
          body: pushParts.join(" · "),
          url: "/",
          tag: "kyna-brief",
        })
      : Promise.resolve({ sent: 0, failed: 0, pruned: 0 }),
  ]);

  return telegramOk || pushRes.sent > 0;
}
