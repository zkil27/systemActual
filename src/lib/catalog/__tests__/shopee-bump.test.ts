import { describe, expect, it } from "vitest";
import { parseBoostedList, parseBoostResult, pickItemsToBump } from "@/lib/catalog/shopee-bump";

describe("pickItemsToBump", () => {
  it("picks pinned items first, then rotates through remaining candidates", () => {
    const res = pickItemsToBump({
      candidateItemIds: ["101", "102", "103", "104", "105", "106", "107"],
      currentlyBoostedIds: new Set(["103"]),
      pinnedItemIds: ["106", "102"],
      cursor: 0,
      slotsAvailable: 4,
    });
    expect(res.toBump).toEqual(["106", "102", "101", "104"]);
    expect(res.nextCursor).toBe(3); // after "104" in rotating list [101, 103, 104, 105, 107]
  });

  it("wraps around from cursor without duplicating already boosted items", () => {
    const res = pickItemsToBump({
      candidateItemIds: ["1", "2", "3", "4", "5", "6"],
      currentlyBoostedIds: new Set(["5"]),
      pinnedItemIds: [],
      cursor: 4,
      slotsAvailable: 3,
    });
    expect(res.toBump).toEqual(["6", "1", "2"]);
    expect(res.nextCursor).toBe(2);
  });

  it("returns empty when all 5 slots are already full", () => {
    const res = pickItemsToBump({
      candidateItemIds: ["1", "2", "3"],
      currentlyBoostedIds: new Set(["1", "2", "3", "4", "5"]),
      pinnedItemIds: ["1"],
      cursor: 1,
      slotsAvailable: 0,
    });
    expect(res.toBump).toEqual([]);
  });
});

describe("Shopee bump response parsers", () => {
  it("parses get_boosted_list items and cooldown end times", () => {
    const now = new Date("2026-11-21T04:00:00Z");
    const items = parseBoostedList(
      {
        item_list: [
          { item_id: 3200139749, cool_down_second: 3600 },
          { item_id: 3200139750, cool_down_second: 0 },
        ],
      },
      now
    );
    expect(items).toEqual([
      {
        itemId: "3200139749",
        cooldownSecond: 3600,
        endsAt: "2026-11-21T05:00:00.000Z",
      },
    ]);
  });

  it("handles both array and object-wrapped success_list from boost_item", () => {
    expect(
      parseBoostResult({
        success_list: [111, 222],
        failure_list: [{ item_id: 333, failed_reason: "item is already boosted" }],
      })
    ).toEqual({
      succeeded: ["111", "222"],
      failed: [{ itemId: "333", reason: "item is already boosted" }],
    });

    expect(
      parseBoostResult({
        success_list: { item_id_list: [444] },
        failure_list: [],
      })
    ).toEqual({
      succeeded: ["444"],
      failed: [],
    });
  });
});
