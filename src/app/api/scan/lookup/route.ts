import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getScannerSession, redactParcelForStaff } from "@/lib/auth";
import { MIN_SUFFIX_LENGTH, resolveScanMatch } from "@/lib/returns/scan-match";

const MAX_CHOICES = 6;

export async function GET(req: NextRequest) {
  const session = await getScannerSession();
  if (!session) {
    return NextResponse.json(
      { error: "Unlock the scanner with your 4-digit PIN first." },
      { status: 401 }
    );
  }

  const code = (req.nextUrl.searchParams.get("code") || "").trim();
  if (!code || code.length < 4) {
    return NextResponse.json(
      { error: "Scan a barcode or enter at least 4 characters." },
      { status: 400 }
    );
  }

  // Both waybills: failed deliveries, Return on the Spot and in-transit returns
  // come back on the original one; normal buyer returns on a new one.
  const exact = await prisma.returnParcel.findMany({
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
  });

  // Last-digits fallback for smudged labels. Fetch 2 to tell "one" from "several".
  const suffix =
    exact.length === 0 && code.length >= MIN_SUFFIX_LENGTH
      ? await prisma.returnParcel.findMany({
          where: {
            OR: [
              { rtsTrackingNumber: { endsWith: code, mode: "insensitive" } },
              { forwardTrackingNumber: { endsWith: code, mode: "insensitive" } },
              { orderSn: { endsWith: code, mode: "insensitive" } },
            ],
          },
          take: 2,
        })
      : [];

  const match = resolveScanMatch(exact, suffix);
  switch (match.kind) {
    case "one":
      return NextResponse.json({ found: true, parcel: redactParcelForStaff(match.parcel) });
    case "pick":
      return NextResponse.json({ found: true, matches: match.parcels.map(redactParcelForStaff) });
    case "ambiguous":
      return NextResponse.json(
        { found: false, error: `More than one parcel ends in ${code}. Scan the full barcode.` },
        { status: 409 }
      );
    default:
      return NextResponse.json({ found: false, parcel: null }, { status: 404 });
  }
}
