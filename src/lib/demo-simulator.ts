import {
  DigitalStatus,
  PhysicalCondition,
  Platform,
  ReturnCategory,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { KYNA_FASHION_ITEMS } from "@/lib/demo-catalog";
import { getManilaDayBounds, getManilaTodayStr } from "@/lib/time";
import { upsertNormalizedReturn } from "@/lib/connectors/normalizer";

export async function ensureDemoConnections() {
  const shopee = await prisma.shopConnection.upsert({
    where: { shopId: "demo-shopee-kynaph" },
    create: {
      platform: Platform.SHOPEE,
      shopId: "demo-shopee-kynaph",
      shopName: "Kyna Clothing Shop (kynaph)",
      isDemo: true,
      lastSyncedAt: new Date(),
    },
    update: { lastSyncedAt: new Date() },
  });

  const tiktok = await prisma.shopConnection.upsert({
    where: { shopId: "demo-tiktok-kynaph" },
    create: {
      platform: Platform.TIKTOK,
      shopId: "demo-tiktok-kynaph",
      shopName: "Kyna Clothing PH (TikTok)",
      isDemo: true,
      lastSyncedAt: new Date(),
    },
    update: { lastSyncedAt: new Date() },
  });

  return { shopee, tiktok };
}

/**
 * Generates realistic kynaph fashion return & failed-delivery parcels for Today,
 * Yesterday, and Overdue RTS so the owner can test every screen before API approval lands.
 */
export async function generateDemoDayData() {
  const { shopee, tiktok } = await ensureDemoConnections();
  const staff = await prisma.staffMember.findMany({ where: { active: true } });
  const todayBounds = getManilaDayBounds(getManilaTodayStr());

  const atManilaHour = (dayOffset: number, hour: number, minute: number) =>
    new Date(
      todayBounds.start.getTime() +
        dayOffset * 24 * 60 * 60 * 1000 +
        hour * 60 * 60 * 1000 +
        minute * 60 * 1000
    );

  const couriers = ["SPX Express", "J&T Express", "Flash Express"];
  const failedReasons = [
    "Buyer refused COD parcel",
    "Recipient unreachable after 2 delivery attempts",
    "Incomplete or wrong delivery address",
    "Buyer unavailable at delivery address",
  ];
  const buyerReasons = [
    "Wrong size ordered",
    "Changed mind",
    "Color looked different in photo",
    "Item does not fit",
  ];

  let createdCount = 0;

  // 1) 18 Failed Deliveries tagged TODAY across Shopee & TikTok
  for (let i = 0; i < 18; i++) {
    const isShopee = i % 2 === 0;
    const item = KYNA_FASHION_ITEMS[i % KYNA_FASHION_ITEMS.length];
    const courier = isShopee ? couriers[i % 2] : couriers[(i % 2) + 1];
    const orderSn = isShopee
      ? `261120SPFD${String(1001 + i)}`
      : `579410TTFD${String(2001 + i)}`;
    const tracking = isShopee
      ? `SPXPH0689${String(4100 + i)}`
      : `JT78231${String(5200 + i)}`;
    const qty = i % 5 === 0 ? 2 : 1;

    // 10 of 18 also marked "Returned to Seller" by courier today; 7 physically scanned; 3 MISSING discrepancies!
    const courierMarkedBack = i < 10;
    const physicallyScanned = i < 7;

    const taggedAt = atManilaHour(0, 8 + (i % 8), (i * 7) % 55);
    const courierReturnedAt = courierMarkedBack
      ? atManilaHour(0, 12 + (i % 5), (i * 11) % 55)
      : null;

    const parcel = await upsertNormalizedReturn({
      shopConnectionId: isShopee ? shopee.id : tiktok.id,
      platform: isShopee ? Platform.SHOPEE : Platform.TIKTOK,
      orderSn,
      forwardTrackingNumber: tracking,
      rtsTrackingNumber: `RTS-${tracking}`,
      courier,
      category: ReturnCategory.FAILED_DELIVERY,
      digitalStatus: courierMarkedBack
        ? DigitalStatus.COURIER_RETURNED
        : DigitalStatus.RETURNING_TO_SELLER,
      returnReason: failedReasons[i % failedReasons.length],
      itemSummary: item.itemSummary,
      variationName: item.variationName,
      quantity: qty,
      itemImageUrl: item.imageUrl,
      orderTotalPhp: item.pricePhp * qty,
      estimatedUnitCostPhp: item.unitCostPhp * qty,
      orderCreatedAt: atManilaHour(-4, 14, 15),
      digitalReturnTaggedAt: taggedAt,
      courierReturnedToSellerAt: courierReturnedAt,
      source: "DEMO",
      rawStatus: courierMarkedBack ? "RETURNED_TO_SELLER" : "FAILED_DELIVERY",
      eventDescription: courierMarkedBack
        ? `Courier (${courier}) marked parcel returned to seller`
        : `Driver tagged failed delivery (${failedReasons[i % failedReasons.length]})`,
      eventTimestamp: courierReturnedAt ?? taggedAt,
    });

    if (physicallyScanned && staff.length > 0 && !parcel.physicallyReceivedAt) {
      const scanner = staff[i % staff.length];
      const scannedAt = atManilaHour(0, 14 + (i % 4), (i * 9) % 50);
      const cond =
        i === 6
          ? PhysicalCondition.DAMAGED_PACKAGING
          : PhysicalCondition.GOOD_RESTOCKABLE;
      await prisma.physicalScan.create({
        data: {
          parcelId: parcel.id,
          staffMemberId: scanner.id,
          scannedBarcode: tracking,
          condition: cond,
          notes: cond === PhysicalCondition.DAMAGED_PACKAGING ? "Pouch torn, garment clean" : null,
          photoUrls: [],
          scannedAt,
        },
      });
      await prisma.returnParcel.update({
        where: { id: parcel.id },
        data: { physicallyReceivedAt: scannedAt, physicalCondition: cond },
      });
    }
    createdCount++;
  }

  // 2) 6 Buyer Return / Refund requests filed TODAY (4 marked back by courier, 3 scanned, 1 MISSING + 1 Swapped + 1 Urgent Deadline)
  for (let i = 0; i < 6; i++) {
    const isShopee = i < 4;
    const item = KYNA_FASHION_ITEMS[(i + 2) % KYNA_FASHION_ITEMS.length];
    const courier = isShopee ? "SPX Express" : "J&T Express";
    const orderSn = isShopee
      ? `261120SPRR${String(3001 + i)}`
      : `579410TTRR${String(4001 + i)}`;
    const returnSn = isShopee ? `RET-SP-${9100 + i}` : `REV-TT-${8100 + i}`;
    const tracking = isShopee ? `SPXRET99${String(100 + i)}` : `JTRET88${String(200 + i)}`;

    const courierMarkedBack = i < 4;
    const physicallyScanned = i < 3;
    const taggedAt = atManilaHour(0, 9 + i, 20);
    const courierReturnedAt = courierMarkedBack ? atManilaHour(0, 13 + i, 10) : null;
    const disputeDeadlineAt =
      i === 2 || i === 3 ? new Date(Date.now() + 14 * 60 * 60 * 1000) : null;

    const parcel = await upsertNormalizedReturn({
      shopConnectionId: isShopee ? shopee.id : tiktok.id,
      platform: isShopee ? Platform.SHOPEE : Platform.TIKTOK,
      orderSn,
      returnSn,
      forwardTrackingNumber: `FWD-${tracking}`,
      rtsTrackingNumber: tracking,
      courier,
      category: ReturnCategory.RETURN_REFUND,
      digitalStatus: courierMarkedBack
        ? DigitalStatus.COURIER_RETURNED
        : DigitalStatus.RETURN_REQUESTED,
      returnReason: buyerReasons[i % buyerReasons.length],
      disputeDeadlineAt,
      itemSummary: item.itemSummary,
      variationName: item.variationName,
      quantity: 1,
      itemImageUrl: item.imageUrl,
      orderTotalPhp: item.pricePhp,
      estimatedUnitCostPhp: item.unitCostPhp,
      orderCreatedAt: atManilaHour(-5, 11, 0),
      digitalReturnTaggedAt: taggedAt,
      courierReturnedToSellerAt: courierReturnedAt,
      source: "DEMO",
      rawStatus: courierMarkedBack ? "RETURNED_TO_SELLER" : "RETURN_REQUESTED",
      eventDescription: `Buyer return request: ${buyerReasons[i % buyerReasons.length]}`,
      eventTimestamp: courierReturnedAt ?? taggedAt,
    });

    if (physicallyScanned && staff.length > 0 && !parcel.physicallyReceivedAt) {
      const scanner = staff[(i + 1) % staff.length];
      const scannedAt = atManilaHour(0, 15 + i, 5);
      const cond =
        i === 2
          ? PhysicalCondition.WRONG_OR_SWAPPED_ITEM
          : PhysicalCondition.GOOD_RESTOCKABLE;
      await prisma.physicalScan.create({
        data: {
          parcelId: parcel.id,
          staffMemberId: scanner.id,
          scannedBarcode: tracking,
          condition: cond,
          notes:
            cond === PhysicalCondition.WRONG_OR_SWAPPED_ITEM
              ? "Old faded t-shirt inside instead of pleated skirt"
              : null,
          photoUrls: [],
          scannedAt,
        },
      });
      await prisma.returnParcel.update({
        where: { id: parcel.id },
        data: { physicallyReceivedAt: scannedAt, physicalCondition: cond },
      });
    }
    createdCount++;
  }

  // 3) 3 Overdue Failed Deliveries stuck in transit > 12 days (for Courier Claim alerts)
  for (let i = 0; i < 3; i++) {
    const item = KYNA_FASHION_ITEMS[(i + 4) % KYNA_FASHION_ITEMS.length];
    const isShopee = i !== 1;
    const courier = couriers[i % couriers.length];
    const orderSn = `261106OVERDUE${String(501 + i)}`;
    const tracking = `OVERDUE${String(7001 + i)}`;
    await upsertNormalizedReturn({
      shopConnectionId: isShopee ? shopee.id : tiktok.id,
      platform: isShopee ? Platform.SHOPEE : Platform.TIKTOK,
      orderSn,
      forwardTrackingNumber: tracking,
      rtsTrackingNumber: `RTS-${tracking}`,
      courier,
      category: ReturnCategory.FAILED_DELIVERY,
      digitalStatus: DigitalStatus.RETURNING_TO_SELLER,
      returnReason: "Buyer refused COD parcel",
      itemSummary: item.itemSummary,
      variationName: item.variationName,
      quantity: 1,
      itemImageUrl: item.imageUrl,
      orderTotalPhp: item.pricePhp,
      estimatedUnitCostPhp: item.unitCostPhp,
      orderCreatedAt: atManilaHour(-16, 10, 0),
      digitalReturnTaggedAt: atManilaHour(-13, 15, 30),
      courierReturnedToSellerAt: null,
      source: "DEMO",
      rawStatus: "RETURNING_TO_SELLER",
      eventDescription: "Stuck in reverse transit hub for 13 days",
      eventTimestamp: atManilaHour(-13, 15, 30),
    });
    createdCount++;
  }

  // 4) 6 Yesterday records so Yesterday / 7-Days views look realistic too
  for (let i = 0; i < 6; i++) {
    const isFailed = i < 4;
    const isShopee = i % 2 === 0;
    const item = KYNA_FASHION_ITEMS[(i + 1) % KYNA_FASHION_ITEMS.length];
    const courier = couriers[i % couriers.length];
    const orderSn = `261119YEST${String(601 + i)}`;
    const tracking = `YEST${String(8100 + i)}`;
    const taggedAt = atManilaHour(-1, 10 + i, 15);
    const returnedAt = atManilaHour(-1, 14 + (i % 3), 30);

    const parcel = await upsertNormalizedReturn({
      shopConnectionId: isShopee ? shopee.id : tiktok.id,
      platform: isShopee ? Platform.SHOPEE : Platform.TIKTOK,
      orderSn,
      returnSn: isFailed ? null : `RET-YEST-${i}`,
      forwardTrackingNumber: tracking,
      rtsTrackingNumber: `RTS-${tracking}`,
      courier,
      category: isFailed ? ReturnCategory.FAILED_DELIVERY : ReturnCategory.RETURN_REFUND,
      digitalStatus: DigitalStatus.COURIER_RETURNED,
      returnReason: isFailed ? failedReasons[0] : buyerReasons[0],
      itemSummary: item.itemSummary,
      variationName: item.variationName,
      quantity: 1,
      itemImageUrl: item.imageUrl,
      orderTotalPhp: item.pricePhp,
      estimatedUnitCostPhp: item.unitCostPhp,
      orderCreatedAt: atManilaHour(-5, 9, 0),
      digitalReturnTaggedAt: taggedAt,
      courierReturnedToSellerAt: returnedAt,
      source: "DEMO",
      rawStatus: "RETURNED_TO_SELLER",
      eventDescription: "Yesterday return sample",
      eventTimestamp: returnedAt,
    });

    if (staff.length > 0 && !parcel.physicallyReceivedAt) {
      const scannedAt = atManilaHour(-1, 16, 10 + i * 5);
      await prisma.physicalScan.create({
        data: {
          parcelId: parcel.id,
          staffMemberId: staff[i % staff.length].id,
          scannedBarcode: tracking,
          condition: PhysicalCondition.GOOD_RESTOCKABLE,
          photoUrls: [],
          scannedAt,
        },
      });
      await prisma.returnParcel.update({
        where: { id: parcel.id },
        data: {
          physicallyReceivedAt: scannedAt,
          physicalCondition: PhysicalCondition.GOOD_RESTOCKABLE,
        },
      });
    }
    createdCount++;
  }

  return { createdCount };
}
