/** Filters on the Returns page. Ids match the /api/returns `filter` param. */
export const RETURN_FILTERS = [
  { id: "all", label: "All" },
  { id: "returned", label: "Returned to seller" },
  { id: "arrived", label: "Arrived" },
  { id: "missing", label: "Missing" },
  { id: "failed", label: "Failed delivery" },
  { id: "refund", label: "Buyer return" },
  { id: "issues", label: "Damaged" },
  { id: "overdue", label: "Overdue" },
  { id: "urgent", label: "Dispute due" },
  { id: "disputes", label: "Disputes filed" },
] as const;

export type ReturnFilter = (typeof RETURN_FILTERS)[number]["id"];

export const RETURN_DATE_PRESETS = [
  { id: "all", label: "All dates" },
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "7days", label: "7 days" },
  { id: "30days", label: "30 days" },
] as const;

export type ReturnDatePreset = (typeof RETURN_DATE_PRESETS)[number]["id"];

export interface ReturnDateFilter {
  range: ReturnDatePreset;
  date: string;
  from: string;
  to: string;
}

export const EMPTY_DATE_FILTER: ReturnDateFilter = {
  range: "all",
  date: "",
  from: "",
  to: "",
};

const IDS = new Set<string>(RETURN_FILTERS.map((f) => f.id));
const DATE_PRESET_IDS = new Set<string>(RETURN_DATE_PRESETS.map((d) => d.id));
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Unknown or missing values fall back to "all" instead of an empty list. */
export function parseReturnFilter(value: string | null | undefined): ReturnFilter {
  return value && IDS.has(value) ? (value as ReturnFilter) : "all";
}

export function parseReturnDatePreset(value: string | null | undefined): ReturnDatePreset {
  return value && DATE_PRESET_IDS.has(value) ? (value as ReturnDatePreset) : "all";
}

export function parseYmdParam(value: string | null | undefined): string {
  return value && YMD_RE.test(value) ? value : "";
}

export function parseReturnDateFilter(params: {
  get(key: string): string | null;
}): ReturnDateFilter {
  const date = parseYmdParam(params.get("date"));
  const from = parseYmdParam(params.get("from"));
  const to = parseYmdParam(params.get("to"));
  if (date) return { range: "all", date, from: "", to: "" };
  if (from || to) return { range: "all", date: "", from, to };
  return { range: parseReturnDatePreset(params.get("range")), date: "", from: "", to: "" };
}

export function hasActiveDateFilter(df: ReturnDateFilter): boolean {
  return Boolean(df.date || df.from || df.to || df.range !== "all");
}

export function returnsUrl(filter: ReturnFilter, dateFilter?: Partial<ReturnDateFilter>): string {
  const sp = new URLSearchParams();
  if (filter !== "all") sp.set("filter", filter);
  if (dateFilter?.date && YMD_RE.test(dateFilter.date)) {
    sp.set("date", dateFilter.date);
  } else if (dateFilter?.from || dateFilter?.to) {
    if (dateFilter.from && YMD_RE.test(dateFilter.from)) sp.set("from", dateFilter.from);
    if (dateFilter.to && YMD_RE.test(dateFilter.to)) sp.set("to", dateFilter.to);
  } else if (dateFilter?.range && dateFilter.range !== "all") {
    sp.set("range", dateFilter.range);
  }
  const qs = sp.toString();
  return qs ? `/returns?${qs}` : "/returns";
}
