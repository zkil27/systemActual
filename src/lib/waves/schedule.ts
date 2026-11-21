import { getManilaDateString } from "@/lib/time";

const MANILA_OFFSET_MS = 8 * 3600_000;
/**
 * A slot can still start this long after its time (the PC was off at 8:30
 * and came on at 9:15). Older missed slots are skipped, never stacked up.
 */
export const SLOT_WINDOW_MS = 2 * 3600_000;
export const CONTINUOUS_TOKEN = "CONTINUOUS";
export const CONTINUOUS_INTERVAL_MIN = 15;

export function isContinuousWave(raw: string): boolean {
  return raw
    .split(",")
    .map((t) => t.trim().toUpperCase())
    .includes(CONTINUOUS_TOKEN);
}

/** "08:30, 12:30,15:30" → ["08:30","12:30","15:30"]; invalid entries dropped, sorted, max 8. */
export function parseWaveTimes(raw: string): string[] {
  const times = raw
    .split(",")
    .map((t) => t.trim())
    .filter((t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t));
  return [...new Set(times)].sort().slice(0, 8);
}

export function formatWaveScheduleSetting(times: string[], continuous: boolean): string {
  const valid = parseWaveTimes(times.join(","));
  return continuous ? [CONTINUOUS_TOKEN, ...valid].join(",") : valid.join(",");
}

const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

function manilaMinutes(now: Date) {
  const m = new Date(now.getTime() + MANILA_OFFSET_MS);
  return m.getUTCHours() * 60 + m.getUTCMinutes();
}

/**
 * The slot that should run now ("2026-11-21 08:30"), or null.
 * Only the latest passed slot within the window, and only once.
 * In continuous mode, triggers once per 15-minute Manila bucket.
 */
export function dueWaveSlot(now: Date, times: string[], lastSlot: string | null, continuous = false): string | null {
  const nowMin = manilaMinutes(now);
  if (continuous) {
    const bucketMin = Math.floor(nowMin / CONTINUOUS_INTERVAL_MIN) * CONTINUOUS_INTERVAL_MIN;
    const hh = String(Math.floor(bucketMin / 60)).padStart(2, "0");
    const mm = String(bucketMin % 60).padStart(2, "0");
    const slot = `${getManilaDateString(now)} C:${hh}:${mm}`;
    return slot === lastSlot ? null : slot;
  }
  const windowMin = SLOT_WINDOW_MS / 60_000;
  const passed = times.filter((t) => nowMin >= minutesOf(t) && nowMin - minutesOf(t) < windowMin);
  if (!passed.length) return null;
  const slot = `${getManilaDateString(now)} ${passed[passed.length - 1]}`;
  return slot === lastSlot ? null : slot;
}

/** When the next wave will start (for the phone), as a Date. */
export function nextWaveAt(now: Date, times: string[], continuous = false): Date | null {
  const nowMin = manilaMinutes(now);
  const today = getManilaDateString(now);
  const startOfManilaDay = new Date(`${today}T00:00:00+08:00`).getTime();
  if (continuous) {
    const nextBucketMin = (Math.floor(nowMin / CONTINUOUS_INTERVAL_MIN) + 1) * CONTINUOUS_INTERVAL_MIN;
    return new Date(startOfManilaDay + nextBucketMin * 60_000);
  }
  if (!times.length) return null;
  const next = times.find((t) => minutesOf(t) > nowMin);
  return next
    ? new Date(startOfManilaDay + minutesOf(next) * 60_000)
    : new Date(startOfManilaDay + 24 * 3600_000 + minutesOf(times[0]) * 60_000);
}

/**
 * Retrying a failed parcel always restarts at READY, so the engine re-checks
 * the order first and works out the right step itself:
 *  - it may have shipped (still locked): keep "we asked" → arranged orders go on to the label
 *  - the shop clearly said no (released): clear "we asked" and lock it again
 */
export function retryUpdate(item: { activePackageId: string | null; packageId: string }) {
  const released = item.activePackageId === null;
  return {
    status: "READY" as const,
    attempts: 0,
    error: null,
    nextAttemptAt: null,
    docRequestedAt: null,
    ...(released ? { shipRequestedAt: null, activePackageId: item.packageId } : {}),
  };
}
