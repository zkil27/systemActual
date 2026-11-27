import { NextRequest, NextResponse } from "next/server";
import { getOwnerSession } from "@/lib/auth";
import { getCreateItemBootstrap, searchShopCategories } from "@/lib/listings/create-service";

export const dynamic = "force-dynamic";

/**
 * GET /api/listings/categories
 * - No `shopId`: returns connected shops, 1-tap category presets, and Settings defaults.
 * - `?shopId=...&q=...`: returns up to 30 matching leaf categories from that shop.
 */
export async function GET(req: NextRequest) {
  if (!(await getOwnerSession())) {
    return NextResponse.json({ error: "Owner sign-in required." }, { status: 401 });
  }
  const shopId = req.nextUrl.searchParams.get("shopId")?.trim();
  const q = req.nextUrl.searchParams.get("q") ?? "";

  try {
    if (shopId) {
      const categories = await searchShopCategories(shopId, q);
      return NextResponse.json({ categories });
    }
    const bootstrap = await getCreateItemBootstrap();
    return NextResponse.json(bootstrap);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Couldn't load categories.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
