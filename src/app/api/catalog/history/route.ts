import { NextRequest, NextResponse } from "next/server";
import { StockReason } from "@prisma/client";
import { getOwnerSession } from "@/lib/auth";
import { getStockHistory } from "@/lib/stock/history";

const REASONS = new Set<string>(Object.values(StockReason));

/**
 * Stock movements, newest first: one variant (?variantId=, with running
 * balance), one garment (?garmentId=), or the recent activity feed (neither).
 * Page with ?before=<ISO createdAt of the last row>.
 */
export async function GET(req: NextRequest) {
  if (!(await getOwnerSession())) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const sp = req.nextUrl.searchParams;
  const beforeRaw = sp.get("before");
  const before = beforeRaw && !Number.isNaN(Date.parse(beforeRaw)) ? new Date(beforeRaw) : null;
  const reasons = (sp.get("reason") ?? "")
    .split(",")
    .filter((r) => REASONS.has(r)) as StockReason[];
  try {
    const data = await getStockHistory({
      variantId: sp.get("variantId"),
      garmentId: sp.get("garmentId"),
      reasons,
      before,
      limit: Number(sp.get("limit")) || 50,
    });
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[catalog history]", err);
    return NextResponse.json({ error: "Could not load stock history." }, { status: 500 });
  }
}
