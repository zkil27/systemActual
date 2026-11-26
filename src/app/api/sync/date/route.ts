import { NextRequest, NextResponse } from "next/server";
import { Platform } from "@prisma/client";
import { getOwnerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ensureFreshToken } from "@/lib/connectors/tokens";
import { syncOrdersWindow } from "@/lib/ledger/sync";
import { syncMoneyWindow } from "@/lib/money/sync";
import { detectFailedDeliveries, syncReturnsWindow } from "@/lib/returns/sync";
import { getManilaDayBounds } from "@/lib/time";

export const maxDuration = 120;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** On-demand sync for one Manila calendar day without moving live sync cursors. */
export async function POST(req: NextRequest) {
  if (!(await getOwnerSession())) {
    return NextResponse.json({ error: "Owner sign-in required." }, { status: 401 });
  }
  try {
    const body = (await req.json().catch(() => null)) as { date?: unknown } | null;
    const rawDate = typeof body?.date === "string" ? body.date.trim() : "";
    if (!DATE_RE.test(rawDate)) {
      return NextResponse.json({ error: "Provide date as YYYY-MM-DD." }, { status: 400 });
    }

    const { dateStr, start, end } = getManilaDayBounds(rawDate);
    const shops = await prisma.shopConnection.findMany({
      where: { isDemo: false, accessToken: { not: null } },
      orderBy: { platform: "asc" },
    });

    const deadline = Date.now() + 90_000;
    const results: Array<{
      shop: string;
      platform: Platform;
      ordersSaved: number;
      returnsSaved: number;
      failedDeliveriesFound: number;
      moneySaved: number;
      error?: string;
    }> = [];

    for (const conn of shops) {
      if (Date.now() >= deadline) break;
      if (conn.platform === Platform.TIKTOK && !conn.shopCipher) {
        results.push({
          shop: conn.shopName,
          platform: conn.platform,
          ordersSaved: 0,
          returnsSaved: 0,
          failedDeliveriesFound: 0,
          moneySaved: 0,
          error: "Reconnect TikTok (missing shop cipher)",
        });
        continue;
      }

      const row = {
        shop: conn.shopName,
        platform: conn.platform,
        ordersSaved: 0,
        returnsSaved: 0,
        failedDeliveriesFound: 0,
        moneySaved: 0,
      };
      try {
        const token = await ensureFreshToken(conn);
        row.ordersSaved = (await syncOrdersWindow(conn, token, start, end, deadline)).saved;
        row.returnsSaved = (await syncReturnsWindow(conn, token, start, end, deadline)).saved;
        row.failedDeliveriesFound = (await detectFailedDeliveries(conn, token, deadline)).created;
        try {
          row.moneySaved = (await syncMoneyWindow(conn, token, start, end, deadline)).saved;
        } catch (err) {
          console.error(`[sync/date] ${conn.shopName} money`, err);
        }
      } catch (err) {
        console.error(`[sync/date] ${conn.shopName}`, err);
        results.push({
          ...row,
          error: err instanceof Error ? err.message : String(err),
        });
        continue;
      }
      results.push(row);
    }

    const totalSynced = results.reduce(
      (n, r) => n + r.ordersSaved + r.returnsSaved + r.failedDeliveriesFound + r.moneySaved,
      0
    );

    return NextResponse.json({
      ok: true,
      date: dateStr,
      totalSynced,
      results,
    });
  } catch (err) {
    console.error("[Sync date error]", err);
    return NextResponse.json({ error: "Could not sync that date. Please try again." }, { status: 500 });
  }
}
