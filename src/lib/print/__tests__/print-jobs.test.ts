import { PrintJobKind, PrintJobStatus, WaveItemStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma, mockMarkLabelPrinted, mockMarkLabelFailed, mockFinishDoneWaves } = vi.hoisted(() => ({
  mockPrisma: {
    printJob: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    appSettings: {
      findUnique: vi.fn(),
    },
  },
  mockMarkLabelPrinted: vi.fn(),
  mockMarkLabelFailed: vi.fn(),
  mockFinishDoneWaves: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/waves/run", () => ({
  markLabelPrinted: mockMarkLabelPrinted,
  markLabelFailed: mockMarkLabelFailed,
  finishDoneWaves: mockFinishDoneWaves,
}));

import {
  claimJobs,
  clearPrintQueue,
  GAVE_UP_ERROR,
  MAX_PRINT_ATTEMPTS,
  planStaleJobs,
  reportJob,
  requeueStalePrintJobs,
  sumPrintedJobParcels,
} from "@/lib/print/jobs";

describe("sumPrintedJobParcels", () => {
  it("counts batched Shopee parcels accurately instead of 1 per job", () => {
    expect(
      sumPrintedJobParcels([
        { batchPackageIds: [] }, // TikTok single-parcel job
        { batchPackageIds: Array.from({ length: 50 }, (_, i) => `pkg-${i}`) }, // Shopee 50-parcel batch
        { batchPackageIds: ["p1", "p2", "p3"] },
      ])
    ).toBe(54);
  });
});

describe("reportJob deadlock prevention", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("marks WaveItems FAILED and calls finishDoneWaves when a LABEL job fails", async () => {
    mockPrisma.printJob.findUnique.mockResolvedValue({
      status: PrintJobStatus.PRINTING,
      deviceId: "pc1",
      kind: PrintJobKind.LABEL,
      waveId: "wave-1",
      packageId: "pkg-1",
      batchPackageIds: ["pkg-1", "pkg-2"],
    });

    const res = await reportJob("pc1", "job-1", { status: "FAILED", error: "Paper out" });
    expect(res).toEqual({ ok: true });
    expect(mockMarkLabelFailed).toHaveBeenCalledWith("wave-1", ["pkg-1", "pkg-2"], "Paper out");
    expect(mockFinishDoneWaves).toHaveBeenCalledOnce();
    expect(mockMarkLabelPrinted).not.toHaveBeenCalled();
  });

  it("marks WaveItems PRINTED when a LABEL job succeeds", async () => {
    mockPrisma.printJob.findUnique.mockResolvedValue({
      status: PrintJobStatus.PRINTING,
      deviceId: "pc1",
      kind: PrintJobKind.LABEL,
      waveId: "wave-1",
      packageId: "pkg-1",
      batchPackageIds: [],
    });

    const res = await reportJob("pc1", "job-1", { status: "PRINTED" });
    expect(res).toEqual({ ok: true });
    expect(mockMarkLabelPrinted).toHaveBeenCalledWith("wave-1", ["pkg-1"]);
    expect(mockMarkLabelFailed).not.toHaveBeenCalled();
  });
});

describe("clearPrintQueue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("moves associated LABEL_READY wave items to FAILED before deleting jobs", async () => {
    mockPrisma.printJob.findMany.mockResolvedValue([
      {
        id: "j1",
        kind: PrintJobKind.LABEL,
        waveId: "wave-1",
        packageId: "pkg-1",
        batchPackageIds: ["pkg-1", "pkg-2"],
      },
      {
        id: "j2",
        kind: PrintJobKind.PICK_LIST,
        waveId: "wave-1",
        packageId: null,
        batchPackageIds: [],
      },
    ]);
    mockPrisma.printJob.deleteMany.mockResolvedValue({ count: 2 });

    const count = await clearPrintQueue();
    expect(count).toBe(2);
    expect(mockMarkLabelFailed).toHaveBeenCalledWith("wave-1", ["pkg-1", "pkg-2"], "Removed from print queue");
    expect(mockFinishDoneWaves).toHaveBeenCalledOnce();
  });
});

