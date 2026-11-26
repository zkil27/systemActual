import { describe, expect, it } from "vitest";
import {
  filterPickerOptions,
  stepActiveIndex,
  type PickerOption,
} from "@/lib/ui/option-picker";

const OPTIONS: PickerOption[] = [
  {
    value: "",
    label: "All sizes & colours",
    description: "53 variants",
    trailing: "₱199",
    keywords: "all sizes colours variants",
    pinned: true,
  },
  {
    value: "v1",
    label: "Hera #1, 2XL (37-40)",
    description: "TikTok · 12 on shelf",
    trailing: "₱199",
    keywords: "TikTok kynatiktok 1 listing",
  },
  {
    value: "v2",
    label: "Hera #10, M (26-29)",
    description: "Shopee, TikTok (2 listings) · 4 on shelf",
    trailing: "₱189 / ₱199",
    keywords: "Shopee TikTok 2 listings",
  },
  {
    value: "v3",
    label: "Hera #12, L (30-33)",
    description: "Shopee · 0 on shelf",
    trailing: "No price",
    disabled: true,
  },
];

describe("filterPickerOptions", () => {
  it("returns all options when query is blank", () => {
    expect(filterPickerOptions(OPTIONS, "")).toHaveLength(4);
    expect(filterPickerOptions(OPTIONS, "   ")).toHaveLength(4);
  });

  it("matches multi-token queries case-insensitively across fields", () => {
    const res = filterPickerOptions(OPTIONS, "hera 2xl");
    expect(res.map((o) => o.value)).toEqual(["v1"]);
  });

  it("matches hidden keywords and trailing values", () => {
    expect(filterPickerOptions(OPTIONS, "shopee").map((o) => o.value)).toEqual(["v2", "v3"]);
    expect(filterPickerOptions(OPTIONS, "189").map((o) => o.value)).toEqual(["v2"]);
  });

  it("returns empty array when no option matches all tokens", () => {
    expect(filterPickerOptions(OPTIONS, "hera small")).toEqual([]);
  });
});

describe("stepActiveIndex", () => {
  it("steps forward and wraps around while skipping disabled options", () => {
    expect(stepActiveIndex(OPTIONS, -1, 1)).toBe(0);
    expect(stepActiveIndex(OPTIONS, 0, 1)).toBe(1);
    expect(stepActiveIndex(OPTIONS, 2, 1)).toBe(0);
  });

  it("steps backward and wraps around while skipping disabled options", () => {
    expect(stepActiveIndex(OPTIONS, 0, -1)).toBe(2);
    expect(stepActiveIndex(OPTIONS, 2, -1)).toBe(1);
    expect(stepActiveIndex(OPTIONS, -1, -1)).toBe(2);
  });

  it("returns -1 for empty or all-disabled lists", () => {
    expect(stepActiveIndex([], 0, 1)).toBe(-1);
    expect(
      stepActiveIndex([{ value: "a", label: "A", disabled: true }], 0, 1)
    ).toBe(-1);
  });
});
