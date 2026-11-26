import { Prisma, PurchaseOrderStatus, StockReason } from "@prisma/client";
import { recordAudit, type AuditActor } from "@/lib/audit";
import {
  committedUnitsByListing,
  effectiveBuffer,
  effectiveLowStock,
} from "@/lib/catalog/garments";
import { prisma } from "@/lib/prisma";
import { ensureVariantStartingStock } from "@/lib/stock/ledger";
import { getManilaDateString, getManilaDayBounds, shiftManilaDateString } from "@/lib/time";
import {
  applyPoReceive,
  computeReorderSuggestions,
  daysOverdueManila,
  derivePurchaseOrderStatus,
  isPurchaseOrderOverdue,
  needsCostConfirmation,
  redactPurchaseOrderForStaff,
  type PurchaseOrderStatusValue,
  type ReorderSuggestion,
  type StaffPurchaseOrderView,
} from "./rules";

export interface SupplierDto {
  id: string;
  name: string;
  contact: string | null;
  leadTimeDays: number;
  notes: string | null;
  archivedAt: string | null;
  openPoCount: number;
  poCount: number;
  createdAt: string;
}

export interface PurchaseOrderLineDto {
  id: string;
  garmentVariantId: string;
  garmentId: string;
  garmentName: string;
  variantLabel: string;
  imageUrl: string | null;
  binLocation: string | null;
  garmentUnitCostPhp: number | null;
  orderedQty: number;
  receivedQty: number;
  damagedQty: number;
  remainingQty: number;
  unitCostPhp: number | null;
  costUpdatePending: boolean;
  note: string | null;
}

export interface PurchaseOrderDto {
  id: string;
  poNumber: string;
  status: PurchaseOrderStatusValue;
  supplierId: string;
  supplierName: string;
  supplierContact: string | null;
  supplierLeadTimeDays: number;
  orderedAt: string | null;
  expectedAt: string | null;
  receivedAt: string | null;
  note: string | null;
  totalCostPhp: number | null;
  isOverdue: boolean;
  daysOverdue: number;
  hasPendingCostUpdates: boolean;
  createdAt: string;
  lines: PurchaseOrderLineDto[];
}

export interface VariantPickerItem {
  variantId: string;
  garmentId: string;
  garmentName: string;
  variantLabel: string;
  imageUrl: string | null;
  binLocation: string | null;
  onShelfCount: number;
  unitCostPhp: number | null;
}

export interface OverduePoSummary {
  id: string;
  poNumber: string;
  supplierName: string;
  expectedAt: string;
  daysOverdue: number;
  remainingPieces: number;
}

function toNum(v: Prisma.Decimal | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parses an expected delivery date string (`YYYY-MM-DD` or ISO) into a Date
 * anchored at Manila noon so `getManilaDateString(expectedAt)` stays exact.
 */
function parseExpectedDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const { start } = getManilaDayBounds(trimmed);
    return new Date(start.getTime() + 12 * 60 * 60 * 1000);
  }
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

const poInclude = {
  supplier: {
    select: {
      id: true,
      name: true,
      contact: true,
      leadTimeDays: true,
    },
  },
  lines: {
    orderBy: { createdAt: "asc" as const },
    include: {
      garmentVariant: {
        select: {
          id: true,
          label: true,
          garment: {
            select: {
              id: true,
              name: true,
              imageUrl: true,
              binLocation: true,
              unitCostPhp: true,
            },
          },
        },
      },
    },
  },
} satisfies Prisma.PurchaseOrderInclude;

type HydratedPo = Prisma.PurchaseOrderGetPayload<{ include: typeof poInclude }>;

