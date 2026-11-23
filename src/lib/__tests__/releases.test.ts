import { describe, expect, it } from "vitest";
import { LATEST_RELEASE_ID, RELEASES } from "@/lib/releases";

describe("RELEASES", () => {
  it("lists newest first with unique, strictly decreasing ids", () => {
    for (let i = 1; i < RELEASES.length; i++) {
      expect(RELEASES[i].id, `entry ${i}`).toBeLessThan(RELEASES[i - 1].id);
    }
    expect(LATEST_RELEASE_ID).toBe(RELEASES[0]?.id ?? 0);
  });

  it("gives every release a date, title and at least one change", () => {
    for (const r of RELEASES) {
      expect(r.date, `release ${r.id}`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.title.trim(), `release ${r.id}`).not.toBe("");
      expect(r.changes.length, `release ${r.id}`).toBeGreaterThan(0);
      for (const c of r.changes) expect(c.trim(), `release ${r.id}`).not.toBe("");
    }
  });
});
