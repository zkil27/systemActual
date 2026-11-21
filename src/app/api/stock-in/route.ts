import { after, NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getScannerSession } from "@/lib/auth";
import { resolveActorStaffMemberId } from "@/lib/shipping/outbound";
import {
  onShelfByVariant,
  recordStaffStockReport,
  recordSupplierDelivery,
  StockNotStartedError,
} from "@/lib/stock/ledger";
import { pushStock } from "@/lib/stock/push";
import { notifyOwnerTelegram } from "@/lib/telegram";

/** Staff search for the garment they're updating on the shelf. No peso values here. */
export async function GET(req: NextRequest) {
  const session = await getScannerSession();
  if (!session) return NextResponse.json({ error: "Unlock with your PIN first." }, { status: 401 });

  const variantId = (req.nextUrl.searchParams.get("variantId") || "").trim();
  const q = (req.nextUrl.searchParams.get("q") || "").trim();

  if (!variantId && q.length < 2) {
    return NextResponse.json({ variants: [] });
  }

  const variants = await prisma.garmentVariant.findMany({
    where: variantId
      ? { id: variantId }
      : {
          OR: [
            { garment: { name: { contains: q, mode: "insensitive" } } },
            { label: { contains: q, mode: "insensitive" } },
          ],
        },
    include: { garment: { select: { name: true, imageUrl: true } } },
    orderBy: [{ garment: { name: "asc" } }, { label: "asc" }],
    take: 40,
  });

  const startedIds = variants.filter((v) => v.startingStockSetAt).map((v) => v.id);
  const shelfMap = startedIds.length > 0 ? await onShelfByVariant(startedIds) : new Map<string, number>();

  return NextResponse.json({
    variants: variants.map((v) => ({
      id: v.id,
      name: v.garment.name,
      label: v.label,
      imageUrl: v.garment.imageUrl,
      started: Boolean(v.startingStockSetAt),
      onShelf: v.startingStockSetAt ? Math.max(0, shelfMap.get(v.id) ?? 0) : null,
    })),
  });
}

const bodySchema = z.object({
  variantId: z.string().min(1),
  mode: z.enum(["SUPPLIER_IN", "EMPTY_SHELF", "DEFECTIVE"]).default("SUPPLIER_IN"),
  quantity: z.number().int().min(0).max(10_000).default(1),
  note: z.string().max(200).optional(),
  /** Generated on the phone per entry, so a double tap or retry is counted once. */
  clientKey: z.string().min(8).max(64),
});

export async function POST(req: NextRequest) {
  const session = await getScannerSession();
  if (!session) return NextResponse.json({ error: "Unlock with your PIN first." }, { status: 401 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Pick an item and a quantity." }, { status: 400 });

  const staffMemberId = await resolveActorStaffMemberId(session);
  if (!staffMemberId) {
    return NextResponse.json({ error: "Add a staff member in Settings first." }, { status: 400 });
  }

  try {
    if (parsed.data.mode === "SUPPLIER_IN") {
      if (parsed.data.quantity < 1) {
        return NextResponse.json({ error: "Enter at least 1 piece." }, { status: 400 });
      }
      const res = await recordSupplierDelivery({
        variantId: parsed.data.variantId,
        quantity: parsed.data.quantity,
        staffMemberId,
        clientKey: parsed.data.clientKey,
      });
      return NextResponse.json({ ok: true, duplicate: res.duplicate });
    }

    if (parsed.data.mode === "DEFECTIVE" && parsed.data.quantity < 1) {
      return NextResponse.json({ error: "Enter at least 1 damaged piece." }, { status: 400 });
    }

    const report = await recordStaffStockReport({
      variantId: parsed.data.variantId,
      mode: parsed.data.mode,
      quantity: parsed.data.quantity,
      note: parsed.data.note,
      staffMemberId,
      staffName: session.name || "Staff",
      clientKey: parsed.data.clientKey,
    });

    if (!report.duplicate) {
      const headline =
        parsed.data.mode === "EMPTY_SHELF"
          ? "SHELF ALERT — EMPTY SHELF (0 LEFT)"
          : `SHELF ALERT — DAMAGED ON SHELF (${report.delta})`;
      const message = [
        headline,
        `Item: ${report.garmentName} (${report.variantLabel})`,
        `Reported by: ${session.name || "Staff"}`,
        `Shelf count: ${report.previousOnShelf} → ${report.newOnShelf} (updating Shopee & TikTok now)`,
        parsed.data.note?.trim() ? `Note: ${parsed.data.note.trim()}` : null,
      ]
        .filter(Boolean)
        .join("\n");

      after(async () => {
        try {
          await pushStock(Date.now() + 25_000);
        } catch (err) {
          console.error("[stock-in] immediate pushStock", err);
        }
        try {
          await notifyOwnerTelegram(message);
        } catch (err) {
          console.error("[stock-in] telegram notify", err);
        }
      });
    }

    return NextResponse.json({
      ok: true,
      duplicate: report.duplicate,
      previousOnShelf: report.previousOnShelf,
      newOnShelf: report.newOnShelf,
      delta: report.delta,
    });
  } catch (err) {
    if (err instanceof StockNotStartedError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    console.error("[stock-in]", err);
    return NextResponse.json({ error: "Couldn't save. Try again." }, { status: 500 });
  }
}