function serializePo(po: HydratedPo, now: Date = new Date()): PurchaseOrderDto {
  const overdue = isPurchaseOrderOverdue(
    { status: po.status, expectedAt: po.expectedAt },
    now
  );
  const lines: PurchaseOrderLineDto[] = po.lines.map((l) => ({
    id: l.id,
    garmentVariantId: l.garmentVariantId,
    garmentId: l.garmentVariant.garment.id,
    garmentName: l.garmentVariant.garment.name,
    variantLabel: l.garmentVariant.label,
    imageUrl: l.garmentVariant.garment.imageUrl,
    binLocation: l.garmentVariant.garment.binLocation,
    garmentUnitCostPhp: toNum(l.garmentVariant.garment.unitCostPhp),
    orderedQty: l.orderedQty,
    receivedQty: l.receivedQty,
    damagedQty: l.damagedQty,
    remainingQty: Math.max(0, l.orderedQty - l.receivedQty - l.damagedQty),
    unitCostPhp: toNum(l.unitCostPhp),
    costUpdatePending: l.costUpdatePending,
    note: l.note,
  }));

  return {
    id: po.id,
    poNumber: po.poNumber,
    status: po.status,
    supplierId: po.supplierId,
    supplierName: po.supplier.name,
    supplierContact: po.supplier.contact,
    supplierLeadTimeDays: po.supplier.leadTimeDays,
    orderedAt: po.orderedAt ? po.orderedAt.toISOString() : null,
    expectedAt: po.expectedAt ? po.expectedAt.toISOString() : null,
    receivedAt: po.receivedAt ? po.receivedAt.toISOString() : null,
    note: po.note,
    totalCostPhp: toNum(po.totalCostPhp),
    isOverdue: overdue,
    daysOverdue: overdue ? daysOverdueManila(po.expectedAt, now) : 0,
    hasPendingCostUpdates: lines.some((l) => l.costUpdatePending),
    createdAt: po.createdAt.toISOString(),
    lines,
  };
}

export async function listSuppliers(includeArchived = true): Promise<SupplierDto[]> {
  const suppliers = await prisma.supplier.findMany({
    where: includeArchived ? undefined : { archivedAt: null },
    orderBy: [{ archivedAt: "asc" }, { name: "asc" }],
    include: {
      purchaseOrders: {
        select: { status: true },
      },
    },
  });

  return suppliers.map((s) => ({
    id: s.id,
    name: s.name,
    contact: s.contact,
    leadTimeDays: s.leadTimeDays,
    notes: s.notes,
    archivedAt: s.archivedAt ? s.archivedAt.toISOString() : null,
    openPoCount: s.purchaseOrders.filter(
      (p) => p.status === "ORDERED" || p.status === "PARTIAL"
    ).length,
    poCount: s.purchaseOrders.length,
    createdAt: s.createdAt.toISOString(),
  }));
}

export async function createSupplier(
  input: {
    name: string;
    contact?: string | null;
    leadTimeDays?: number;
    notes?: string | null;
  },
  actor: AuditActor
): Promise<SupplierDto> {
  const name = input.name.trim();
  if (!name) throw new Error("Supplier name is required.");
  const leadTimeDays = Math.min(90, Math.max(1, Math.round(input.leadTimeDays ?? 7)));

  const created = await prisma.$transaction(async (tx) => {
    const supplier = await tx.supplier.create({
      data: {
        name,
        contact: input.contact?.trim() || null,
        leadTimeDays,
        notes: input.notes?.trim() || null,
      },
    });
    await recordAudit(
      {
        actor,
        action: "supplier.created",
        entity: "Supplier",
        entityId: supplier.id,
        after: {
          name: supplier.name,
          contact: supplier.contact,
          leadTimeDays: supplier.leadTimeDays,
        },
      },
      tx
    );
    return supplier;
  });

  return {
    id: created.id,
    name: created.name,
    contact: created.contact,
    leadTimeDays: created.leadTimeDays,
    notes: created.notes,
    archivedAt: null,
    openPoCount: 0,
    poCount: 0,
    createdAt: created.createdAt.toISOString(),
  };
}

