import { NextRequest, NextResponse } from "next/server";
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
  getPackerStats,
  OUTBOUND_PACKAGE_INCLUDE,
  resolveActorStaffMemberId,
} from "@/lib/shipping/outbound";
import { withSpan } from "@/lib/otel";

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
  const autoPack = req.nextUrl.searchParams.get("autoPack") === "1";

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
      let pkg = outMatch.pkg;
      let safe = redactOutboundPackageForStaff(pkg);
      const evaluation = evaluateOutboundScan(
        {
          isCancelled: safe.isCancelled,
          courier: safe.courier,
          totalPieces: safe.totalPieces,
          lineCount: safe.lines.length,
          alreadyPacked: Boolean(safe.packedAt),
        },
        { courierLock, autoPackSingle: autoPack }
      );

      let autoPacked = false;
      if (evaluation.status === "AUTO_PACK_OK" && autoPack) {
        const staffMemberId = await resolveActorStaffMemberId(session);
        if (staffMemberId) {
          const updated = await prisma.package.update({
            where: { id: pkg.id },
            data: { packedAt: new Date(), packedByStaffId: staffMemberId },
            include: OUTBOUND_PACKAGE_INCLUDE,
          });
          pkg = {
            ...updated,
            order: {
              ...updated.order,
              lines: pkg.order.lines,
            },
          };
          safe = redactOutboundPackageForStaff(pkg);
          autoPacked = true;
        }
      }

      const stats = autoPacked ? await getPackerStats(session) : undefined;
      return NextResponse.json({
        found: true,
        kind: "outbound",
        autoPacked,
        evaluation,
        outbound: safe,
        ...(stats ?? {}),
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
    default:
      return NextResponse.json({ found: false, parcel: null }, { status: 404 });
  }
}
