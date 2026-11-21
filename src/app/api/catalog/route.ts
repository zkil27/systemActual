import { NextRequest, NextResponse, after } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getOwnerSession } from "@/lib/auth";
import {
  autoLinkAndInitCatalog,
  getCatalog,
  linkListings,
  mergeVariants,
  setStartingStock,
  unlinkGarment,
} from "@/lib/catalog/garments";
import { IMPORT_RUNNING } from "@/lib/catalog/import";
import { getShopeeBumpStatus, runShopeeBump, setShopeeBumpConfig } from "@/lib/catalog/shopee-bump";
import { runTick } from "@/lib/worker/tick";

export const maxDuration = 60;

export async function GET() {
  if (!(await getOwnerSession())) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const [garments, shops, bump] = await Promise.all([
    getCatalog(),
    prisma.shopConnection.findMany({
      where: { isDemo: false },
      select: { id: true, platform: true, shopName: true, stockImportStatus: true, stockImportedAt: true, accessToken: true },
      orderBy: { platform: "asc" },
    }),
    getShopeeBumpStatus(),
  ]);
  return NextResponse.json({
    garments,
    shops: shops.map(({ accessToken, ...s }) => ({
      ...s,
      connected: Boolean(accessToken),
      stockImportedAt: s.stockImportedAt?.toISOString() ?? null,
    })),
    bump,
  });
}

const listingKey = z.object({ shopConnectionId: z.string().min(1), listingId: z.string().min(1) });

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start_import") }),
  z.object({ action: z.literal("auto_link") }),
  z.object({ action: z.literal("link_listings"), a: listingKey, b: listingKey }),
  z.object({ action: z.literal("merge_variants"), intoId: z.string().min(1), fromId: z.string().min(1) }),
  z.object({ action: z.literal("unlink_garment"), garmentId: z.string().min(1) }),
  z.object({ action: z.literal("set_starting_stock"), variantId: z.string().min(1), count: z.number().int().min(0).max(1_000_000) }),
  z.object({ action: z.literal("confirm_all_starting_stock") }),
  z.object({ action: z.literal("toggle_bump"), enabled: z.boolean() }),
  z.object({ action: z.literal("pin_bump"), itemId: z.string().min(1) }),
  z.object({ action: z.literal("bump_now") }),
]);

export async function POST(req: NextRequest) {
  if (!(await getOwnerSession())) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const parsed = actionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const body = parsed.data;

  try {
    switch (body.action) {
      case "start_import": {
        // Read-only: lists listings and their stock. Nothing is written to the shops.
        await prisma.shopConnection.updateMany({
          where: { isDemo: false, accessToken: { not: null } },
          data: { stockImportStatus: IMPORT_RUNNING, stockImportCursor: null },
        });
        after(() => runTick("manual").catch((err) => console.error("[stock import tick]", err)));
        return NextResponse.json({ ok: true });
      }
      case "auto_link": {
        const res = await autoLinkAndInitCatalog();
        return NextResponse.json({ ok: true, ...res });
      }
      case "toggle_bump":
        return NextResponse.json({ ok: true, bump: await setShopeeBumpConfig({ enabled: body.enabled }) });
      case "pin_bump":
        return NextResponse.json({ ok: true, bump: await setShopeeBumpConfig({ togglePinItemId: body.itemId }) });
      case "bump_now": {
        const res = await runShopeeBump({ force: true });
        return NextResponse.json({ ok: true, bumped: res.bumped, error: res.error, bump: await getShopeeBumpStatus() });
      }
      case "link_listings":
        return NextResponse.json({ ok: true, ...(await linkListings(body.a, body.b)) });
      case "merge_variants":
        await mergeVariants(body.intoId, body.fromId);
        return NextResponse.json({ ok: true });
      case "unlink_garment":
        await unlinkGarment(body.garmentId);
        return NextResponse.json({ ok: true });
      case "set_starting_stock":
        await setStartingStock(body.variantId, body.count);
        return NextResponse.json({ ok: true });
      case "confirm_all_starting_stock": {
        // Use the suggested (lower) number for every variant the owner hasn't set yet.
        const garments = await getCatalog();
        let confirmed = 0;
        for (const g of garments) {
          for (const v of g.variants) {
            if (v.startingStock === null && v.stock.suggested !== null) {
              await setStartingStock(v.id, v.stock.suggested);
              confirmed++;
            }
          }
        }
        return NextResponse.json({ ok: true, confirmed });
      }
    }
  } catch (err) {
    console.error("[catalog]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Something went wrong." }, { status: 400 });
  }
}
