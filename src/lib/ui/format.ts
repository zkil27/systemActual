/** Tab-bar badge text. Keeps the badge narrow on busy sale days. */
export function formatBadgeCount(count: number): string | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  return count > 99 ? "99+" : String(Math.floor(count));
}

export function formatPeso(amount: number): string {
  return `₱${Math.round(amount).toLocaleString("en-PH")}`;
}

/** "−₱1,200" for money out, "₱350" for money in. */
export function formatSignedPeso(amount: number): string {
  const rounded = Math.round(amount);
  return rounded < 0 ? `−${formatPeso(-rounded)}` : formatPeso(rounded);
}

export function shortCourier(courier: string): string {
  return courier.replace(/\s*Express$/i, "");
}

const timeFmt = new Intl.DateTimeFormat("en-PH", {
  timeZone: "Asia/Manila",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

const dateTimeFmt = new Intl.DateTimeFormat("en-PH", {
  timeZone: "Asia/Manila",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

const dayFmt = new Intl.DateTimeFormat("en-PH", {
  timeZone: "Asia/Manila",
  month: "short",
  day: "numeric",
});

export function manilaTime(iso: string | null): string {
  return iso ? timeFmt.format(new Date(iso)) : "";
}

export function manilaDateTime(iso: string | null): string {
  return iso ? dateTimeFmt.format(new Date(iso)) : "";
}

/** "2026-11-18" (a Manila calendar date) → "Nov 18". */
export function manilaDayLabel(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  // Noon UTC+8 keeps the label on the same calendar day in any timezone.
  return dayFmt.format(new Date(Date.UTC(y, m - 1, d, 4)));
}

/** "just now", "4 min ago", "2 hr ago", else the Manila date and time. */
export function updatedAgo(iso: string | null, now: number = Date.now()): string {
  if (!iso) return "";
  const mins = Math.floor((now - new Date(iso).getTime()) / 60_000);
  if (Number.isNaN(mins)) return "";
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 24 * 60) return `${Math.floor(mins / 60)} hr ago`;
  return manilaDateTime(iso);
}