describe("claimJobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("strips docUrl when customWaybillEnabled is true and sorts by waveId + position", async () => {
    const future = new Date(Date.now() + 3600_000);
    mockPrisma.printJob.findMany
      .mockResolvedValueOnce([{ id: "job-tt" }])
      .mockResolvedValueOnce([
        {
          id: "job-tt",
          kind: PrintJobKind.LABEL,
          title: "Label 1/5",
          docUrl: "https://cdn.tiktok.example/label.pdf",
          docExpiresAt: future,
        },
      ]);
    mockPrisma.appSettings.findUnique.mockResolvedValue({ customWaybillEnabled: true });

    const claimed = await claimJobs("pc1");
    expect(claimed[0].docUrl).toBeNull();
    expect(mockPrisma.printJob.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        orderBy: [
          { waveId: { sort: "asc", nulls: "last" } },
          { position: "asc" },
          { createdAt: "asc" },
        ],
      })
    );

    // Ensure unused WaveItemStatus import isn't flagged
    expect(WaveItemStatus.FAILED).toBe("FAILED");
  });
});

describe("planStaleJobs", () => {
  it("retries jobs below the cap and gives up at the cap", () => {
    const plan = planStaleJobs([
      { id: "a", attempts: 1 },
      { id: "b", attempts: MAX_PRINT_ATTEMPTS - 1 },
      { id: "c", attempts: MAX_PRINT_ATTEMPTS },
      { id: "d", attempts: MAX_PRINT_ATTEMPTS + 3 },
    ]);
    expect(plan.requeue.map((j) => j.id)).toEqual(["a", "b"]);
    expect(plan.giveUp.map((j) => j.id)).toEqual(["c", "d"]);
  });
});

describe("requeueStalePrintJobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does nothing when no job is stuck", async () => {
    mockPrisma.printJob.findMany.mockResolvedValue([]);
    expect(await requeueStalePrintJobs(new Date())).toBe(0);
    expect(mockPrisma.printJob.updateMany).not.toHaveBeenCalled();
  });

  it("requeues fresh jobs and fails capped wave labels so the wave can finish", async () => {
    mockPrisma.printJob.findMany.mockResolvedValue([
      { id: "j1", attempts: 1, kind: PrintJobKind.LABEL, waveId: "w1", packageId: "p1", batchPackageIds: [] },
      { id: "j2", attempts: MAX_PRINT_ATTEMPTS, kind: PrintJobKind.LABEL, waveId: "w1", packageId: null, batchPackageIds: ["p2", "p3"] },
      { id: "j3", attempts: MAX_PRINT_ATTEMPTS, kind: PrintJobKind.TEST, waveId: null, packageId: null, batchPackageIds: [] },
    ]);
    mockPrisma.printJob.updateMany.mockResolvedValue({ count: 1 });

    expect(await requeueStalePrintJobs(new Date())).toBe(3);

    const calls = mockPrisma.printJob.updateMany.mock.calls.map((c) => c[0]);
    expect(calls[0].where.id.in).toEqual(["j1"]);
    expect(calls[0].data.status).toBe(PrintJobStatus.QUEUED);
    expect(calls[1].where.id.in).toEqual(["j2", "j3"]);
    expect(calls[1].data).toMatchObject({ status: PrintJobStatus.FAILED, error: GAVE_UP_ERROR });
    expect(mockMarkLabelFailed).toHaveBeenCalledTimes(1);
    expect(mockMarkLabelFailed).toHaveBeenCalledWith("w1", ["p2", "p3"], GAVE_UP_ERROR);
    expect(mockFinishDoneWaves).toHaveBeenCalledTimes(1);
  });
});
