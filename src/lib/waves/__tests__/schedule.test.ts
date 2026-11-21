import { describe, expect, it } from "vitest";
import { dueWaveSlot, nextWaveAt, parseWaveTimes, retryUpdate } from "@/lib/waves/schedule";
import { waveDoneMessage } from "@/lib/waves/run";

// Manila = UTC+8. 08:30 Manila on Nov 21 = 00:30Z.
const manila = (hhmm: string, day = "2026-11-21") => new Date(`${day}T${hhmm}:00+08:00`);
const times = ["08:30", "12:30", "15:30"];

describe("parseWaveTimes", () => {
  it("keeps valid HH:MM, sorted, without duplicates", () => {
    expect(parseWaveTimes(" 15:30,08:30, 12:30 ,8:30, 25:00, 12:30")).toEqual(["08:30", "12:30", "15:30"]);
    expect(parseWaveTimes("")).toEqual([]);
  });
});

describe("dueWaveSlot", () => {
  it("fires at the wave time, once", () => {
    expect(dueWaveSlot(manila("08:29"), times, null)).toBeNull();
    expect(dueWaveSlot(manila("08:30"), times, null)).toBe("2026-11-21 08:30");
    expect(dueWaveSlot(manila("08:31"), times, "2026-11-21 08:30")).toBeNull();
  });

  it("still starts if the PC came on a bit late, but not hours later", () => {
    expect(dueWaveSlot(manila("09:45"), times, "2026-11-20 15:30")).toBe("2026-11-21 08:30");
    expect(dueWaveSlot(manila("10:31"), times, "2026-11-20 15:30")).toBeNull();
  });

  it("missed slots don't stack up: only the latest one runs", () => {
    expect(dueWaveSlot(manila("13:00"), ["08:30", "12:30"], "2026-11-20 12:30")).toBe("2026-11-21 12:30");
  });

  it("yesterday's slot doesn't block today's", () => {
    expect(dueWaveSlot(manila("08:30"), times, "2026-11-20 08:30")).toBe("2026-11-21 08:30");
  });
});

describe("nextWaveAt", () => {
  it("later today, or the first time tomorrow", () => {
    expect(nextWaveAt(manila("10:00"), times)?.toISOString()).toBe(manila("12:30").toISOString());
    expect(nextWaveAt(manila("16:00"), times)?.toISOString()).toBe(manila("08:30", "2026-11-22").toISOString());
    expect(nextWaveAt(manila("10:00"), [])).toBeNull();
  });
});

describe("retryUpdate", () => {
  it("a parcel that may have shipped keeps its lock and 'we asked' marker", () => {
    const u = retryUpdate({ activePackageId: "pkg1", packageId: "pkg1" });
    expect(u).toEqual({ status: "READY", attempts: 0, error: null, nextAttemptAt: null, docRequestedAt: null });
    expect(u).not.toHaveProperty("shipRequestedAt");
  });

  it("a parcel the shop clearly refused is locked again with a clean slate", () => {
    expect(retryUpdate({ activePackageId: null, packageId: "pkg2" })).toMatchObject({
      status: "READY",
      activePackageId: "pkg2",
      shipRequestedAt: null,
    });
  });
});

describe("waveDoneMessage", () => {
  it("says what printed and what needs attention", () => {
    const msg = waveDoneMessage({ trigger: "SCHEDULED", startedAt: manila("08:30") }, { PRINTED: 409, FAILED: 3, SKIPPED_CANCELLED: 2 });
    expect(msg).toContain("WAVE DONE (scheduled");
    expect(msg).toContain("Printed: 409");
    expect(msg).toContain("Cancelled before shipping: 2");
    expect(msg).toContain("NEED ATTENTION: 3");
    expect(waveDoneMessage({ trigger: "MANUAL", startedAt: null }, { PRINTED: 5 })).not.toContain("ATTENTION");
  });
});
