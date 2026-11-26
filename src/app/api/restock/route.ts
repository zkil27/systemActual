import { after, NextResponse } from "next/server";
import { z } from "zod";
import { actorFromSession } from "@/lib/audit";
import { getOwnerSession } from "@/lib/auth";
import {
  createPurchaseOrder,
  createSupplier,
  decideCostUpdate,
  getReorderSuggestions,
  listPurchaseOrders,
  listSuppliers,
  listVariantPickerItems,
  receivePurchaseOrder,
  updatePurchaseOrderStatus,
  updateSupplier,
} from "@/lib/restock/service";
import { pushStock } from "@/lib/stock/push";

function pushSoon() {
  after(() =>
    pushStock(Date.now() + 25_000).catch((err) =>
      console.error("[restock] pushStock", err)
    )
  );
}

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("createSupplier"),
    name: z.string().min(1).max(120),
    contact: z.string().max(120).nullish(),
    leadTimeDays: z.number().int().min(1).max(90).optional(),
    notes: z.string().max(400).nullish(),
  }),
  z.object({
    action: z.literal("updateSupplier"),
    id: z.string().min(1),
    name: z.string().min(1).max(120).optional(),
    contact: z.string().max(120).nullish(),
    leadTimeDays: z.number().int().min(1).max(90).optional(),
    notes: z.string().max(400).nullish(),
    archived: z.boolean().optional(),
  }),
  z.object({
    action: z.literal("createPo"),
    supplierId: z.string().min(1),
    expectedAt: z.string().max(40).nullish(),
    note: z.string().max(400).nullish(),
    markOrdered: z.boolean().optional(),
    lines: z
      .array(
        z.object({
          garmentVariantId: z.string().min(1),
          orderedQty: z.number().int().min(1).max(50_000),
          unitCostPhp: z.number().min(0).max(1_000_000).nullish(),
          note: z.string().max(200).nullish(),
        })
      )
      .min(1)
      .max(100),
  }),
  z.object({
    action: z.literal("updatePoStatus"),
    id: z.string().min(1),
    status: z.enum(["ORDERED", "CANCELLED"]),
  }),
  z.object({
    action: z.literal("receivePo"),
    purchaseOrderId: z.string().min(1),
    clientKey: z.string().min(8).max(64),
    items: z
      .array(
        z.object({
          lineId: z.string().min(1),
          receivedQty: z.number().int().min(0).max(10_000),
          damagedQty: z.number().int().min(0).max(10_000).default(0),
          note: z.string().max(160).nullish(),
        })
      )
      .min(1)
      .max(100),
  }),
  z.object({
    action: z.literal("decideCostUpdate"),
    lineId: z.string().min(1),
    decision: z.enum(["apply", "dismiss"]),
  }),
]);

export async function GET() {
  const session = await getOwnerSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [suppliers, purchaseOrders, suggestions, variants] = await Promise.all([
    listSuppliers(true),
    listPurchaseOrders(),
    getReorderSuggestions(),
    listVariantPickerItems(),
  ]);

  return NextResponse.json({
    suppliers,
    purchaseOrders,
    suggestions,
    variants,
  });
}

export async function POST(req: Request) {
  const session = await getOwnerSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = actionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }

  const actor = actorFromSession(session);
  const data = parsed.data;

  try {
    switch (data.action) {
      case "createSupplier": {
        const supplier = await createSupplier(
          {
            name: data.name,
            contact: data.contact ?? null,
            leadTimeDays: data.leadTimeDays,
            notes: data.notes ?? null,
          },
          actor
        );
        return NextResponse.json({ supplier }, { status: 201 });
      }
      case "updateSupplier": {
        const supplier = await updateSupplier(
          data.id,
          {
            name: data.name,
            contact: data.contact,
            leadTimeDays: data.leadTimeDays,
            notes: data.notes,
            archived: data.archived,
          },
          actor
        );
        return NextResponse.json({ supplier });
      }
      case "createPo": {
        const purchaseOrder = await createPurchaseOrder(
          {
            supplierId: data.supplierId,
            expectedAt: data.expectedAt ?? null,
            note: data.note ?? null,
            markOrdered: data.markOrdered,
            lines: data.lines,
          },
          actor
        );
        return NextResponse.json({ purchaseOrder }, { status: 201 });
      }
      case "updatePoStatus": {
        const purchaseOrder = await updatePurchaseOrderStatus(
          data.id,
          data.status,
          actor
        );
        return NextResponse.json({ purchaseOrder });
      }
      case "receivePo": {
        const result = await receivePurchaseOrder({
          purchaseOrderId: data.purchaseOrderId,
          clientKey: data.clientKey,
          actor,
          staffMemberId: null,
          items: data.items,
        });
        if (!result.duplicate && result.totalGoodAdded > 0) {
          pushSoon();
        }
        return NextResponse.json(result);
      }
      case "decideCostUpdate": {
        const result = await decideCostUpdate(
          data.lineId,
          data.decision,
          actor
        );
        return NextResponse.json(result);
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
