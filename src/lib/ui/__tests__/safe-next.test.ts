import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/ui/safe-next";
import { manilaToUtcHm, utcToManilaHm } from "@/lib/reports/brief-time";

describe("safeNextPath", () => {
  it("keeps same-site paths with their query", () => {
    expect(safeNextPath("/returns?filter=missing")).toBe("/returns?filter=missing");
    expect(safeNextPath("/waves")).toBe("/waves");
  });

  it("sends anything off-site home", () => {
    const bad = [
      null,
      "",
      "https://evil.com",
      "//evil.com",
      "/\\evil.com",
      "/\t/evil.com",
      "javascript:alert(1)",
      "evil.com",
      "/login?next=/x",
    ];
    for (const b of bad) expect(safeNextPath(b)).toBe("/");
  });
});

describe("daily brief time", () => {
  it("converts Manila <-> UTC across midnight", () => {
    expect(manilaToUtcHm("20:00")).toBe("12:00");
    expect(manilaToUtcHm("07:30")).toBe("23:30");
    expect(utcToManilaHm("12:00")).toBe("20:00");
    expect(utcToManilaHm("23:30")).toBe("07:30");
    expect(utcToManilaHm("bad")).toBe("20:00");
  });
});
