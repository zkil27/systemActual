import { getManilaDateString, getManilaDayBounds } from "@/lib/time";
import type { ChatPlatform, ChatUnread } from "./types";

const DAY_MS = 24 * 3600_000;

const timeFmt = new Intl.DateTimeFormat("en-PH", {
  timeZone: "Asia/Manila",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});
const weekdayFmt = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", weekday: "short" });
const monthDayFmt = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", month: "short", day: "numeric" });
const fullDayFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Manila",
  weekday: "short",
  month: "short",
  day: "numeric",
});
const yearDayFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Manila",
  month: "short",
  day: "numeric",
  year: "numeric",
});

/** Whole Manila calendar days between the message day and today (0 = today). */
function manilaDaysAgo(at: Date, now: Date): number {
  const today = getManilaDayBounds(getManilaDateString(now)).start.getTime();
  const day = getManilaDayBounds(getManilaDateString(at)).start.getTime();
  return Math.round((today - day) / DAY_MS);
}

export function chatClock(iso: string): string {
  return timeFmt.format(new Date(iso));
}

/** Chat list time: "2:14 PM", "Yesterday", "Mon", "Jun 3", or "Jun 3, 2025". */
export function chatListTime(iso: string, now: Date = new Date()): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const ago = manilaDaysAgo(at, now);
  if (ago <= 0) return timeFmt.format(at);
  if (ago === 1) return "Yesterday";
  if (ago < 7) return weekdayFmt.format(at);
  if (getManilaDateString(at).slice(0, 4) === getManilaDateString(now).slice(0, 4)) return monthDayFmt.format(at);
  return yearDayFmt.format(at);
}

/** Separator between message days: "Today", "Yesterday", "Mon, Nov 18". */
export function chatDayLabel(iso: string, now: Date = new Date()): string {
  const at = new Date(iso);
  const ago = manilaDaysAgo(at, now);
  if (ago <= 0) return "Today";
  if (ago === 1) return "Yesterday";
  if (getManilaDateString(at).slice(0, 4) === getManilaDateString(now).slice(0, 4)) return fullDayFmt.format(at);
  return yearDayFmt.format(at);
}

export type ThreadRow<T> = { type: "day"; key: string; label: string } | { type: "message"; key: string; message: T };

/** Messages with a day separator before the first message of each Manila day. */
export function withDaySeparators<T extends { id: string; sentAt: string }>(
  messages: T[],
  now: Date = new Date()
): ThreadRow<T>[] {
  const rows: ThreadRow<T>[] = [];
  let lastDay = "";
  for (const m of messages) {
    const day = getManilaDateString(new Date(m.sentAt));
    if (day !== lastDay) {
      rows.push({ type: "day", key: `day-${day}`, label: chatDayLabel(m.sentAt, now) });
      lastDay = day;
    }
    rows.push({ type: "message", key: m.id, message: m });
  }
  return rows;
}

/** `?shop=` in the URL. */
export function parseShopParam(value: string | null | undefined): ChatPlatform | null {
  const v = value?.trim().toLowerCase();
  if (v === "shopee") return "SHOPEE";
  if (v === "tiktok") return "TIKTOK";
  return null;
}

export function shopParam(platform: ChatPlatform): "shopee" | "tiktok" {
  return platform === "SHOPEE" ? "shopee" : "tiktok";
}

/** Open the shop with more unread chats; TikTok when it's a tie. */
export function defaultShop(unread: Pick<ChatUnread, "SHOPEE" | "TIKTOK"> | null): ChatPlatform {
  if (unread && unread.SHOPEE > unread.TIKTOK) return "SHOPEE";
  return "TIKTOK";
}

/** Both Shopee and TikTok Seller Chat are live now. */
export function chatsComingSoon(_platform: ChatPlatform): boolean {
  void _platform;
  return false;
}

export function platformName(platform: ChatPlatform): string {
  return platform === "SHOPEE" ? "Shopee" : "TikTok";
}
