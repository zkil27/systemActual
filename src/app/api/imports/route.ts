import { NextRequest, NextResponse } from "next/server";
import { Platform } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { parseMarketplaceSpreadsheet } from "@/lib/connectors/csv-importer";
import { upsertNormalizedReturn } from "@/lib/connectors/normalizer";
import { ensureDemoConnections } from "@/lib/demo-simulator";

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
    const { rows, skipped } = parseMarketplaceSpreadsheet(buffer, defaultPlatform);

    if (rows.length === 0) {
      return NextResponse.json(
        {
          error:
            "No valid return rows found. Make sure your file has an Order ID / Order SN column.",
        },
        { status: 400 }
      );
    }

    const connections = await ensureDemoConnections();
    const existingShops = await prisma.shopConnection.findMany();
    const shopeeConn =
      existingShops.find((s) => s.platform === Platform.SHOPEE && !s.isDemo) ??
      connections.shopee;
    const tiktokConn =
      existingShops.find((s) => s.platform === Platform.TIKTOK && !s.isDemo) ??
      connections.tiktok;

    let imported = 0;
    for (const row of rows) {
      const shopConnectionId =
        row.platform === Platform.TIKTOK ? tiktokConn.id : shopeeConn.id;
      await upsertNormalizedReturn({
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
      });
      imported++;
    }

    const job = await prisma.importJob.create({
      data: {
        fileName: file.name,
        sourceHint: defaultPlatform,
        totalRows: rows.length + skipped,
        importedRows: imported,
        skippedRows: skipped,
      },
    });

    return NextResponse.json({
      ok: true,
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