export async function updateSupplier(
  id: string,
  input: {
    name?: string;
    contact?: string | null;
    leadTimeDays?: number;
    notes?: string | null;
    archived?: boolean;
  },
  actor: AuditActor
): Promise<SupplierDto> {
  const updated = await prisma.$transaction(async (tx) => {
    const existing = await tx.supplier.findUniqueOrThrow({ where: { id } });
    const nextData: Prisma.SupplierUpdateInput = {};
    if (input.name !== undefined) {
      const trimmed = input.name.trim();
      if (!trimmed) throw new Error("Supplier name cannot be empty.");
      nextData.name = trimmed;
    }
    if (input.contact !== undefined) nextData.contact = input.contact?.trim() || null;
    if (input.leadTimeDays !== undefined) {
      nextData.leadTimeDays = Math.min(90, Math.max(1, Math.round(input.leadTimeDays)));
    }
    if (input.notes !== undefined) nextData.notes = input.notes?.trim() || null;
    if (input.archived !== undefined) {
      nextData.archivedAt = input.archived ? new Date() : null;
    }

    const row = await tx.supplier.update({
      where: { id },
      data: nextData,
      include: { purchaseOrders: { select: { status: true } } },
    });

    await recordAudit(
      {
        actor,
        action:
          input.archived === true
            ? "supplier.archived"
            : input.archived === false
              ? "supplier.restored"
              : "supplier.updated",
        entity: "Supplier",
        entityId: row.id,
        before: {
          name: existing.name,
          contact: existing.contact,
          leadTimeDays: existing.leadTimeDays,
          archivedAt: existing.archivedAt?.toISOString() ?? null,
        },
        after: {
          name: row.name,
          contact: row.contact,
          leadTimeDays: row.leadTimeDays,
          archivedAt: row.archivedAt?.toISOString() ?? null,
        },
      },
      tx
    );
    return row;
  });

  return {
    id: updated.id,
    name: updated.name,
    contact: updated.contact,
    leadTimeDays: updated.leadTimeDays,
    notes: updated.notes,
    archivedAt: updated.archivedAt ? updated.archivedAt.toISOString() : null,
    openPoCount: updated.purchaseOrders.filter(
      (p) => p.status === "ORDERED" || p.status === "PARTIAL"
    ).length,
    poCount: updated.purchaseOrders.length,
    createdAt: updated.createdAt.toISOString(),
  };
}

async function nextPoNumber(tx: Prisma.TransactionClient, now: Date): Promise<string> {
  const dateCompact = getManilaDateString(now).replaceAll("-", "");
  const prefix = `PO-${dateCompact}-`;
  const existing = await tx.purchaseOrder.findMany({
    where: { poNumber: { startsWith: prefix } },
    select: { poNumber: true },
  });
  let maxSeq = 0;
  for (const row of existing) {
    const suffix = row.poNumber.slice(prefix.length);
    const n = Number.parseInt(suffix, 10);
    if (Number.isFinite(n) && n > maxSeq) maxSeq = n;
  }
  return `${prefix}${String(maxSeq + 1).padStart(3, "0")}`;
}

export async function listPurchaseOrders(opts?: {
  status?: PurchaseOrderStatus | "OPEN";
}): Promise<PurchaseOrderDto[]> {
  const where: Prisma.PurchaseOrderWhereInput | undefined =
    opts?.status === "OPEN"
      ? { status: { in: ["DRAFT", "ORDERED", "PARTIAL"] } }
      : opts?.status
        ? { status: opts.status }
        : undefined;

  const rows = await prisma.purchaseOrder.findMany({
    where,
    include: poInclude,
    orderBy: [{ createdAt: "desc" }],
    take: 100,
  });

  const now = new Date();
  return rows.map((po) => serializePo(po, now));
}

/**
 * Staff-safe view of active supplier deliveries awaiting arrival.
 * Uses a strict narrow projection + explicit redaction so costs never leave the DB.
 */
export async function listOpenPurchaseOrdersForStaff(): Promise<StaffPurchaseOrderView[]> {
  const rows = await prisma.purchaseOrder.findMany({
    where: { status: { in: ["ORDERED", "PARTIAL"] } },
    orderBy: [{ expectedAt: "asc" }, { createdAt: "desc" }],
    take: 50,
    select: {
      id: true,
      poNumber: true,
      status: true,
      expectedAt: true,
      note: true,
      supplier: { select: { name: true } },
      lines: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          garmentVariantId: true,
          orderedQty: true,
          receivedQty: true,
          damagedQty: true,
          garmentVariant: {
            select: {
              label: true,
              garment: {
                select: {
                  id: true,
                  name: true,
                  imageUrl: true,
                  binLocation: true,
                },
              },
            },
          },
        },
      },
    },
  });

  return rows.map((po) => redactPurchaseOrderForStaff(po));
}

