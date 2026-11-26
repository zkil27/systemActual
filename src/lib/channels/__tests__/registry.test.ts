import { Platform } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { getChannelConnector, listChannelConnectors } from "../registry";

describe("channel connector registry", () => {
  it("provides a connector for every Platform enum member", () => {
    const platforms = Object.values(Platform);
    const list = listChannelConnectors();
    expect(list.map((c) => c.platform).sort()).toEqual([...platforms].sort());

    for (const p of platforms) {
      const c = getChannelConnector(p);
      expect(c.platform).toBe(p);
      expect(c.label.length).toBeGreaterThan(0);
    }
  });
});
