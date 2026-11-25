import { NextRequest, NextResponse } from "next/server";
import { DigitalStatus, Platform, ReturnCategory } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  getScannerSession,
  redactOutboundPackageForStaff,
  redactParcelForStaff,
} from "@/lib/auth";
import { MIN_SUFFIX_LENGTH, resolveScanMatch } from "@/lib/returns/scan-match";
import {
  evaluateOutboundScan,
  findOutboundPackagesByCode,
} from "@/lib/shipping/outbound";
import { withSpan } from "@/lib/otel";
import { orderLineReturnItems } from "@/lib/returns/map";

const MAX_CHOICES = 6;

async function lookupReturnParcel(code: string) {
  const exact = await withSpan("scan.lookup.exact", () =>
    prisma.returnParcel.findMany({
      where: {
        OR: [
          { rtsTrackingNumber: { equals: code, mode: "insensitive" } },
          { forwardTrackingNumber: { equals: code, mode: "insensitive" } },
          { orderSn: { equals: code, mode: "insensitive" } },
          { returnSn: { equals: code, mode: "insensitive" } },
        ],
      },
      orderBy: { updatedAt: "desc" },
      take: MAX_CHOICES,
    })
  );

  const suffix =
    exact.length === 0 && code.length >= MIN_SUFFIX_LENGTH
      ? await withSpan("scan.lookup.suffix", () =>
          prisma.returnParcel.findMany({
            where: {
              OR: [
                { rtsTrackingNumber: { endsWith: code, mode: "insensitive" } },
                { forwardTrackingNumber: { endsWith: code, mode: "insensitive" } },
                { orderSn: { endsWith: code, mode: "insensitive" } },
              ],
            },
            take: 2,
          })
        )
      : [];

  return resolveScanMatch(exact, suffix);
}

export async function GET(req: NextRequest) {
  const session = await getScannerSession();
  if (!session) {
    return NextResponse.json(
      { error: "Unlock the scanner with your 4-digit PIN first." },
      { status: 401 }
    );
  }

  const code = (req.nextUrl.searchParams.get("code") || "").trim();
  const modeParam = (req.nextUrl.searchParams.get("mode") || "auto").trim().toLowerCase();
  const mode = modeParam === "outbound" || modeParam === "return" ? modeParam : "auto";
  const courierLock = req.nextUrl.searchParams.get("courierLock");

  if (!code || code.length < 4) {
    return NextResponse.json(
      { error: "Scan a barcode or enter at least 4 characters." },
      { status: 400 }
    );
  }

  if (mode === "outbound" || mode === "auto") {
    const outMatch = await withSpan("scan.lookup.outbound", () =>
      findOutboundPackagesByCode(code)
    );

    if (outMatch.kind === "one") {
      const safe = redactOutboundPackageForStaff(outMatch.pkg);
      const evaluation = evaluateOutboundScan(
        {
          isCancelled: safe.isCancelled,
          courier: safe.courier,
          totalPieces: safe.totalPieces,
          lineCount: safe.lines.length,
          alreadyPacked: Boolean(safe.packedAt),
        },
        { courierLock, autoPackSingle: false }
      );

      return NextResponse.json({
        found: true,
        kind: "outbound",
        autoPacked: false,
        evaluation,
        outbound: safe,
      });
    }

    if (outMatch.kind === "pick") {
      return NextResponse.json({
        found: true,
        kind: "outbound",
        outboundMatches: outMatch.packages.map(redactOutboundPackageForStaff),
      });
    }

    if (outMatch.kind === "ambiguous") {
      return NextResponse.json(
        {
          found: false,
          error: `More than one parcel ends in ${code}. Scan the full barcode.`,
        },
        { status: 409 }
      );
    }

    if (mode === "outbound") {
      const returnHint = await lookupReturnParcel(code);
      if (returnHint.kind !== "none") {
        return NextResponse.json(
          {
            found: false,
            returnMatchHint: true,
            error: `That looks like a return parcel (${code}). Switch to Returns to check it in.`,
          },
          { status: 404 }
        );
      }
      return NextResponse.json(
        {
          found: false,
          error: `No outbound parcel found for ${code}. Sync orders or check the waybill.`,
        },
        { status: 404 }
      );
    }
  }

  const match = await lookupReturnParcel(code);
  switch (match.kind) {
    case "one":
      return NextResponse.json({
        found: true,
        kind: "return",
        parcel: redactParcelForStaff(match.parcel),
      });
    case "pick":
      return NextResponse.json({
        found: true,
        kind: "return",
        matches: match.parcels.map(redactParcelForStaff),
      });
    case "ambiguous":
      return NextResponse.json(
        {
          found: false,
          error: `More than one parcel ends in ${code}. Scan the full barcode.`,
        },
        { status: 409 }
      );
    default: {
      // Fallback: if a rider physically returns an order before Shopee/TikTok syncs
      // the return status, build a read-only preview from the outbound ledger so
      // GET stays mutation-free; POST /api/scan/confirm creates the ReturnParcel.
      const outMatch = await withSpan("scan.lookup.returnFallback", () =>
        findOutboundPackagesByCode(code)
      );
      if (outMatch.kind === "one") {
        const ord = outMatch.pkg.order;
        const firstLine = ord.lines[0];
        const items = orderLineReturnItems(ord.lines);
        const preview = redactParcelForStaff({
          id: `early:${outMatch.pkg.id}`,
          platform: ord.platform,
          orderSn: ord.orderSn,
          returnSn: null,
          forwardTrackingNumber: outMatch.pkg.trackingNumber ?? null,
          rtsTrackingNumber: null,
          courier:
            outMatch.pkg.carrier ??
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
          itemsJson: items,
          digitalReturnTaggedAt: null,
          courierReturnedToSellerAt: null,
          physicallyReceivedAt: null,
          physicalCondition: null,
        });
        return NextResponse.json({
          found: true,
          kind: "return",
          parcel: preview,
        });
      }
      if (outMatch.kind === "ambiguous") {
        return NextResponse.json(
          {
            found: false,
            error: `More than one parcel ends in ${code}. Scan the full barcode.`,
          },
          { status: 409 }
        );
      }
      return NextResponse.json({ found: false, parcel: null }, { status: 404 });
    }
  }
}
