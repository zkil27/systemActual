import { after, NextRequest, NextResponse } from "next/server";
import { DigitalStatus, PhysicalCondition, Platform, ReturnCategory } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getScannerSession, redactParcelForStaff } from "@/lib/auth";
import { upsertNormalizedReturn } from "@/lib/connectors/normalizer";
import { InvalidProofPhotoError, saveProofPhoto } from "@/lib/storage";
import { notifyOwnerTelegram } from "@/lib/telegram";
import { recordGoodReturn, syncReturnRestock } from "@/lib/stock/ledger";
import { pushStock } from "@/lib/stock/push";
import { RESTOCK_CONDITIONS } from "@/lib/stock/rules";
import { resolveActorStaffMemberId } from "@/lib/shipping/outbound";
import { missingWhere } from "@/lib/returns/rules";
import { orderLineReturnItems } from "@/lib/returns/map";
import { findCondition } from "@/lib/ui/conditions";
import { withSpan } from "@/lib/otel";
import { actorFromSession, auditRow } from "@/lib/audit";
import {
  applyItemChecks,
  checkFromCondition,
  deriveParcelCondition,
  describeLine,
  expectedLinesFromItems,
  isSinglePiece,
  priceLines,
  returnCheckSummary,
  type CheckedLine,
  type ItemCheckInput,
} from "@/lib/returns/item-check";

const VALID_CONDITIONS = new Set<string>(Object.values(PhysicalCondition));

