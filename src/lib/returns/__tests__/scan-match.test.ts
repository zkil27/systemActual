import { describe, expect, it } from "vitest";
import { resolveScanMatch } from "@/lib/returns/scan-match";
import { costAtRiskPhp } from "@/lib/returns/rules";

const p = (id: string, received = false) => ({ id, physicallyReceivedAt: received ? new Date() : null });

describe("resolveScanMatch", () => {
  it("opens the parcel when exactly one matches", () => {
    expect(resolveScanMatch([p("a")], [])).toEqual({ kind: "one", parcel: p("a") });
  });

  it("asks staff to pick when several match exactly, unscanned first", () => {
    const res = resolveScanMatch([p("scanned", true), p("open")], []);
    expect(res.kind).toBe("pick");
    if (res.kind === "pick") expect(res.parcels.map((x) => x.id)).toEqual(["open", "scanned"]);
  });

  it("accepts last digits only when they point to one parcel", () => {
    expect(resolveScanMatch([], [p("only")])).toEqual({ kind: "one", parcel: p("only") });
    expect(resolveScanMatch([], [p("a"), p("b")])).toEqual({ kind: "ambiguous" });
  });

  it("exact matches win over suffix matches", () => {
    expect(resolveScanMatch([p("exact")], [p("x"), p("y")])).toEqual({ kind: "one", parcel: p("exact") });
  });

  it("reports nothing found", () => {
    expect(resolveScanMatch([], [])).toEqual({ kind: "none" });
  });
});

describe("costAtRiskPhp", () => {
  it("adds the return shipping estimate to the item cost", () => {
    expect(costAtRiskPhp({ estimatedUnitCostPhp: 164, expectsPhysicalReturn: true }, 40)).toBe(204);
  });
  it("refund-only returns lose the item but pay no return shipping", () => {
    expect(costAtRiskPhp({ estimatedUnitCostPhp: 82, expectsPhysicalReturn: false }, 40)).toBe(82);
  });
});