export async function createPurchaseOrder(
  input: {
    supplierId: string;
    expectedAt?: string | null;
    note?: string | null;
    markOrdered?: boolean;
    lines: Array<{
      garmentVariantId: string;
      orderedQty: number;
      unitCostPhp?: number | null;
      note?: string | null;
    }>;
  },
  actor: AuditActor
): Promise<PurchaseOrderDto> {
  if (!input.lines.length) {
    throw new Error("Add at least one item to the supplier order.");
  }

  // Merge duplicate variants safely if submitted twice in the sheet.
  const merged = new Map<
    string,
    { garmentVariantId: string; orderedQty: number; unitCostPhp: number | null; note: string | null }
  >();
  for (const raw of input.lines) {
    const qty = Math.max(1, Math.min(50_000, Math.floor(raw.orderedQty)));
    const cost =
      raw.unitCostPhp !== null && raw.unitCostPhp !== undefined && Number.isFinite(raw.unitCostPhp) && raw.unitCostPhp >= 0
        ? Number(raw.unitCostPhp.toFixed(2))
        : null;
    const prev = merged.get(raw.garmentVariantId);
    if (prev) {
      prev.orderedQty += qty;
      if (cost !== null) prev.unitCostPhp = cost;
      if (raw.note?.trim()) prev.note = raw.note.trim().slice(0, 200);
    } else {
      merged.set(raw.garmentVariantId, {
        garmentVariantId: raw.garmentVariantId,
        orderedQty: qty,
        unitCostPhp: cost,
        note: raw.note?.trim().slice(0, 200) || null,
      });
    }
  }

  const linesInput = [...merged.values()];
  const now = new Date();
  const status: PurchaseOrderStatus =
    input.markOrdered === false ? "DRAFT" : "ORDERED";

  const created = await prisma.$transaction(async (tx) => {
    const supplier = await tx.supplier.findUniqueOrThrow({
      where: { id: input.supplierId },
    });
    if (supplier.archivedAt) {
      throw new Error("This supplier is archived. Unarchive it before creating an order.");
    }

    const variantIds = linesInput.map((l) => l.garmentVariantId);
    const existingVariants = await tx.garmentVariant.findMany({
      where: { id: { in: variantIds } },
      select: { id: true },
    });
    if (existingVariants.length !== variantIds.length) {
      throw new Error("One or more selected variants no longer exist.");
    }

    const parsedExpected = parseExpectedDate(input.expectedAt);
    const expectedAt =
      parsedExpected ??
      new Date(now.getTime() + supplier.leadTimeDays * 86_400_000);

    let totalCostNumber = 0;
    let hasAnyCost = false;
    for (const line of linesInput) {
      if (line.unitCostPhp !== null) {
        hasAnyCost = true;
        totalCostNumber += line.orderedQty * line.unitCostPhp;
      }
    }

    const poNumber = await nextPoNumber(tx, now);
    const po = await tx.purchaseOrder.create({
      data: {
        supplierId: supplier.id,
        poNumber,
        status,
        orderedAt: status === "ORDERED" ? now : null,
        expectedAt,
        note: input.note?.trim().slice(0, 400) || null,
        totalCostPhp: hasAnyCost ? new Prisma.Decimal(totalCostNumber.toFixed(2)) : null,
        createdById: actor.id,
        lines: {
          create: linesInput.map((l) => ({
            garmentVariantId: l.garmentVariantId,
            orderedQty: l.orderedQty,
            unitCostPhp: l.unitCostPhp !== null ? new Prisma.Decimal(l.unitCostPhp.toFixed(2)) : null,
            note: l.note,
          })),
        },
      },
      include: poInclude,
    });

    await recordAudit(
      {
        actor,
        action: "po.created",
        entity: "PurchaseOrder",
        entityId: po.id,
        after: {
          poNumber: po.poNumber,
          status: po.status,
          supplierId: po.supplierId,
          supplierName: supplier.name,
          lineCount: linesInput.length,
        },
      },
      tx
    );

    return po;
  });

  return serializePo(created, now);
}

