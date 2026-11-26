import { NextRequest, NextResponse } from "next/server";
import { getOwnerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getProfitReport, parseMonth } from "@/lib/finance/report";
import { MONTH_CSV_HEADER, ORDER_CSV_HEADER, manilaStamp, toCsv } from "@/lib/finance/csv";
import { getRealShopWhere } from "@/lib/shops";

/**
 * Owner's profit for one Manila month (?month=YYYY-MM, default this month).
 * ?format=csv downloads it for the bookkeeper: one row per order while the
 * month's orders are still kept, otherwise one row per shop.
 */
export async function GET(req: NextRequest) {
  if (!(await getOwnerSession())) {
    return NextResponse.json({ error: "Owner sign-in required." }, { status: 401 });
  }
  try {
    const sp = req.nextUrl.searchParams;
    const month = parseMonth(sp.get("month"));
    const shops = await prisma.shopConnection.findMany({ select: { id: true, shopName: true, platform: true } });
    const shopName = new Map(shops.map((s) => [s.id, `${s.platform === "SHOPEE" ? "Shopee" : "TikTok"} · ${s.shopName}`]));

    if (sp.get("format") === "csv") {
      const n = (v: unknown) => Number(v ?? 0);
      // Same rule as the screen: demo shops are left out once a real shop is connected.
      const realOnly = await getRealShopWhere();
      const orders = await prisma.orderFinance.findMany({
        where: { month, ...realOnly },
        orderBy: { settledAt: "asc" },
        take: 100_000,
      });
      const csv = orders.length
        ? toCsv(
            ORDER_CSV_HEADER,
            orders.map((o) => [
              manilaStamp(o.settledAt),
              shopName.get(o.shopConnectionId) ?? o.platform,
              o.orderSn,
              o.pieces,
              o.piecesBackGood,
              n(o.buyerPaidPhp),
              n(o.commissionPhp),
              n(o.serviceFeePhp),
              n(o.transactionFeePhp),
              n(o.affiliatePhp),
              n(o.shippingPhp),
              n(o.withholdingTaxPhp),
              n(o.otherPhp),
              n(o.netPayoutPhp),
              n(o.costPhp),
              n(o.profitPhp),
            ])
          )
        : toCsv(
            MONTH_CSV_HEADER,
            (await prisma.financeMonth.findMany({ where: { month, ...realOnly } })).map((m) => [
              month,
              shopName.get(m.shopConnectionId) ?? m.platform,
              m.orders,
              m.pieces,
              m.piecesBackGood,
              n(m.buyerPaidPhp),
              n(m.commissionPhp),
              n(m.serviceFeePhp),
              n(m.transactionFeePhp),
              n(m.affiliatePhp),
              n(m.shippingPhp),
              n(m.withholdingTaxPhp),
              n(m.otherPhp),
              n(m.netPayoutPhp),
              n(m.costPhp),
              n(m.profitPhp),
            ])
          );
      return new NextResponse(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="kyna-profit-${month}.csv"`,
          "Cache-Control": "no-store",
        },
      });
    }

    const report = await getProfitReport(month);
    return NextResponse.json({
      ...report,
      byShop: report.byShop.map((s) => ({ ...s, shopName: shopName.get(s.shopConnectionId) ?? s.platform })),
    });
  } catch (err) {
    console.error("[Profit API error]", err);
    return NextResponse.json({ error: "Could not load profit." }, { status: 500 });
  }
}
