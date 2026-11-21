import { NextRequest, NextResponse } from "next/server";
import { Platform } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { detectAndParseSpreadsheet } from "@/lib/connectors/csv-importer";
import { upsertNormalizedReturn } from "@/lib/connectors/normalizer";
import { ensureDemoConnections } from "@/lib/demo-simulator";
import { autoLinkAndInitCatalog, ensureGarmentFor } from "@/lib/catalog/garments";
import { saveOrder } from "@/lib/ledger/store";

export const maxDuration = 60;

export async function GET() {
  const jobs = await prisma.importJob.findMany({
    orderBy: { createdAt: "desc" },
    take: 15,
  });
  return NextResponse.json({ jobs });
}

export async function POST(req: NextRequest) {
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

    const buffer = Buffer.from(await file.arrayBuffer());
    const parsed = detectAndParseSpreadsheet(buffer, defaultPlatform);

    const connections = await ensureDemoConnections();
    const existingShops = await prisma.shopConnection.findMany();
    const shopeeConn =
      existingShops.find((s) => s.platform === Platform.SHOPEE && !s.isDemo) ??
      connections.shopee;
    const tiktokConn =
      existingShops.find((s) => s.platform === Platform.TIKTOK && !s.isDemo) ??
      connections.tiktok;

    let imported = 0;
    let totalRows = 0;

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
        const shopConnectionId = row.platform === Platform.TIKTOK ? tiktokConn.id : shopeeConn.id;
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
        const shopConnectionId = platform === Platform.TIKTOK ? tiktokConn.id : shopeeConn.id;
        await saveOrder(shopConnectionId, platform, order, new Date(), { seenListings });
        imported++;
      }
    } else {
      totalRows = parsed.items.length + parsed.skipped;
      const now = new Date();
      for (const item of parsed.items) {
        const shopConnectionId = item.platform === Platform.TIKTOK ? tiktokConn.id : shopeeConn.id;
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
      return NextResponse.json(
        { error: "No valid rows found in that file." },
        { status: 400 }
      );
    }

    const job = await prisma.importJob.create({
      data: {
        fileName: file.name,
        sourceHint: `${defaultPlatform}:${parsed.kind.toUpperCase()}`,
        totalRows,
        importedRows: imported,
        skippedRows: parsed.skipped,
      },
    });

    return NextResponse.json({
      ok: true,
      kind: parsed.kind,
      job,
      imported,
      skipped: parsed.skipped,
    });
  } catch (err) {
    console.error("[CSV/XLSX import error]", err);
    return NextResponse.json(
      { error: "Could not read that file. Please upload a valid CSV or XLSX export." },
      { status: 500 }
    );
  }
}
