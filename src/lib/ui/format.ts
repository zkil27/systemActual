/** Tab-bar badge text. Keeps the badge narrow on busy sale days. */
export function formatBadgeCount(count: number): string | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  return count > 99 ? "99+" : String(Math.floor(count));
}

export function formatPeso(amount: number): string {
  return `₱${Math.round(amount).toLocaleString("en-PH")}`;
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
