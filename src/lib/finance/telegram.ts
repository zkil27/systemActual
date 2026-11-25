import type { ProfitReport } from "./report";

const peso = (n: number) => `${n < 0 ? "-" : ""}PHP ${Math.abs(Math.round(n)).toLocaleString("en-PH")}`;

/** /profit reply. Pure. */
export function formatProfitTelegram(r: ProfitReport): string {
  const t = r.totals;
  const [y, m] = r.month.split("-").map(Number);
  const label = new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("en-PH", { month: "long", year: "numeric", timeZone: "UTC" });
  if (t.orders === 0) {
    return [`PROFIT — ${label}`, `No paid orders yet. Profit shows once a completed order is paid out.`].join("\n");
  }
  const took = Math.max(0, t.buyerPaidPhp - t.netPayoutPhp);
  const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : "-");
  const lines = [
    `PROFIT — ${label} (by payout date)`,
    `• Profit: ${peso(t.profitPhp)} (margin ${pct(t.profitPhp, t.netPayoutPhp)})`,
    `• Buyers paid: ${peso(t.buyerPaidPhp)}`,
    `• Shops took: ${peso(took)} (${pct(took, t.buyerPaidPhp)})`,
    `• Paid to you: ${peso(t.netPayoutPhp)}`,
    `• Cost of goods: ${peso(t.costPhp)}`,
    `• ${t.orders} paid orders, ${t.pieces} pcs`,
  ];
  if (r.bestItems[0]) lines.push(`• Earns the most: ${r.bestItems[0].name} (${peso(r.bestItems[0].profitPhp)})`);
  if (r.waitingCount > 0) lines.push(`• Waiting for payout details: ${r.waitingCount} orders`);
  return lines.join("\n");
}
