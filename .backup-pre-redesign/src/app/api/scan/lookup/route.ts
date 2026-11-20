import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getScannerSession, redactParcelForStaff } from "@/lib/auth";

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

  const exact = await prisma.returnParcel.findFirst({
    where: {
      OR: [
        { rtsTrackingNumber: { equals: code, mode: "insensitive" } },
        { forwardTrackingNumber: { equals: code, mode: "insensitive" } },
        { orderSn: { equals: code, mode: "insensitive" } },
        { returnSn: { equals: code, mode: "insensitive" } },
      ],
    },
    orderBy: { updatedAt: "desc" },
  });

  if (exact) {
    return NextResponse.json({ found: true, parcel: redactParcelForStaff(exact) });
  }

  // Fallback suffix/partial match (super helpful when a thermal barcode is smudged and staff types the last 6 digits)
  const partial = await prisma.returnParcel.findFirst({
    where: {
      OR: [
        { rtsTrackingNumber: { endsWith: code, mode: "insensitive" } },
        { forwardTrackingNumber: { endsWith: code, mode: "insensitive" } },
        { orderSn: { endsWith: code, mode: "insensitive" } },
      ],
    },
    orderBy: { updatedAt: "desc" },
  });

  if (!partial) {
    return NextResponse.json({ found: false, parcel: null }, { status: 404 });
  }

  return NextResponse.json({ found: true, parcel: redactParcelForStaff(partial) });
}
