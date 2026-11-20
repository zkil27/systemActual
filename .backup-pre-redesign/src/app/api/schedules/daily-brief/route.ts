import { handleSchedule } from "@vercel/schedules";
import { getDailyTruthReport } from "@/lib/analytics/daily-returns";
import { formatTelegramDailyBrief } from "@/lib/reports/brief";
import { notifyOwnerTelegram } from "@/lib/telegram";

export const POST = handleSchedule(async (metadata) => {
  console.log(`[schedule:daily-brief] execution ${metadata.executionId}`);
  const report = await getDailyTruthReport({ range: "today" });
  const text = formatTelegramDailyBrief(report);
  await notifyOwnerTelegram(text);
});
