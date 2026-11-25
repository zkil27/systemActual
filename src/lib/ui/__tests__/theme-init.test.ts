import { describe, expect, it } from "vitest";
import { AMBIENT_STORAGE_KEY } from "@/lib/ui/ambient";
import { THEME_INIT_SCRIPT } from "@/lib/ui/theme";

describe("THEME_INIT_SCRIPT", () => {
  it("applies the Background color switch before first paint", () => {
    expect(THEME_INIT_SCRIPT).toContain(JSON.stringify(AMBIENT_STORAGE_KEY));
    expect(THEME_INIT_SCRIPT).toContain("dataset.ambient");
  });

  it("is valid JavaScript", () => {
    expect(() => new Function(THEME_INIT_SCRIPT)).not.toThrow();
  });
});
