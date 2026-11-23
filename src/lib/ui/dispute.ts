/** Dispute lifecycle words and the deadline countdown shared by the parcel sheet and lists. */
export type DisputeStatusId = "NONE" | "FILED" | "WON" | "LOST";

export const DISPUTE_STATUSES: ReadonlyArray<{
  id: DisputeStatusId;
  label: string;
  toast: string;
  activeClass: string;
}> = [
  { id: "NONE", label: "Not filed", toast: "Dispute cleared", activeClass: "bg-ink text-ink-inverse" },
  { id: "FILED", label: "Filed", toast: "Marked filed", activeClass: "bg-brand-solid text-on-brand" },
  { id: "WON", label: "Won", toast: "Marked won", activeClass: "bg-arrived text-white" },
  { id: "LOST", label: "Lost", toast: "Marked lost", activeClass: "bg-missing-solid text-white" },
];

export function disputeLabel(id: string | null | undefined): string | null {
  if (!id || id === "NONE") return null;
  return DISPUTE_STATUSES.find((d) => d.id === id)?.label ?? null;
}

/**
 * "Dispute due in 5h 20m" (urgent under 24h), "Dispute due in 3 days", or
 * "Dispute deadline passed 2h ago". Null when there's no deadline.
 */
export function deadlineCountdown(
  iso: string | null | undefined,
  now: number = Date.now()
): { label: string; tone: "urgent" | "soon" | "past" } | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  const diff = t - now;
  const abs = Math.abs(diff);
  const mins = Math.floor(abs / 60_000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  const span =
    days >= 2 ? `${days} days` : hours >= 1 ? `${hours}h ${mins % 60}m` : `${Math.max(1, mins)}m`;
  if (diff < 0) return { label: `Dispute deadline passed ${span} ago`, tone: "past" };
  return { label: `Dispute due in ${span}`, tone: hours < 24 ? "urgent" : "soon" };
}

export function eventSourceLabel(source: string): string {
  const s = source.toUpperCase();
  if (s === "OWNER") return "You";
  if (s.includes("TRACK") || s.includes("LOGISTIC") || s.includes("COURIER")) return "Courier";
  if (s.startsWith("SHOPEE")) return "Shopee";
  if (s.startsWith("TIKTOK")) return "TikTok Shop";
  if (s.includes("SCAN") || s.includes("STAFF")) return "Warehouse";
  return source.replace(/_/g, " ").toLowerCase();
}

export function humanizeStatus(raw: string): string {
  const s = raw.replace(/_/g, " ").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
