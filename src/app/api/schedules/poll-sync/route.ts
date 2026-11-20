import { handleSchedule } from "@vercel/schedules";
import { runTick } from "@/lib/worker/tick";

export const maxDuration = 60;

// Temporary safety net until the warehouse PC agent exists (Task 9), which
// then becomes the daytime clock and this schedule is removed.
export const POST = handleSchedule(async (metadata) => {
  console.log(`[schedule:poll-sync] execution ${metadata.executionId}`);
  await runTick("schedule");
});