/** The phone's item check, sent as JSON in the form. Null when absent; "bad" when unreadable. */
function parseItemChecks(raw: FormDataEntryValue | null): ItemCheckInput[] | null | "bad" {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ItemCheckInput[]) : "bad";
  } catch {
    return "bad";
  }
}

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
    const clientKeyRaw = String(formData.get("clientKey") || "").trim();
    const clientKey = /^[A-Za-z0-9_-]{8,64}$/.test(clientKeyRaw) ? clientKeyRaw : null;
    const submittedChecks = parseItemChecks(formData.get("itemChecks"));
    const packagingTorn = ["1", "true"].includes(String(formData.get("packagingTorn") || ""));
    const checkMsRaw = Number(formData.get("checkMs"));
    const checkMs =
      Number.isFinite(checkMsRaw) && checkMsRaw > 0 && checkMsRaw < 3_600_000 ? Math.round(checkMsRaw) : null;

    // Retry of a save that already went through (flaky Wi-Fi): answer as saved, record nothing.
    if (clientKey) {
      const existing = await prisma.physicalScan.findUnique({
        where: { clientKey },
        include: { parcel: true },
      });
      if (existing) {
        return NextResponse.json({
          ok: true,
          duplicate: true,
          scanId: existing.id,
          photoCount: existing.photoUrls.length,
          restocked: RESTOCK_CONDITIONS.has(existing.condition),
          parcel: redactParcelForStaff(existing.parcel),
        });
      }
    }

    if (!parcelId || !VALID_CONDITIONS.has(conditionRaw)) {
      return NextResponse.json(
        { error: "Missing parcel ID or valid item condition." },
        { status: 400 }
      );
    }

    if (submittedChecks === "bad") {
      return NextResponse.json({ error: "Could not read the item check. Please try again." }, { status: 400 });
    }
    let condition = conditionRaw as PhysicalCondition;
    let parcel = parcelId.startsWith("early:")
      ? null
      : await prisma.returnParcel.findUnique({ where: { id: parcelId } });

    if (!parcel && parcelId.startsWith("early:")) {
      const pkgId = parcelId.slice("early:".length);
      const pkg = await prisma.package.findUnique({
        where: { id: pkgId },
        include: { order: { include: { lines: true } } },
      });
      if (pkg) {
        const ord = pkg.order;
        const firstLine = ord.lines[0];
        const now = new Date();
        parcel = await upsertNormalizedReturn({
          shopConnectionId: ord.shopConnectionId,
          platform: ord.platform,
          orderSn: ord.orderSn,
          forwardTrackingNumber: pkg.trackingNumber ?? null,
          courier:
            pkg.carrier ??
            (ord.platform === Platform.SHOPEE ? "SPX Express" : "J&T Express"),
          category: ReturnCategory.FAILED_DELIVERY,
          digitalStatus: DigitalStatus.RETURNING_TO_SELLER,
          returnReason: "Arrived at warehouse (scanned early)",
          itemSummary: firstLine
            ? ord.lines.length > 1
              ? `${firstLine.name} +${ord.lines.length - 1} more`
              : firstLine.name
            : "Fashion Item",
          variationName: firstLine?.variationName ?? null,
          quantity: Math.max(1, ord.lines.reduce((n, l) => n + l.quantity, 0)),
          itemImageUrl: firstLine?.imageUrl ?? null,
          items: orderLineReturnItems(ord.lines),
          orderTotalPhp: Number(ord.totalPhp),
          orderCreatedAt: ord.platformCreatedAt,
          digitalReturnTaggedAt: now,
          courierReturnedToSellerAt: null,
          expectsPhysicalReturn: true,
          source: "WAREHOUSE_SCAN",
          rawStatus: "EARLY_ARRIVAL",
          eventDescription: "Scanned physically before platform return sync",
          eventTimestamp: now,
        });
      }
    }

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

    // Item-by-item check. One-piece parcels take it from the condition staff
    // tapped (no extra taps); bigger parcels from what staff marked wrong.
    // A phone on an old version sends no check: the parcel is checked as a whole.
    const expected = expectedLinesFromItems(parcel.itemsJson);
    let lines: CheckedLine[] | null = null;
    if (expected.length > 0) {
      if (submittedChecks) {
        const applied = applyItemChecks(expected, submittedChecks);
        if (!applied.ok) return NextResponse.json({ error: applied.error }, { status: 400 });
        lines = applied.lines;
        condition = deriveParcelCondition(lines, packagingTorn);
      } else if (isSinglePiece(expected)) {
        lines = [checkFromCondition(expected[0], condition)];
      }
    }
    const priced = lines ? priceLines(lines, parcel.category, Number(parcel.orderTotalPhp)) : null;
    const summary = priced ? returnCheckSummary(priced) : null;

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
            packagingTorn,
            checkMs,
            ...(priced
              ? {
                  itemChecks: {
                    create: priced.map((l) => ({
                      parcelId: parcel.id,
                      lineKey: l.lineKey,
                      listingId: l.listingId,
                      variationId: l.variationId,
                      name: l.name,
                      variationName: l.variationName,
                      imageUrl: l.imageUrl,
                      expectedQty: l.quantity,
                      goodQty: l.goodQty,
                      damagedQty: l.damagedQty,
                      wrongQty: l.wrongQty,
                      missingQty: l.missingQty,
                      result: l.result,
                      unitPricePhp: l.pricePhp,
                      priceSource: l.priceSource,
                    })),
                  },
                }
              : {}),
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
            clientKey,
          },
        }),
        prisma.returnParcel.update({
          where: { id: parcel.id },
          data: {
            physicallyReceivedAt: parcel.physicallyReceivedAt ?? now,
            physicalCondition: condition,
            // The latest scan decides; a scan without an item check clears an older one.
            piecesGood: summary?.piecesGood ?? null,
            piecesDamaged: summary?.piecesDamaged ?? null,
            piecesWrong: summary?.piecesWrong ?? null,
            piecesMissing: summary?.piecesMissing ?? null,
            receivedValuePhp: summary ? summary.receivedValuePhp : null,
            itemCheckedAt: summary ? now : null,
          },
        }),
        prisma.auditLog.create({
          data: auditRow({
            actor: actorFromSession(session),
            action: "return.scan",
            entity: "ReturnParcel",
            entityId: parcel.id,
            before: { condition: parcel.physicalCondition, receivedAt: parcel.physicallyReceivedAt },
            after: {
              condition,
              packagingTorn,
              ...(summary
                ? {
                    good: summary.piecesGood,
                    damaged: summary.piecesDamaged,
                    wrong: summary.piecesWrong,
                    missing: summary.piecesMissing,
                  }
                : {}),
            },
            at: now,
          }),
        }),
      ])
    );

    // Sellable pieces go back on the shelf in parallel with the missing count.
    // Item-checked parcels restock only the good pieces of each item.
    const [restockedCount, settings] = await Promise.all([
      (lines ? syncReturnRestock(parcel.id, staffMemberId) : recordGoodReturn(parcel.id)).catch((err) => {
        console.error("[scan] restock", err);
        return 0;
      }),
      prisma.appSettings.findUnique({ where: { id: "default" }, select: { missingSinceAt: true } }),
    ]);
    if (restockedCount > 0) {
      // Pieces back on the shelf: tell the shops now, not on the next tick.
      after(() => pushStock(Date.now() + 25_000).catch((err) => console.error("[scan] immediate pushStock", err)));
    }
    const pendingMissingCount = await prisma.returnParcel.count({
      where: missingWhere(settings?.missingSinceAt ?? null),
    });

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
      const problemLines = (lines ?? []).filter((l) => l.goodQty < l.quantity);
      const message = [
        `RETURN ISSUE SCANNED — ${label}`,
        ...(problemLines.length > 0 && lines && lines.length > 1
          ? problemLines.map((l) => `• ${describeLine(l)}`)
          : [
              `Item: ${parcel.quantity}x ${parcel.itemSummary}${
                parcel.variationName ? ` (${parcel.variationName})` : ""
              }`,
            ]),
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
      restocked: (lines ? true : RESTOCK_CONDITIONS.has(condition)) && restockedCount > 0,
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
          quantity: updatedParcel.quantity,
          itemImageUrl: updatedParcel.itemImageUrl,
        },
      },
    });
  } catch (err) {
    if (err instanceof InvalidProofPhotoError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("[Scan confirm error]", err);
    return NextResponse.json(
      { error: "Could not save scan. Please try again." },
      { status: 500 }
    );
  }
}
