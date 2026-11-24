/**
 * Each AI service resets its free daily limits on its own clock (UTC or US
 * Pacific). These helpers find the service's day and how much of its daily
 * allowance may be used right now.
 */

export type DayZone = "UTC" | "America/Los_Angeles";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
/** 6 PM in Manila (UTC+8, no daylight saving) is 10:00 UTC. */
const EVENING_UTC_HOUR = 10;

function parts(zone: DayZone, at: Date) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const p = Object.fromEntries(f.formatToParts(at).map((x) => [x.type, x.value]));
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), h: Number(p.hour), min: Number(p.minute), s: Number(p.second) };
}

/** Zone offset from UTC at an instant, in ms (Pacific: -7h or -8h). */
function offsetMs(zone: DayZone, at: Date): number {
  if (zone === "UTC") return 0;
  const p = parts(zone, at);
  const wall = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s);
  return wall - Math.floor(at.getTime() / 1000) * 1000;
}

/** "YYYY-MM-DD" of the service's current day. */
export function providerDayKey(zone: DayZone, now: Date = new Date()): string {
  const p = parts(zone, now);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

/** [start, end) of the service's current day. */
export function providerDayBounds(zone: DayZone, now: Date = new Date()): { start: Date; end: Date } {
  const p = parts(zone, now);
  const midnightWall = Date.UTC(p.y, p.m - 1, p.d);
  const start = midnightWall - offsetMs(zone, new Date(midnightWall - offsetMs(zone, now)));
  const nextWall = midnightWall + DAY;
  const end = nextWall - offsetMs(zone, new Date(nextWall - offsetMs(zone, now)));
  return { start: new Date(start), end: new Date(end) };
}

/** First 6 PM Manila at or after the start of the service's day. */
export function eveningStart(zone: DayZone, now: Date = new Date()): Date {
  const { start } = providerDayBounds(zone, now);
  const d = new Date(start);
  let e = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), EVENING_UTC_HOUR);
  if (e < start.getTime()) e += DAY;
  return new Date(e);
}

/**
 * Share of a daily limit usable now. Until 6 PM Manila in the service's day,
 * the evening reserve is held back so evening and night buyers still get answers.
 */
export function allowanceShare(zone: DayZone, reservePct: number, now: Date = new Date()): number {
  const pct = Math.min(60, Math.max(0, Math.round(reservePct)));
  if (now.getTime() >= eveningStart(zone, now).getTime()) return 1;
  return 1 - pct / 100;
}

/** A daily cap scaled by the allowance, never below 1 when the cap is above 0. */
export function pacedCap(cap: number, share: number): number {
  if (cap <= 0) return 0;
  return Math.max(1, Math.floor(cap * share));
}
