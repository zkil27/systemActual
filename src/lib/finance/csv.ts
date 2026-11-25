/** CSV for the bookkeeper. Excel opens it directly (UTF-8 with BOM, CRLF). */

export function csvCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "number" ? (Number.isInteger(v) ? String(v) : v.toFixed(2)) : v;
  // Quote when needed; a leading = + - @ is neutralised so Excel never runs it as a formula.
  const safe = /^[=+\-@]/.test(s) && typeof v !== "number" ? `'${s}` : s;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** "2026-11-19 14:00" in Manila time: sorts and filters cleanly in Excel, year included. */
export function manilaStamp(at: Date): string {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

export function toCsv(header: string[], rows: Array<Array<string | number | null | undefined>>): string {
  return "﻿" + [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export const ORDER_CSV_HEADER = [
  "Paid out (Manila)",
  "Shop",
  "Order",
  "Pieces",
  "Pieces back on shelf",
  "Buyer paid",
  "Commission",
  "Service fee",
  "Transaction fee",
  "Affiliate",
  "Shipping",
  "Tax withheld",
  "Other",
  "Net payout",
  "Cost of goods",
  "Profit",
];

export const MONTH_CSV_HEADER = [
  "Month",
  "Shop",
  "Orders",
  "Pieces",
  "Pieces back on shelf",
  "Buyer paid",
  "Commission",
  "Service fee",
  "Transaction fee",
  "Affiliate",
  "Shipping",
  "Tax withheld",
  "Other",
  "Net payout",
  "Cost of goods",
  "Profit",
];
