import { NextRequest, NextResponse } from "next/server";
import { PhysicalCondition } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getScannerSession, redactParcelForStaff } from "@/lib/auth";
import { saveProofPhoto } from "@/lib/storage";
import { notifyOwnerTelegram } from "@/lib/telegram";
import { recordGoodReturn } from "@/lib/stock/ledger";

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

    // Resolve staffMemberId (if owner is testing /scan directly, attach to first active staff or create Owner entry)
    let staffMemberId: string;
    if (session.actorType === "staff") {
      staffMemberId = session.staffId;
    } else {
      const firstStaff = await prisma.staffMember.findFirst({ where: { active: true } });
      if (!firstStaff) {
        return NextResponse.json(
          { error: "No active staff profile configured in Settings." },
          { status: 400 }
        );
      }
      staffMemberId = firstStaff.id;
    }

    const photoUrls: string[] = [];
    const photoFiles = formData.getAll("photos");
    for (const entry of photoFiles) {
      if (entry instanceof File && entry.size > 0) {
        const url = await saveProofPhoto(entry);
        photoUrls.push(url);
      }
    }

    const now = new Date();
    const [scan, updatedParcel] = await prisma.$transaction([
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
    ]);

    // Sellable returns go back on the shelf (once per parcel item).
    try {
      await recordGoodReturn(parcel.id);
    } catch (err) {
      console.error("[scan] restock", err);
    }

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
      await notifyOwnerTelegram(
        [
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
          .join("\n")
      );
    }

    return NextResponse.json({
      ok: true,
      scanId: scan.id,
      photoCount: photoUrls.length,
      parcel: redactParcelForStaff(updatedParcel),
    });
  } catch (err) {
    console.error("[Scan confirm error]", err);
    return NextResponse.json(
      { error: "Could not save scan. Please try again." },
      { status: 500 }
    );
  }
}
