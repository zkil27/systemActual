import { PrintJobKind } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    waveItem: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

import { buildHandoverManifestLines } from "@/lib/print/handover";
import { HANDOVER_PREFIX, renderJobPdf } from "@/lib/print/render";

describe("buildHandoverManifestLines", () => {
  it("formats courier summary, paired tracking numbers, and rider signature lines within 4x6 bounds", () => {
    const pages = buildHandoverManifestLines(
      {
        courier: "J&T Express",
        totalPrinted: 5,
        packedCount: 4,
        handedOverCount: 2,
        awaitingPickupCount: 2,
        cancelledCount: 1,
        trackingNumbers: ["JT10001", "JT10002", "JT10003", "JT10004"],
      },
      "Nov 23, 2026 4:00 PM"
    );

    expect(pages).toHaveLength(1);
    expect(pages[0][0]).toBe("Page 1/1");
    expect(pages[0].some((l) => l.includes("RIDER HANDOVER MANIFEST"))).toBe(true);
    expect(pages[0].some((l) => l.includes("Courier: J&T EXPRESS"))).toBe(true);
    expect(pages[0].some((l) => l.includes("Total parcels: 4 (4 packed)"))).toBe(true);
    expect(pages[0].some((l) => l.includes("Cancelled excluded: 1"))).toBe(true);
    expect(pages[0].some((l) => l.includes("1. JT10001"))).toBe(true);
    expect(pages[0].some((l) => l.includes("2. JT10002"))).toBe(true);
    expect(pages[0].some((l) => l.includes("Rider Name:"))).toBe(true);
    expect(pages.flat().every((l) => l.length <= 44)).toBe(true);
  });

  it("paginates cleanly over 25 lines when there are many tracking numbers", () => {
    const pages = buildHandoverManifestLines(
      {
        courier: "SPX Express",
        totalPrinted: 60,
        packedCount: 60,
        handedOverCount: 0,
        awaitingPickupCount: 60,
        cancelledCount: 0,
        trackingNumbers: Array.from({ length: 60 }, (_, i) => `SPXPH00${100 + i}`),
      },
      "Nov 23, 2026 4:00 PM"
    );

    expect(pages.length).toBeGreaterThan(1);
    expect(pages[0][0]).toBe(`Page 1/${pages.length}`);
    expect(pages.every((p) => p.length <= 25)).toBe(true);
  });
});

describe("renderJobPdf handover slip", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders a valid PDF when PrintJobKind.PICK_LIST has HANDOVER: prefix", async () => {
    mockPrisma.waveItem.findMany.mockResolvedValue([
      {
        package: {
          trackingNumber: "SPX123456",
          packedAt: new Date(),
          carrier: "SPX Express",
          order: {
            orderSn: "ORD-1",
            platform: "SHOPEE",
            status: "PROCESSED",
            shippedAt: null,
            cancelRequested: false,
          },
        },
      },
    ]);

    const buf = await renderJobPdf({
      kind: PrintJobKind.PICK_LIST,
      title: `${HANDOVER_PREFIX}SPX Express`,
      createdAt: new Date("2026-11-23T08:00:00Z"),
      waveId: null,
      packageId: null,
      batchPackageIds: [],
    });

    expect(buf.subarray(0, 8).toString("latin1")).toBe("%PDF-1.4");
  });
});