export async function updatePurchaseOrderStatus(
  id: string,
  nextStatus: "ORDERED" | "CANCELLED",
  actor: AuditActor
): Promise<PurchaseOrderDto> {
  const now = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    const existing = await tx.purchaseOrder.findUniqueOrThrow({
      where: { id },
      include: { supplier: { select: { leadTimeDays: true } } },
    });

    if (nextStatus === "ORDERED") {
      if (existing.status !== "DRAFT") {
        throw new Error("Only draft supplier orders can be marked as ordered.");
      }
    } else if (nextStatus === "CANCELLED") {
      if (existing.status === "RECEIVED") {
        throw new Error("Received supplier orders cannot be cancelled.");
      }
      if (existing.status === "CANCELLED") {
        return tx.purchaseOrder.findUniqueOrThrow({
          where: { id },
          include: poInclude,
        });
      }
    }

    const row = await tx.purchaseOrder.update({
      where: { id },
      data: {
        status: nextStatus,
        orderedAt:
          nextStatus === "ORDERED" ? (existing.orderedAt ?? now) : existing.orderedAt,
        expectedAt:
          nextStatus === "ORDERED" && !existing.expectedAt
            ? new Date(now.getTime() + existing.supplier.leadTimeDays * 86_400_000)
            : existing.expectedAt,
      },
      include: poInclude,
    });

    await recordAudit(
      {
        actor,
        action: "po.status_changed",
        entity: "PurchaseOrder",
        entityId: row.id,
        before: { poNumber: row.poNumber, status: existing.status },
        after: { poNumber: row.poNumber, status: row.status },
      },
      tx
    );

    return row;
  });

  return serializePo(updated, now);
}

export interface ReceivePoItemInput {
  lineId: string;
  receivedQty: number;
  damagedQty?: number;
  note?: string | null;
}

