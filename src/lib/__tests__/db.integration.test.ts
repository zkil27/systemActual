import { OrderState, Platform, StockReason, WaveStatus } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { saveOrder } from "@/lib/ledger/store";
import { onShelfByVariant } from "@/lib/stock/ledger";
import { excludeWaveParcel } from "@/lib/waves/run";

const describeDb = process.env.INTEGRATION_DB === "1" ? describe : describe.skip;

describeDb("Postgres migrations & trigger integration", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("keeps GarmentVariant.onShelfCount exact across INSERT (with skipDuplicates), UPDATE, and DELETE", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const garment = await prisma.garment.create({
      data: { name: `Integration Top ${suffix}` },
    });

    try {
      const [vA, vB] = await Promise.all([
        prisma.garmentVariant.create({
          data: { garmentId: garment.id, label: "Black, S", startingStock: 10, startingStockSetAt: new Date() },
        }),
        prisma.garmentVariant.create({
          data: { garmentId: garment.id, label: "White, M", startingStock: 5, startingStockSetAt: new Date() },
        }),
      ]);

      const m1 = await prisma.stockMovement.create({
        data: {
          garmentVariantId: vA.id,
          delta: 10,
          reason: StockReason.INITIAL,
          sourceKey: `int:${suffix}:initA`,
        },
      });
      await prisma.stockMovement.createMany({
        data: [
          {
            garmentVariantId: vA.id,
            delta: 4,
            reason: StockReason.SUPPLIER_IN,
            sourceKey: `int:${suffix}:inA`,
          },
          // Duplicate sourceKey: must be ignored without firing the trigger twice.
          {
            garmentVariantId: vA.id,
            delta: 4,
            reason: StockReason.SUPPLIER_IN,
            sourceKey: `int:${suffix}:inA`,
          },
          {
            garmentVariantId: vB.id,
            delta: 5,
            reason: StockReason.INITIAL,
            sourceKey: `int:${suffix}:initB`,
          },
        ],
        skipDuplicates: true,
      });

      let counts = await onShelfByVariant([vA.id, vB.id]);
      expect(counts.get(vA.id)).toBe(14);
      expect(counts.get(vB.id)).toBe(5);

      // Update delta in-place
      await prisma.stockMovement.update({ where: { id: m1.id }, data: { delta: 12 } });
      counts = await onShelfByVariant([vA.id, vB.id]);
      expect(counts.get(vA.id)).toBe(16);

      // Move variant B's movement onto variant A (mirrors absorbVariant)
      await prisma.stockMovement.updateMany({ where: { garmentVariantId: vB.id }, data: { garmentVariantId: vA.id } });
      counts = await onShelfByVariant([vA.id, vB.id]);
      expect(counts.get(vA.id)).toBe(21);
      expect(counts.get(vB.id)).toBe(0);

      // Delete movement
      await prisma.stockMovement.delete({ where: { id: m1.id } });
      counts = await onShelfByVariant([vA.id, vB.id]);
      expect(counts.get(vA.id)).toBe(9);
    } finally {
      await prisma.garment.delete({ where: { id: garment.id } }).catch(() => undefined);
    }
  });

  it("populates Order.state on saveOrder and renumbers wave positions in excludeWaveParcel", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const shop = await prisma.shopConnection.create({
      data: {
        platform: Platform.SHOPEE,
        shopId: `int-shop-${suffix}`,
        shopName: "Integration Shopee",
      },
    });
    const wave = await prisma.wave.create({
      data: {
        status: WaveStatus.PREVIEW,
        trigger: "MANUAL",
        parcelCount: 3,
        summaryJson: {
          total: 3,
          singles: 3,
          multis: 0,
          groups: [],
          skipped: { tooNew: 0, cancelled: 0, notReady: 0, split: 0, alreadyInWave: 0, notRechecked: 0 },
        },
      },
    });

    try {
      const now = new Date();
      for (let i = 0; i < 3; i++) {
        await saveOrder(
          shop.id,
          Platform.SHOPEE,
          {
            orderSn: `INT-${suffix}-${i}`,
            status: i === 0 ? "READY_TO_SHIP" : "PROCESSED",
            isCod: true,
            totalPhp: 199,
            createdAt: new Date(now.getTime() - (3 - i) * 3600_000),
            updatedAt: now,
            shippedAt: null,
            cancelBy: null,
            cancelReason: null,
            cancelRequested: false,
            lines: [
              {
                listingId: `L-${suffix}`,
                variationId: "0",
                name: "Test Garment",
                variationName: "Free Size",
                imageUrl: null,
                quantity: 1,
                unitPricePhp: 199,
              },
            ],
            packages: [
              {
                packageNumber: `PKG-${suffix}-${i}`,
                trackingNumber: null,
                carrier: "SPX Express",
                channelId: "48002",
                status: "LOGISTICS_READY",
              },
            ],
          },
          now
        );
      }

      const savedOrders = await prisma.order.findMany({
        where: { shopConnectionId: shop.id },
        include: { packages: true },
        orderBy: { orderSn: "asc" },
      });
      expect(savedOrders).toHaveLength(3);
      expect(savedOrders[0].state).toBe(OrderState.READY_TO_SHIP);
      expect(savedOrders[1].state).toBe(OrderState.ARRANGED);

      await prisma.waveItem.createMany({
        data: savedOrders.map((o, idx) => ({
          waveId: wave.id,
          packageId: o.packages[0].id,
          orderId: o.id,
          platform: Platform.SHOPEE,
          groupKey: "SHOPEE|48002",
          position: idx,
        })),
      });

      const itemsBefore = await prisma.waveItem.findMany({
        where: { waveId: wave.id },
        orderBy: { position: "asc" },
      });
      await excludeWaveParcel(wave.id, itemsBefore[0].id);

      const itemsAfter = await prisma.waveItem.findMany({
        where: { waveId: wave.id },
        orderBy: { position: "asc" },
      });
      expect(itemsAfter.map((i) => i.position)).toEqual([0, 1]);
    } finally {
      await prisma.wave.delete({ where: { id: wave.id } }).catch(() => undefined);
      await prisma.shopConnection.delete({ where: { id: shop.id } }).catch(() => undefined);
    }
  });
});
