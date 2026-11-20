import { DailyTruthReport } from "@/lib/analytics/daily-returns";

export function formatTelegramDailyBrief(report: DailyTruthReport): string {
  const fd = report.failedDelivery;
  const rr = report.returnRefund;
  const c = report.combined;

  const lines: string[] = [
    `KYNA OPS — DAILY RETURN SUMMARY`,
    `${report.rangeLabel} (Manila Time)`,
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
