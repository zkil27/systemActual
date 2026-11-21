const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;

export function getManilaDateString(date: Date = new Date()): string {
  const shifted = new Date(date.getTime() + MANILA_OFFSET_MS);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shifted.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getManilaTodayStr(): string {
  return getManilaDateString(new Date());
}

export function shiftManilaDateString(dateStr: string, deltaDays: number): string {
  const { start } = getManilaDayBounds(dateStr);
  const moved = new Date(start.getTime() + deltaDays * 24 * 60 * 60 * 1000);
  return getManilaDateString(moved);
}

/**
 * Returns exact UTC [start, end) boundaries for a calendar day in Asia/Manila (UTC+8).
 * Example: "2026-11-20" -> start = 2026-11-19T16:00:00.000Z, end = 2026-11-20T16:00:00.000Z
 */
export function getManilaDayBounds(dateStr?: string): {
  dateStr: string;
  start: Date;
  end: Date;
} {
  const target =
    dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? dateStr : getManilaTodayStr();
  const [y, m, d] = target.split("-").map(Number);
  const startUtcMs = Date.UTC(y, m - 1, d, 0, 0, 0, 0) - MANILA_OFFSET_MS;
  const endUtcMs = startUtcMs + 24 * 60 * 60 * 1000;
  return {
    dateStr: target,
    start: new Date(startUtcMs),
    end: new Date(endUtcMs),
  };
}

export function getManilaRangeBounds(
  range: "today" | "yesterday" | "7days",
  customDate?: string
): {
  label: string;
  dateStr: string;
  start: Date;
  end: Date;
} {
  if (customDate && /^\d{4}-\d{2}-\d{2}$/.test(customDate)) {
    const bounds = getManilaDayBounds(customDate);
    return { ...bounds, label: formatManilaShortDate(bounds.start) };
  }
  const todayStr = getManilaTodayStr();
  if (range === "yesterday") {
    const yStr = shiftManilaDateString(todayStr, -1);
    const bounds = getManilaDayBounds(yStr);
    return { ...bounds, label: `Yesterday • ${formatManilaShortDate(bounds.start)}` };
  }
  if (range === "7days") {
    const todayBounds = getManilaDayBounds(todayStr);
    const startStr = shiftManilaDateString(todayStr, -6);
    const startBounds = getManilaDayBounds(startStr);
    return {
      dateStr: todayStr,
      start: startBounds.start,
      end: todayBounds.end,
      label: "Last 7 Days",
    };
  }
  const bounds = getManilaDayBounds(todayStr);
  return { ...bounds, label: `Today • ${formatManilaShortDate(bounds.start)}` };
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Exact UTC bounds for a Manila calendar preset (`today`, `yesterday`, `7days`, `30days`),
 * a single `date` (`YYYY-MM-DD`), or an inclusive `[from, to]` Manila date range.
 * Returns null when no date filter applies.
 */
export function getManilaDateRangeBounds(opts: {
  range?: string | null;
  date?: string | null;
  from?: string | null;
  to?: string | null;
  now?: Date;
}): { start?: Date; end?: Date } | null {
  const date = opts.date && YMD_RE.test(opts.date) ? opts.date : null;
  if (date) {
    const { start, end } = getManilaDayBounds(date);
    return { start, end };
  }

  let from = opts.from && YMD_RE.test(opts.from) ? opts.from : null;
  let to = opts.to && YMD_RE.test(opts.to) ? opts.to : null;
  if (from || to) {
    if (from && to && from > to) [from, to] = [to, from];
    return {
      ...(from ? { start: getManilaDayBounds(from).start } : {}),
      ...(to ? { end: getManilaDayBounds(to).end } : {}),
    };
  }

  const todayStr = getManilaDateString(opts.now ?? new Date());
  const todayBounds = getManilaDayBounds(todayStr);
  switch (opts.range) {
    case "today":
      return { start: todayBounds.start, end: todayBounds.end };
    case "yesterday": {
      const y = getManilaDayBounds(shiftManilaDateString(todayStr, -1));
      return { start: y.start, end: y.end };
    }
    case "7days":
      return {
        start: getManilaDayBounds(shiftManilaDateString(todayStr, -6)).start,
        end: todayBounds.end,
      };
    case "30days":
      return {
        start: getManilaDayBounds(shiftManilaDateString(todayStr, -29)).start,
        end: todayBounds.end,
      };
    default:
      return null;
  }
}

export function isWithinBounds(
  value: Date | null | undefined,
  start: Date,
  end: Date
): boolean {
  if (!value) return false;
  const t = value.getTime();
  return t >= start.getTime() && t < end.getTime();
}

export function formatManilaShortDate(date: Date): string {
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
  }).format(date);
}

export function formatManilaTime(date: Date | null | undefined): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

export function formatManilaDateTime(date: Date | null | undefined): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

export function daysSince(date: Date | null | undefined, now: Date = new Date()): number {
  if (!date) return 0;
  return Math.max(0, Math.floor((now.getTime() - date.getTime()) / (24 * 60 * 60 * 1000)));
}