export async function receivePurchaseOrder(opts: {
  purchaseOrderId: string;
  clientKey: string;
  actor: AuditActor;
  staffMemberId?: string | null;
  items: ReceivePoItemInput[];
}): Promise<{
  duplicate: boolean;
  poNumber: string;
  status: PurchaseOrderStatusValue;
  totalGoodAdded: number;
  totalDamagedAdded: number;
}> {
  const activeItems = opts.items
    .map((item) => ({
      lineId: item.lineId,
      receivedQty: Math.max(0, Math.min(10_000, Math.floor(item.receivedQty))),
      damagedQty: Math.max(0, Math.min(10_000, Math.floor(item.damagedQty ?? 0))),
      note: item.note?.trim().slice(0, 160) || null,
    }))
    .filter((i) => i.receivedQty > 0 || i.damagedQty > 0);

  if (!activeItems.length) {
    throw new Error("Enter at least 1 received or damaged piece.");
  }

  // Ensure every touched variant has its starting stock initialized before ledger delta writes.
  const poLines = await prisma.purchaseOrderLine.findMany({
    where: {
      purchaseOrderId: opts.purchaseOrderId,
      id: { in: activeItems.map((i) => i.lineId) },
    },
    select: {
      id: true,
      garmentVariant: {
        select: {
          id: true,
          startingStockSetAt: true,
          listings: {
            select: {
              platform: true,
              listingId: true,
              variationId: true,
              availableStock: true,
            },
          },
        },
      },
    },
  });
  for (const row of poLines) {
    await ensureVariantStartingStock(row.garmentVariant);
  }

  const now = new Date();
  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "PurchaseOrder" WHERE id = ${opts.purchaseOrderId} FOR UPDATE`;
      const po = await tx.purchaseOrder.findUniqueOrThrow({
        where: { id: opts.purchaseOrderId },
        include: {
          supplier: { select: { name: true } },
          lines: {
            include: {
              garmentVariant: {
                select: {
                  id: true,
                  garment: { select: { unitCostPhp: true } },
                },
              },
            },
          },
        },
      });

      if (po.status === "CANCELLED") {
        throw new Error("Cannot receive items into a cancelled supplier order.");
      }

      const lineById = new Map(po.lines.map((l) => [l.id, l]));
      let totalGoodAdded = 0;
      let totalDamagedAdded = 0;
      const updatedLineSnapshots: Array<{
        orderedQty: number;
        receivedQty: number;
        damagedQty: number;
      }> = [];
      const untouchedLines = new Set(po.lines.map((l) => l.id));

      for (const item of activeItems) {
        const line = lineById.get(item.lineId);
        if (!line) {
          throw new Error("Purchase order line not found.");
        }
        untouchedLines.delete(line.id);

        const applied = applyPoReceive(line, item.receivedQty, item.damagedQty);
        totalGoodAdded += applied.stockDelta;
        totalDamagedAdded += item.damagedQty;

        const noteParts = [`${po.poNumber} (${po.supplier.name})`];
        if (item.damagedQty > 0) noteParts.push(`${item.damagedQty} damaged`);
        if (item.note) noteParts.push(item.note);

        // Always insert a StockMovement keyed by po:<clientKey>:<lineId> (delta=0 when only damaged)
        // so Postgres unique constraint guarantees idempotency across retries.
        await tx.stockMovement.create({
          data: {
            garmentVariantId: line.garmentVariantId,
            delta: applied.stockDelta,
            reason: StockReason.SUPPLIER_IN,
            sourceKey: `po:${opts.clientKey}:${line.id}`,
            purchaseOrderLineId: line.id,
            staffMemberId: opts.staffMemberId ?? null,
            note: noteParts.join(" • ").slice(0, 200),
          },
        });

        const poCost = toNum(line.unitCostPhp);
        const garmentCost = toNum(line.garmentVariant.garment.unitCostPhp);
        const flagCostUpdate =
          line.costUpdatePending ||
          (applied.stockDelta > 0 && needsCostConfirmation(poCost, garmentCost));

        await tx.purchaseOrderLine.update({
          where: { id: line.id },
          data: {
            receivedQty: applied.nextReceivedQty,
            damagedQty: applied.nextDamagedQty,
            costUpdatePending: flagCostUpdate,
          },
        });

        updatedLineSnapshots.push({
          orderedQty: line.orderedQty,
          receivedQty: applied.nextReceivedQty,
          damagedQty: applied.nextDamagedQty,
        });
      }

      for (const remainingId of untouchedLines) {
        const line = lineById.get(remainingId)!;
        updatedLineSnapshots.push({
          orderedQty: line.orderedQty,
          receivedQty: line.receivedQty,
          damagedQty: line.damagedQty,
        });
      }

      const nextStatus = derivePurchaseOrderStatus(po.status, updatedLineSnapshots);
      await tx.purchaseOrder.update({
        where: { id: po.id },
        data: {
          status: nextStatus,
          receivedAt: nextStatus === "RECEIVED" ? (po.receivedAt ?? now) : po.receivedAt,
        },
      });

      await recordAudit(
        {
          actor: opts.actor,
          action: "po.received",
          entity: "PurchaseOrder",
          entityId: po.id,
          after: {
            poNumber: po.poNumber,
            clientKey: opts.clientKey,
            status: nextStatus,
            goodAdded: totalGoodAdded,
            damagedAdded: totalDamagedAdded,
          },
        },
        tx
      );

      return {
        duplicate: false,
        poNumber: po.poNumber,
        status: nextStatus,
        totalGoodAdded,
        totalDamagedAdded,
      };
    });

    return result;
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      const po = await prisma.purchaseOrder.findUnique({
        where: { id: opts.purchaseOrderId },
        select: { poNumber: true, status: true },
      });
      return {
        duplicate: true,
        poNumber: po?.poNumber ?? "",
        status: po?.status ?? "ORDERED",
        totalGoodAdded: 0,
        totalDamagedAdded: 0,
      };
    }
    throw err;
  }
}

export async function decideCostUpdate(
  lineId: string,
  decision: "apply" | "dismiss",
  actor: AuditActor
): Promise<{ ok: true; garmentId: string; unitCostPhp: number | null }> {
  return prisma.$transaction(async (tx) => {
    const line = await tx.purchaseOrderLine.findUniqueOrThrow({
      where: { id: lineId },
      include: {
        purchaseOrder: { select: { poNumber: true } },
        garmentVariant: {
          select: {
            garmentId: true,
            garment: { select: { name: true, unitCostPhp: true } },
          },
        },
      },
    });

    const garmentId = line.garmentVariant.garmentId;
    const prevCost = toNum(line.garmentVariant.garment.unitCostPhp);
    const poCost = toNum(line.unitCostPhp);

    if (decision === "apply" && line.unitCostPhp !== null) {
      await tx.garment.update({
        where: { id: garmentId },
        data: { unitCostPhp: line.unitCostPhp },
      });
    }

    await tx.purchaseOrderLine.update({
      where: { id: line.id },
      data: { costUpdatePending: false },
    });

    await recordAudit(
      {
        actor,
        action: decision === "apply" ? "po.cost_applied" : "po.cost_dismissed",
        entity: "PurchaseOrderLine",
        entityId: line.id,
        before: {
          poNumber: line.purchaseOrder.poNumber,
          garmentName: line.garmentVariant.garment.name,
          garmentUnitCostPhp: prevCost,
          costUpdatePending: true,
        },
        after: {
          poNumber: line.purchaseOrder.poNumber,
          garmentName: line.garmentVariant.garment.name,
          garmentUnitCostPhp: decision === "apply" ? poCost : prevCost,
          costUpdatePending: false,
        },
      },
      tx
    );

    return {
      ok: true,
      garmentId,
      unitCostPhp: decision === "apply" ? poCost : prevCost,
    };
  });
}

export async function listVariantPickerItems(): Promise<VariantPickerItem[]> {
  const variants = await prisma.garmentVariant.findMany({
    where: { garment: { archivedAt: null } },
    orderBy: [{ garment: { name: "asc" } }, { label: "asc" }],
    select: {
      id: true,
      label: true,
      onShelfCount: true,
      garment: {
        select: {
          id: true,
          name: true,
          imageUrl: true,
          binLocation: true,
          unitCostPhp: true,
        },
      },
    },
  });

  return variants.map((v) => ({
    variantId: v.id,
    garmentId: v.garment.id,
    garmentName: v.garment.name,
    variantLabel: v.label,
    imageUrl: v.garment.imageUrl,
    binLocation: v.garment.binLocation,
    onShelfCount: v.onShelfCount,
    unitCostPhp: toNum(v.garment.unitCostPhp),
  }));
}

export async function getReorderSuggestions(
  now: Date = new Date()
): Promise<ReorderSuggestion[]> {
  const todayStr = getManilaDateString(now);
  const sevenDaysAgoStr = shiftManilaDateString(todayStr, -6);
  const { start: sevenDaysStart } = getManilaDayBounds(sevenDaysAgoStr);

  const [settings, variants, committedByListing, openPoLines, recentPoLines, recentOrderLines] =
    await Promise.all([
      prisma.appSettings.findUnique({
        where: { id: "default" },
        select: { stockSafetyBuffer: true, defaultUnitCostPhp: true },
      }),
      prisma.garmentVariant.findMany({
        where: { garment: { archivedAt: null } },
        select: {
          id: true,
          garmentId: true,
          label: true,
          onShelfCount: true,
          startingStockSetAt: true,
          garment: {
            select: {
              id: true,
              name: true,
              imageUrl: true,
              binLocation: true,
              lowStockThreshold: true,
              safetyBuffer: true,
              unitCostPhp: true,
            },
          },
          listings: {
            select: {
              platform: true,
              listingId: true,
              variationId: true,
            },
          },
        },
      }),
      committedUnitsByListing(),
      prisma.purchaseOrderLine.findMany({
        where: {
          purchaseOrder: { status: { in: ["ORDERED", "PARTIAL"] } },
        },
        select: {
          garmentVariantId: true,
          orderedQty: true,
          receivedQty: true,
          damagedQty: true,
        },
      }),
      prisma.purchaseOrderLine.findMany({
        where: {
          purchaseOrder: { status: { not: "CANCELLED" } },
        },
        orderBy: { createdAt: "desc" },
        take: 300,
        select: {
          garmentVariantId: true,
          garmentVariant: { select: { garmentId: true } },
          purchaseOrder: {
            select: {
              supplier: {
                select: { id: true, name: true, leadTimeDays: true, archivedAt: true },
              },
            },
          },
        },
      }),
      prisma.orderLine.findMany({
        where: {
          order: {
            platformCreatedAt: { gte: sevenDaysStart },
            state: { notIn: ["CANCELLED", "UNPAID"] },
          },
        },
        select: {
          listingId: true,
          variationId: true,
          quantity: true,
          order: { select: { platform: true } },
        },
      }),
    ]);

  const globalBuffer = settings?.stockSafetyBuffer ?? 0;

  // Map listing -> variantId for fast 7-day sales aggregation.
  const variantByListingKey = new Map<string, string>();
  for (const v of variants) {
    for (const l of v.listings) {
      variantByListingKey.set(`${l.platform}:${l.listingId}:${l.variationId}`, v.id);
    }
  }

  const sold7ByVariant = new Map<string, number>();
  for (const ol of recentOrderLines) {
    const vid = variantByListingKey.get(
      `${ol.order.platform}:${ol.listingId}:${ol.variationId}`
    );
    if (!vid) continue;
    sold7ByVariant.set(vid, (sold7ByVariant.get(vid) ?? 0) + ol.quantity);
  }

  const onOrderByVariant = new Map<string, number>();
  for (const pl of openPoLines) {
    const rem = Math.max(0, pl.orderedQty - pl.receivedQty - pl.damagedQty);
    if (rem > 0) {
      onOrderByVariant.set(
        pl.garmentVariantId,
        (onOrderByVariant.get(pl.garmentVariantId) ?? 0) + rem
      );
    }
  }

  const supplierByVariant = new Map<
    string,
    { id: string; name: string; leadTimeDays: number }
  >();
  const supplierByGarment = new Map<
    string,
    { id: string; name: string; leadTimeDays: number }
  >();
  for (const rl of recentPoLines) {
    const s = rl.purchaseOrder.supplier;
    if (s.archivedAt) continue;
    const info = { id: s.id, name: s.name, leadTimeDays: s.leadTimeDays };
    if (!supplierByVariant.has(rl.garmentVariantId)) {
      supplierByVariant.set(rl.garmentVariantId, info);
    }
    if (!supplierByGarment.has(rl.garmentVariant.garmentId)) {
      supplierByGarment.set(rl.garmentVariant.garmentId, info);
    }
  }

  // Only suggest reorder for variants where stock has started or there are recent sales/open POs.
  const inputItems = variants
    .filter(
      (v) =>
        v.startingStockSetAt !== null ||
        (sold7ByVariant.get(v.id) ?? 0) > 0 ||
        (onOrderByVariant.get(v.id) ?? 0) > 0
    )
    .map((v) => {
      let committed = 0;
      for (const l of v.listings) {
        committed +=
          committedByListing.get(`${l.platform}:${l.listingId}:${l.variationId}`) ?? 0;
      }
      return {
        variantId: v.id,
        garmentId: v.garment.id,
        garmentName: v.garment.name,
        variantLabel: v.label,
        imageUrl: v.garment.imageUrl,
        binLocation: v.garment.binLocation,
        onShelfCount: v.onShelfCount,
        committed,
        safetyBuffer: effectiveBuffer(v.garment.safetyBuffer, globalBuffer),
        lowStockThreshold: effectiveLowStock(v.garment.lowStockThreshold),
        soldLast7Days: sold7ByVariant.get(v.id) ?? 0,
        onOrderQty: onOrderByVariant.get(v.id) ?? 0,
        unitCostPhp: toNum(v.garment.unitCostPhp),
        lastSupplier:
          supplierByVariant.get(v.id) ??
          supplierByGarment.get(v.garmentId) ??
          null,
      };
    });

  return computeReorderSuggestions(inputItems);
}

export async function getOverduePurchaseOrders(
  now: Date = new Date()
): Promise<OverduePoSummary[]> {
  const openPos = await prisma.purchaseOrder.findMany({
    where: {
      status: { in: ["ORDERED", "PARTIAL"] },
      expectedAt: { not: null },
    },
    select: {
      id: true,
      poNumber: true,
      status: true,
      expectedAt: true,
      supplier: { select: { name: true } },
      lines: {
        select: { orderedQty: true, receivedQty: true, damagedQty: true },
      },
    },
  });

  const overdue: OverduePoSummary[] = [];
  for (const po of openPos) {
    if (!isPurchaseOrderOverdue({ status: po.status, expectedAt: po.expectedAt }, now)) {
      continue;
    }
    const remainingPieces = po.lines.reduce(
      (sum, l) => sum + Math.max(0, l.orderedQty - l.receivedQty - l.damagedQty),
      0
    );
    overdue.push({
      id: po.id,
      poNumber: po.poNumber,
      supplierName: po.supplier.name,
      expectedAt: po.expectedAt!.toISOString(),
      daysOverdue: daysOverdueManila(po.expectedAt, now),
      remainingPieces,
    });
  }

  overdue.sort((a, b) => b.daysOverdue - a.daysOverdue);
  return overdue;
}
