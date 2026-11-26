import { NextRequest, NextResponse } from "next/server";
import { getOwnerSession } from "@/lib/auth";
import { lookupOrders, MIN_QUERY_LENGTH } from "@/lib/orders/lookup";

/** Owner order search: ?q=<order #, tracking #, item name>&courier=<optional>. */
export async function GET(req: NextRequest) {
  if (!(await getOwnerSession())) {
    return NextResponse.json({ error: "Owner sign-in required." }, { status: 401 });
  }
  const sp = req.nextUrl.searchParams;
  const q = (sp.get("q") ?? "").trim().slice(0, 80);
  if (q.length < MIN_QUERY_LENGTH) {
    return NextResponse.json(
      { error: `Type at least ${MIN_QUERY_LENGTH} characters.`, orders: [], returnsOnly: [] },
      { status: 400 }
    );
  }
  try {
    const data = await lookupOrders(q, { courier: sp.get("courier") });
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[Orders lookup error]", err);
    return NextResponse.json({ error: "Could not search orders." }, { status: 500 });
  }
}
