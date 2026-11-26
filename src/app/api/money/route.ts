import { NextRequest, NextResponse } from "next/server";
import { MoneyKind, Platform } from "@prisma/client";
import { getOwnerSession } from "@/lib/auth";
import { getMoneyBreakdown, moneyRowsToCsv } from "@/lib/money/breakdown";
import { getManilaDateRangeBounds, getManilaDayBounds, getManilaTodayStr } from "@/lib/time";

const KINDS = new Set<string>(Object.values(MoneyKind));
const PLATFORMS = new Set<string>(Object.values(Platform));

/**
 * Wallet rows behind the Home "Money credited" card.
 * ?range=today|yesterday|7days|30days or ?date=YYYY-MM-DD or ?from&to,
 * optional ?kind=CREDIT|ADS|… ?platform=SHOPEE|TIKTOK, ?format=csv for a download.
 */
export async function GET(req: NextRequest) {
  if (!(await getOwnerSession())) {
    return NextResponse.json({ error: "Owner sign-in required." }, { status: 401 });
  }
  try {
    const sp = req.nextUrl.searchParams;
    const bounds = getManilaDateRangeBounds({
      range: sp.get("range") ?? "today",
      date: sp.get("date"),
      from: sp.get("from"),
      to: sp.get("to"),
    });
    const today = getManilaDayBounds(getManilaTodayStr());
    const start = bounds?.start ?? today.start;
    const end = bounds?.end ?? today.end;
    const kindRaw = sp.get("kind");
    const platformRaw = sp.get("platform");
    const kind = kindRaw && KINDS.has(kindRaw) ? (kindRaw as MoneyKind) : null;
    const platform = platformRaw && PLATFORMS.has(platformRaw) ? (platformRaw as Platform) : null;
    const csv = sp.get("format") === "csv";
    const offset = Math.max(0, Math.floor(Number(sp.get("offset")) || 0));

    const data = await getMoneyBreakdown({
      start,
      end,
      kind,
      platform,
      limit: csv ? 5000 : 100,
      offset: csv ? 0 : offset,
    });

    if (csv) {
      const name = `money-${start.toISOString().slice(0, 10)}-to-${new Date(end.getTime() - 1)
        .toISOString()
        .slice(0, 10)}.csv`;
      return new NextResponse(moneyRowsToCsv(data.rows), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${name}"`,
          "Cache-Control": "no-store",
        },
      });
    }
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[Money API error]", err);
    return NextResponse.json({ error: "Could not load money details." }, { status: 500 });
  }
}
