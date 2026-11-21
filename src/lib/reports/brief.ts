import { DailyTruthReport } from "@/lib/analytics/daily-returns";

export function formatTelegramDailyBrief(report: DailyTruthReport): string {
  const fd = report.failedDelivery;
  const rr = report.returnRefund;
  const c = report.combined;

  const m = report.money;
  const peso = (n: number) => `PHP ${Math.round(n).toLocaleString("en-PH")}`;
  const signed = (n: number) => (Math.round(n) < 0 ? `-${peso(-n)}` : peso(n));

  const ops = report.operations;

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
    `SHIPPING & STOCK`,
    `• Ready to ship: ${ops.readyToShipCount} (Shopee ${ops.readyShopeeCount} | TikTok ${ops.readyTikTokCount})`,
    `• Printed today: ${ops.printedTodayCount}${ops.waveNeedAttentionCount ? ` | Need attention: ${ops.waveNeedAttentionCount}` : ""}`,
    `• Stock: ${ops.outOfStockCount} out, ${ops.lowStockCount} low${ops.shopeeBumpEnabled ? ` | Auto-bump: ${ops.shopeeBoostedCount}/5` : ""}`,
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
  lines.push(`Commands: /today  /ship  /stock  /money  /bump  /missing`);
  return lines.join("\n");
}
