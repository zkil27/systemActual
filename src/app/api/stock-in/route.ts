import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getScannerSession } from "@/lib/auth";
import { recordSupplierDelivery, StockNotStartedError } from "@/lib/stock/ledger";

/** Staff search for the garment they're putting on the shelf. No peso values here. */
export async function GET(req: NextRequest) {
  const session = await getScannerSession();
  if (!session) return NextResponse.json({ error: "Unlock with your PIN first." }, { status: 401 });

  const q = (req.nextUrl.searchParams.get("q") || "").trim();
  if (q.length < 2) return NextResponse.json({ variants: [] });

  const variants = await prisma.garmentVariant.findMany({
    where: {
      OR: [
        { garment: { name: { contains: q, mode: "insensitive" } } },
        { label: { contains: q, mode: "insensitive" } },
      ],
    },
    include: { garment: { select: { name: true, imageUrl: true } } },
    orderBy: [{ garment: { name: "asc" } }, { label: "asc" }],
    take: 40,
  });

  return NextResponse.json({
    variants: variants.map((v) => ({
      id: v.id,
      name: v.garment.name,
      label: v.label,
      imageUrl: v.garment.imageUrl,
      started: Boolean(v.startingStockSetAt),
    })),
  });
}

const bodySchema = z.object({
  variantId: z.string().min(1),
  quantity: z.number().int().min(1).max(10_000),
  /** Generated on the phone per entry, so a double tap or retry is counted once. */
  clientKey: z.string().min(8).max(64),
});

export async function POST(req: NextRequest) {
  const session = await getScannerSession();
  if (!session) return NextResponse.json({ error: "Unlock with your PIN first." }, { status: 401 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Pick an item and a quantity." }, { status: 400 });

  let staffMemberId: string;
  if (session.actorType === "staff") {
    staffMemberId = session.staffId;
  } else {
    const first = await prisma.staffMember.findFirst({ where: { active: true }, select: { id: true } });
    if (!first) return NextResponse.json({ error: "Add a staff member in Settings first." }, { status: 400 });
    staffMemberId = first.id;
  }

  try {
    const res = await recordSupplierDelivery({ ...parsed.data, staffMemberId });
    return NextResponse.json({ ok: true, duplicate: res.duplicate });
  } catch (err) {
    if (err instanceof StockNotStartedError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    console.error("[stock-in]", err);
    return NextResponse.json({ error: "Couldn't save. Try again." }, { status: 500 });
  }
}
