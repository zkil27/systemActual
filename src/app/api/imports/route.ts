import { NextRequest, NextResponse } from "next/server";
import { Platform } from "@prisma/client";
import { getOwnerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { detectAndParseSpreadsheet } from "@/lib/connectors/csv-importer";
import { upsertNormalizedReturn } from "@/lib/connectors/normalizer";
import { autoLinkAndInitCatalog, ensureGarmentFor } from "@/lib/catalog/garments";
import { saveOrder } from "@/lib/ledger/store";

export const maxDuration = 60;
const MAX_IMPORT_BYTES = 10 * 1024 * 1024; // 10 MB

function noShopMessage(platform: Platform): string {
  return platform === Platform.SHOPEE
    ? "Shopee uploads are coming soon. Shopee is still reviewing Kyna Ops."
    : "Connect TikTok Shop in Settings first.";
}

export async function GET() {
  if (!(await getOwnerSession())) {
    return NextResponse.json({ error: "Owner sign-in required." }, { status: 401 });
  }
  const jobs = await prisma.importJob.findMany({
    orderBy: { createdAt: "desc" },
    take: 15,
  });
  return NextResponse.json({ jobs });
}

export async function POST(req: NextRequest) {
  if (!(await getOwnerSession())) {
    return NextResponse.json({ error: "Owner sign-in required." }, { status: 401 });
  }
  try {
    const formData = await req.formData();
    const file = formData.get("file");
    const platformParam = String(formData.get("platform") || "SHOPEE").toUpperCase();
    const defaultPlatform =
      platformParam === "TIKTOK" ? Platform.TIKTOK : Platform.SHOPEE;

    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json(
        { error: "Please select a CSV or Excel (.xlsx) file to upload." },
        { status: 400 }
      );
    }
    if (file.size > MAX_IMPORT_BYTES) {
      return NextResponse.json(
        { error: "File must be 10 MB or smaller." },
        { status: 413 }
      );
    }

    // Rows go onto the real shop for their platform. A platform without one is skipped.
    const realShops = await prisma.shopConnection.findMany({
      where: { isDemo: false },
      select: { id: true, platform: true },
    });
    const shopIdFor = (p: Platform) => realShops.find((s) => s.platform === p)?.id ?? null;
    if (!shopIdFor(defaultPlatform)) {
      return NextResponse.json({ error: noShopMessage(defaultPlatform) }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const parsed = detectAndParseSpreadsheet(buffer, defaultPlatform);

    let imported = 0;
    let totalRows = 0;
    let noShop = 0;
    const missingShops = new Set<Platform>();
    const shopFor = (p: Platform): string | null => {
      const id = shopIdFor(p);
      if (!id) {
        noShop++;
        missingShops.add(p);
      }
      return id;
    };

    if (parsed.kind === "returns") {
      if (parsed.rows.length === 0) {
        return NextResponse.json(
          { error: "No valid rows found. Make sure your file has an Order ID / Order SN or Product ID column." },
          { status: 400 }
        );
      }
      totalRows = parsed.rows.length + parsed.skipped;
      const settings = await prisma.appSettings.findUnique({
        where: { id: "default" },
        select: { defaultUnitCostPhp: true },
      });
      const defaultUnitCostPhp = Number(settings?.defaultUnitCostPhp ?? 82);
      for (const row of parsed.rows) {
        const shopConnectionId = shopFor(row.platform);
        if (!shopConnectionId) continue;
        await upsertNormalizedReturn(
          {
            shopConnectionId,
            platform: row.platform,
            orderSn: row.orderSn,
            returnSn: row.returnSn,
            forwardTrackingNumber: row.forwardTrackingNumber,
            rtsTrackingNumber: row.rtsTrackingNumber,
            courier: row.courier,
            category: row.category,
            digitalStatus: row.digitalStatus,
            returnReason: row.returnReason,
            itemSummary: row.itemSummary,
            variationName: row.variationName,
            quantity: row.quantity,
            orderTotalPhp: row.orderTotalPhp,
            digitalReturnTaggedAt: row.digitalReturnTaggedAt,
            courierReturnedToSellerAt: row.courierReturnedToSellerAt,
            source: "CSV_IMPORT",
            rawStatus: row.rawStatus,
            eventDescription: `Imported from ${file.name}`,
            eventTimestamp: row.courierReturnedToSellerAt ?? row.digitalReturnTaggedAt,
          },
          { defaultUnitCostPhp }
        );
        imported++;
      }
    } else if (parsed.kind === "orders") {
      totalRows = parsed.orders.length + parsed.skipped;
      const seenListings = new Set<string>();
      for (const { platform, order } of parsed.orders) {
        const shopConnectionId = shopFor(platform);
        if (!shopConnectionId) continue;
        await saveOrder(shopConnectionId, platform, order, new Date(), { seenListings });
        imported++;
      }
    } else {
      totalRows = parsed.items.length + parsed.skipped;
      const now = new Date();
      for (const item of parsed.items) {
        const shopConnectionId = shopFor(item.platform);
        if (!shopConnectionId) continue;
        const lv = await prisma.listingVariant.upsert({
          where: {
            shopConnectionId_listingId_variationId: {
              shopConnectionId,
              listingId: item.listingId,
              variationId: item.variationId,
            },
          },
          create: {
            shopConnectionId,
            platform: item.platform,
            listingId: item.listingId,
            variationId: item.variationId,
            name: item.name,
            variationName: item.variationName,
            availableStock: item.availableStock,
            stockCheckedAt: now,
            lastSeenAt: now,
          },
          update: {
            name: item.name,
            variationName: item.variationName,
            availableStock: item.availableStock,
            stockCheckedAt: now,
            lastSeenAt: now,
          },
        });
        await ensureGarmentFor(lv);
        imported++;
      }
      await autoLinkAndInitCatalog().catch((err) => console.error("[csv stock autoLink]", err));
    }

    if (imported === 0) {
      const [missing] = [...missingShops];
      return NextResponse.json(
        { error: missing ? noShopMessage(missing) : "No valid rows found in that file." },
        { status: 400 }
      );
    }

    const skipped = parsed.skipped + noShop;
    const job = await prisma.importJob.create({
      data: {
        fileName: file.name,
        sourceHint: `${defaultPlatform}:${parsed.kind.toUpperCase()}`,
        totalRows,
        importedRows: imported,
        skippedRows: skipped,
      },
    });

    return NextResponse.json({
      ok: true,
      kind: parsed.kind,
      job,
      imported,
      skipped,
    });
  } catch (err) {
    console.error("[CSV/XLSX import error]", err);
    return NextResponse.json(
      { error: "Could not read that file. Please upload a valid CSV or XLSX export." },
      { status: 500 }
    );
  }
}
