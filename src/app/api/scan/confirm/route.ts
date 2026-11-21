import { after, NextRequest, NextResponse } from "next/server";
import { PhysicalCondition } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getScannerSession, redactParcelForStaff } from "@/lib/auth";
import { saveProofPhoto } from "@/lib/storage";
import { notifyOwnerTelegram } from "@/lib/telegram";
import { recordGoodReturn } from "@/lib/stock/ledger";
import { RESTOCK_CONDITIONS } from "@/lib/stock/rules";
import { resolveActorStaffMemberId } from "@/lib/shipping/outbound";
import { missingWhere } from "@/lib/returns/rules";
import { findCondition } from "@/lib/ui/conditions";
import { withSpan } from "@/lib/otel";

const VALID_CONDITIONS = new Set<string>(Object.values(PhysicalCondition));

export async function POST(req: NextRequest) {
  const session = await getScannerSession();
  if (!session) {
    return NextResponse.json(
      { error: "Unlock the scanner with your 4-digit PIN first." },
      { status: 401 }
    );
  }

  try {
    const formData = await req.formData();
    const parcelId = String(formData.get("parcelId") || "").trim();
    const scannedBarcode = String(formData.get("scannedBarcode") || "").trim();
    const conditionRaw = String(formData.get("condition") || "").trim();
    const notes = String(formData.get("notes") || "").trim() || null;

    if (!parcelId || !VALID_CONDITIONS.has(conditionRaw)) {
      return NextResponse.json(
        { error: "Missing parcel ID or valid item condition." },
        { status: 400 }
      );
    }

    const condition = conditionRaw as PhysicalCondition;
    const parcel = await prisma.returnParcel.findUnique({ where: { id: parcelId } });
    if (!parcel) {
      return NextResponse.json({ error: "Parcel not found." }, { status: 404 });
    }

    const staffMemberId = await resolveActorStaffMemberId(session);
    if (!staffMemberId) {
      return NextResponse.json(
        { error: "No active staff profile configured in Settings." },
        { status: 400 }
      );
    }

    const validFiles = formData
      .getAll("photos")
      .filter((entry): entry is File => entry instanceof File && entry.size > 0)
      .slice(0, 3);

    if (findCondition(condition)?.needsPhoto && validFiles.length === 0) {
      return NextResponse.json(
        { error: "Take at least 1 photo of the waybill and item for the dispute claim." },
        { status: 400 }
      );
    }

    const photoUrls =
      validFiles.length > 0
        ? await withSpan("scan.confirm.uploadPhotos", () =>
            Promise.all(validFiles.map((f) => saveProofPhoto(f)))
          )
        : [];

    const now = new Date();
    const [scan, updatedParcel] = await withSpan("scan.confirm.tx", () =>
      prisma.$transaction([
        prisma.physicalScan.create({
          data: {
            parcelId: parcel.id,
            staffMemberId,
            scannedBarcode:
              scannedBarcode ||
              parcel.rtsTrackingNumber ||
              parcel.forwardTrackingNumber ||
              parcel.orderSn,
            condition,
            notes,
            photoUrls,
            scannedAt: now,
          },
        }),
        prisma.returnParcel.update({
          where: { id: parcel.id },
          data: {
            physicallyReceivedAt: parcel.physicallyReceivedAt ?? now,
            physicalCondition: condition,
          },
        }),
      ])
    );

    // Sellable returns go back on the shelf (once per parcel item) in parallel with missing count.
    const [, pendingMissingCount] = await Promise.all([
      recordGoodReturn(parcel.id).catch((err) => {
        console.error("[scan] restock", err);
      }),
      prisma.returnParcel.count({ where: missingWhere }),
    ]);

    if (
      condition === PhysicalCondition.WRONG_OR_SWAPPED_ITEM ||
      condition === PhysicalCondition.DAMAGED_ITEM ||
      condition === PhysicalCondition.MISSING_PIECE
    ) {
      const label =
        condition === PhysicalCondition.WRONG_OR_SWAPPED_ITEM
          ? "WRONG / SWAPPED ITEM"
          : condition === PhysicalCondition.DAMAGED_ITEM
          ? "DAMAGED ITEM"
          : "MISSING PIECE";
      const message = [
        `RETURN ISSUE SCANNED — ${label}`,
        `Item: ${parcel.quantity}x ${parcel.itemSummary}${
          parcel.variationName ? ` (${parcel.variationName})` : ""
        }`,
        `Order: ${parcel.orderSn} (${parcel.courier})`,
        `Scanned by: ${session.name}`,
        notes ? `Note: ${notes}` : null,
        photoUrls.length > 0 ? `Proof photos attached: ${photoUrls.length}` : null,
      ]
        .filter(Boolean)
        .join("\n");

      after(async () => {
        try {
          await notifyOwnerTelegram(message);
        } catch (err) {
          console.error("[scan] telegram notify", err);
        }
      });
    }

    return NextResponse.json({
      ok: true,
      scanId: scan.id,
      photoCount: photoUrls.length,
      restocked: RESTOCK_CONDITIONS.has(condition),
      parcel: redactParcelForStaff(updatedParcel),
      pendingMissingCount,
      recentScan: {
        id: scan.id,
        scannedBarcode: scan.scannedBarcode,
        condition: scan.condition,
        scannedAt: scan.scannedAt.toISOString(),
        photoCount: photoUrls.length,
        parcel: {
          id: updatedParcel.id,
          orderSn: updatedParcel.orderSn,
          courier: updatedParcel.courier,
          category: updatedParcel.category,
          itemSummary: updatedParcel.itemSummary,
          variationName: updatedParcel.variationName,
          itemImageUrl: updatedParcel.itemImageUrl,
        },
      },
    });
  } catch (err) {
    console.error("[Scan confirm error]", err);
    return NextResponse.json(
      { error: "Could not save scan. Please try again." },
      { status: 500 }
    );
  }
}
