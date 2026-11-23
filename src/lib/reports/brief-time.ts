/** The daily brief time is stored in UTC ("12:00"); the owner picks it in Manila time ("20:00"). */
const MANILA_OFFSET_MIN = 8 * 60;

function parseHm(hm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

function formatHm(totalMin: number): string {
  const t = ((totalMin % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

export function manilaToUtcHm(manila: string): string {
  const m = parseHm(manila);
  return formatHm((m ?? 20 * 60) - MANILA_OFFSET_MIN);
}

export function utcToManilaHm(utc: string): string {
  const m = parseHm(utc);
  return formatHm((m ?? 12 * 60) + MANILA_OFFSET_MIN);
}
