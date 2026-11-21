import { DailyTruthReport } from "@/lib/analytics/daily-returns";

export function formatTelegramDailyBrief(report: DailyTruthReport): string {
  const fd = report.failedDelivery;
  const rr = report.returnRefund;
  const c = report.combined;

  const m = report.money;
  const peso = (n: number) => `PHP ${Math.round(n).toLocaleString("en-PH")}`;
  const signed = (n: number) => (Math.round(n) < 0 ? `-${peso(-n)}` : peso(n));

  const lines: string[] = [
    `KYNA OPS — DAILY SUMMARY`,
    `${report.rangeLabel} (Manila Time)`,
    ``,
    `MONEY CREDITED: ${peso(m.creditedPhp)}`,
    `• Shopee: ${peso(m.creditedShopeePhp)} | TikTok: ${peso(m.creditedTikTokPhp)}`,
    ...(m.adsPhp || m.adjustmentsPhp
      ? [`• Ads: ${signed(m.adsPhp)} | Adjustments: ${signed(m.adjustmentsPhp)}`]
      : []),
    `• Orders placed (not yet money): ${m.ordersPlacedCount} — ${peso(m.ordersPlacedPhp)}`,
    ``,
    `FAILED DELIVERY (Undelivered / COD)`,
    `• Driver Tagged Today: ${fd.taggedCount} (${fd.taggedPieces} pcs)`,
    `• Driver Says Returned: ${fd.courierReturnedCount}`,
    `• Actually Arrived at Warehouse: ${fd.physicallyArrivedCount}`,
    ``,
    `BUYER RETURN / REFUND`,
    `• Requested Today: ${rr.taggedCount} (${rr.taggedPieces} pcs)`,
    `• Driver Says Returned: ${rr.courierReturnedCount}`,
    `• Actually Arrived at Warehouse: ${rr.physicallyArrivedCount}`,
    ``,
    `ALERTS & CHECKS`,
    c.missingNowCount > 0
      ? `• MISSING PARCELS: ${c.missingNowCount} (Driver marked returned, not scanned yet — est. PHP ${c.missingNowCostPhp.toLocaleString("en-PH")})`
      : `• Missing Parcels: 0 (All clear!)`,
    `• Overdue In-Transit (> ${report.overdueRtsDays} days): ${c.overdueRtsCount}`,
    `• Dispute Deadlines < 24h: ${c.urgentDeadlineCount}`,
  ];

  if (fd.byCourier.length > 0) {
    lines.push(``);
    lines.push(`FAILED DELIVERY BY COURIER`);
    for (const row of fd.byCourier) {
      lines.push(
        `• ${row.courier}: ${row.tagged} tagged | ${row.arrived} arrived | ${row.missing} missing`
      );
    }
  }

  lines.push(``);
  lines.push(`Commands: /today  /failed  /returns  /missing  /overdue`);
  return lines.join("\n");
}
