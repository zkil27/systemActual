/** Filters on the Returns page. Ids match the /api/returns `filter` param. */
export const RETURN_FILTERS = [
  { id: "all", label: "All" },
  { id: "missing", label: "Missing" },
  { id: "failed", label: "Failed delivery" },
  { id: "refund", label: "Buyer return" },
  { id: "issues", label: "Damaged" },
  { id: "overdue", label: "Overdue" },
] as const;

export type ReturnFilter = (typeof RETURN_FILTERS)[number]["id"];

const IDS = new Set<string>(RETURN_FILTERS.map((f) => f.id));

/** Unknown or missing values fall back to "all" instead of an empty list. */
export function parseReturnFilter(value: string | null | undefined): ReturnFilter {
  return value && IDS.has(value) ? (value as ReturnFilter) : "all";
}

export function returnsUrl(filter: ReturnFilter): string {
  return filter === "all" ? "/returns" : `/returns?filter=${filter}`;
}
