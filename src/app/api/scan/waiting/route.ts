import { NextResponse } from "next/server";
import { getScannerSession, redactParcelForStaff } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { missingWhere } from "@/lib/returns/rules";
import { getRealShopWhere } from "@/lib/shops";

/**
 * "Returned to seller, waiting to scan": what packers should look for in the
 * courier's return sack. Staff-safe fields only (no money).
 */
export async function GET() {
  const session = await getScannerSession();
  if (!session) return NextResponse.json({ error: "Unlock with your PIN first." }, { status: 401 });
  const [settings, realShop] = await Promise.all([
    prisma.appSettings.findUnique({ where: { id: "default" }, select: { missingSinceAt: true } }),
    getRealShopWhere(),
  ]);
  const where = { AND: [missingWhere(settings?.missingSinceAt ?? null), realShop] };
  const [total, parcels] = await Promise.all([
    prisma.returnParcel.count({ where }),
    prisma.returnParcel.findMany({
      where,
      orderBy: { courierReturnedToSellerAt: "asc" },
      take: 60,
      select: {
        id: true,
        platform: true,
        orderSn: true,
        returnSn: true,
        forwardTrackingNumber: true,
        rtsTrackingNumber: true,
        courier: true,
        category: true,
        digitalStatus: true,
        returnReason: true,
        itemSummary: true,
        variationName: true,
        quantity: true,
        itemImageUrl: true,
        itemsJson: true,
        digitalReturnTaggedAt: true,
        courierReturnedToSellerAt: true,
        physicallyReceivedAt: true,
        physicalCondition: true,
      },
    }),
  ]);
  return NextResponse.json(
    { total, parcels: parcels.map(redactParcelForStaff) },
    { headers: { "Cache-Control": "no-store" } }
  );
}
