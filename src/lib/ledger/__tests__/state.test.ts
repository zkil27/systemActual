import { OrderState, Platform } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { COMMITTED_ORDER_STATUSES } from "@/lib/catalog/variants";
import { FINAL_ORDER_STATUSES } from "../normalize";
import {
  isCancelledOrderState,
  isCommittedOrderState,
  isDeliveredOrderState,
  normalizeOrderState,
} from "../state";
import { READY_ORDER_STATUSES } from "@/lib/waves/plan";

describe("normalizeOrderState", () => {
  it("maps Shopee statuses consistently with committed, ready, and final lists", () => {
    for (const s of COMMITTED_ORDER_STATUSES[Platform.SHOPEE]) {
      expect(isCommittedOrderState(normalizeOrderState(Platform.SHOPEE, s)), s).toBe(true);
    }
    for (const s of READY_ORDER_STATUSES[Platform.SHOPEE]) {
      expect(normalizeOrderState(Platform.SHOPEE, s), s).toBe(OrderState.READY_TO_SHIP);
    }
    expect(normalizeOrderState(Platform.SHOPEE, "PROCESSED")).toBe(OrderState.ARRANGED);
    expect(normalizeOrderState(Platform.SHOPEE, "SHIPPED")).toBe(OrderState.SHIPPED);
    expect(normalizeOrderState(Platform.SHOPEE, "TO_CONFIRM_RECEIVE")).toBe(OrderState.DELIVERED);
    expect(isDeliveredOrderState(normalizeOrderState(Platform.SHOPEE, "TO_CONFIRM_RECEIVE"))).toBe(true);
    expect(isCancelledOrderState(normalizeOrderState(Platform.SHOPEE, "IN_CANCEL"))).toBe(true);
    for (const s of FINAL_ORDER_STATUSES) {
      expect([OrderState.COMPLETED, OrderState.CANCELLED]).toContain(normalizeOrderState(Platform.SHOPEE, s));
    }
  });

  it("maps TikTok statuses consistently with committed, ready, and final lists", () => {
    for (const s of COMMITTED_ORDER_STATUSES[Platform.TIKTOK]) {
      expect(isCommittedOrderState(normalizeOrderState(Platform.TIKTOK, s)), s).toBe(true);
    }
    for (const s of READY_ORDER_STATUSES[Platform.TIKTOK]) {
      expect(normalizeOrderState(Platform.TIKTOK, s), s).toBe(OrderState.READY_TO_SHIP);
    }
    expect(normalizeOrderState(Platform.TIKTOK, "AWAITING_COLLECTION")).toBe(OrderState.ARRANGED);
    expect(normalizeOrderState(Platform.TIKTOK, "IN_TRANSIT")).toBe(OrderState.SHIPPED);
    expect(normalizeOrderState(Platform.TIKTOK, "DELIVERED")).toBe(OrderState.DELIVERED);
    expect(normalizeOrderState(Platform.TIKTOK, "COMPLETED")).toBe(OrderState.COMPLETED);
    expect(normalizeOrderState(Platform.TIKTOK, "CANCELLED")).toBe(OrderState.CANCELLED);
    expect(normalizeOrderState(Platform.TIKTOK, "SOMETHING_NEW")).toBe(OrderState.UNKNOWN);
  });
});
