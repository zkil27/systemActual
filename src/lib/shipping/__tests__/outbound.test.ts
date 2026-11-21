import { describe, expect, it } from "vitest";
import { evaluateOutboundScan, isOrderCancelledForPacking } from "@/lib/shipping/outbound";

describe("isOrderCancelledForPacking", () => {
  it("flags cancelRequested, CANCELLED, and IN_CANCEL orders", () => {
    expect(isOrderCancelledForPacking({ status: "READY_TO_SHIP", cancelRequested: true })).toBe(true);
    expect(isOrderCancelledForPacking({ status: "CANCELLED", cancelRequested: false })).toBe(true);
    expect(isOrderCancelledForPacking({ status: "in_cancel", cancelRequested: false })).toBe(true);
  });

  it("allows normal active outbound orders", () => {
    expect(isOrderCancelledForPacking({ status: "PROCESSED", cancelRequested: false })).toBe(false);
    expect(isOrderCancelledForPacking({ status: "AWAITING_COLLECTION", cancelRequested: false })).toBe(false);
  });
});

describe("evaluateOutboundScan", () => {
  const singleValid = {
    isCancelled: false,
    courier: "J&T Express",
    totalPieces: 1,
    lineCount: 1,
    alreadyPacked: false,
  };

  it("blocks cancelled orders first regardless of courier or packed state", () => {
    const res = evaluateOutboundScan(
      { ...singleValid, isCancelled: true, alreadyPacked: true },
      { courierLock: "SPX Express", autoPackSingle: true }
    );
    expect(res.status).toBe("BLOCKED_CANCELLED");
  });

  it("blocks mismatched courier when courier sack lock is active", () => {
    const res = evaluateOutboundScan(singleValid, {
      courierLock: "SPX Express",
      autoPackSingle: true,
    });
    expect(res.status).toBe("BLOCKED_WRONG_COURIER");
    expect(res.courierMismatch).toBe(true);
    expect(res.expectedCourier).toBe("SPX Express");
  });

  it("normalizes courier names and treats ALL as unlocked", () => {
    expect(
      evaluateOutboundScan(singleValid, { courierLock: "jnt", autoPackSingle: true }).status
    ).toBe("AUTO_PACK_OK");
    expect(
      evaluateOutboundScan(singleValid, { courierLock: "ALL", autoPackSingle: true }).status
    ).toBe("AUTO_PACK_OK");
  });

  it("warns when package was already packed", () => {
    const res = evaluateOutboundScan(
      { ...singleValid, alreadyPacked: true },
      { courierLock: "J&T Express", autoPackSingle: true }
    );
    expect(res.status).toBe("ALREADY_PACKED");
  });

  it("requires manual confirmation for multi-piece or multi-line orders", () => {
    expect(
      evaluateOutboundScan(
        { ...singleValid, totalPieces: 2, lineCount: 1 },
        { autoPackSingle: true }
      ).status
    ).toBe("NEEDS_MULTI_CONFIRM");

    expect(
      evaluateOutboundScan(
        { ...singleValid, totalPieces: 2, lineCount: 2 },
        { autoPackSingle: true }
      ).status
    ).toBe("NEEDS_MULTI_CONFIRM");
  });

  it("auto-packs 1-piece valid orders when autoPackSingle is enabled", () => {
    expect(evaluateOutboundScan(singleValid, { autoPackSingle: true }).status).toBe("AUTO_PACK_OK");
    expect(evaluateOutboundScan(singleValid, { autoPackSingle: false }).status).toBe("READY_TO_PACK");
  });
});
