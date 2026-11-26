import { describe, expect, it } from "vitest";
import { activeTabIndex, BOTTOM_TABS, isMenuRoute, SIDEBAR_PRIMARY_ITEMS } from "@/lib/ui/nav";
import { fitWithin, newClientKey, timeoutSignal } from "@/lib/chats/client";

describe("owner navigation", () => {
  it("has Today, Ship, Returns, Chats in the first 4 slots and leaves Scan out of the tab bar", () => {
    expect(BOTTOM_TABS.map((t) => t.label)).toEqual(["Today", "Ship", "Returns", "Chats"]);
    expect(BOTTOM_TABS.some((t) => t.href === "/scan")).toBe(false);
  });

  it("highlights the right direct tab or the 5th Menu slot for Menu routes", () => {
    expect(activeTabIndex("/")).toBe(0);
    expect(activeTabIndex("/waves")).toBe(1);
    expect(activeTabIndex("/returns")).toBe(2);
    expect(activeTabIndex("/chats")).toBe(3);
    expect(activeTabIndex("/chats/abc")).toBe(3);
    expect(activeTabIndex("/chatsx")).toBe(-1);
    expect(activeTabIndex("/scan")).toBe(-1);

    for (const p of [
      "/items",
      "/listings",
      "/restock",
      "/approvals",
      "/profit",
      "/orders",
      "/imports",
      "/settings",
      "/settings/assistant",
    ]) {
      expect(isMenuRoute(p)).toBe(true);
      expect(activeTabIndex(p)).toBe(4);
    }
    expect(isMenuRoute("/itemsx")).toBe(false);
    expect(isMenuRoute("/")).toBe(false);
  });

  it("keeps Scan in the computer sidebar, with Chats above it", () => {
    const labels = SIDEBAR_PRIMARY_ITEMS.map((t) => t.label);
    expect(labels.indexOf("Chats")).toBeGreaterThanOrEqual(0);
    expect(labels.indexOf("Chats")).toBeLessThan(labels.indexOf("Scan"));
  });
});

describe("chat photo and key helpers", () => {
  it("shrinks big photos to 1600px on the long edge and never enlarges", () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3000, 4000)).toEqual({ width: 1200, height: 1600 });
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it("gives up on slow requests where the browser supports it", () => {
    expect(timeoutSignal(1000)).toBeInstanceOf(AbortSignal);
  });

  it("makes send keys the server accepts", () => {
    const key = newClientKey();
    expect(key).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(newClientKey()).not.toBe(key);
  });
});
