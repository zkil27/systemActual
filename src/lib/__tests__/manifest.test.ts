import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";

describe("web app manifest", () => {
  const m = manifest();

  it("opens as a standalone app scoped to the whole site", () => {
    expect(m.display).toBe("standalone");
    expect(m.start_url).toBe("/");
    expect(m.scope).toBe("/");
    expect(m.id).toBe("/");
  });

  it("ships the 192 and 512 PNG icons Android needs to install", () => {
    const sizes = (m.icons ?? []).filter((i) => i.purpose === "any").map((i) => i.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
    expect((m.icons ?? []).every((i) => i.type === "image/png")).toBe(true);
  });

  it("includes a maskable icon", () => {
    expect((m.icons ?? []).some((i) => i.purpose === "maskable")).toBe(true);
  });

  it("serves every icon from a public path", () => {
    for (const icon of m.icons ?? []) {
      expect(icon.src.startsWith("/icons/")).toBe(true);
    }
  });
});
