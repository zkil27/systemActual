import { prisma } from "@/lib/prisma";
import { getDailyTruthReport } from "@/lib/analytics/daily-returns";
import { getManilaDateString } from "@/lib/time";
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
  if (!settings?.telegramChatId) return false;
  if (!isBriefDue(now, settings.telegramDailyBriefUtc, settings.dailyBriefSentOn)) return false;

  const today = getManilaDateString(now);
  // Claim today's brief first, so two ticks can't both send it.
  const claimed = await prisma.appSettings.updateMany({
    where: { id: "default", OR: [{ dailyBriefSentOn: null }, { dailyBriefSentOn: { not: today } }] },
    data: { dailyBriefSentOn: today },
  });
  if (claimed.count !== 1) return false;

  const report = await getDailyTruthReport({ range: "today" });
  return sendTelegramMessage(settings.telegramChatId, formatTelegramDailyBrief(report));
}
