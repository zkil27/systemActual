import { describe, expect, it } from "vitest";
import { parseThemePreference, resolveTheme } from "@/lib/ui/theme";

describe("theme helpers", () => {
  it("parseThemePreference accepts light, dark, and system and defaults invalid values to light", () => {
    expect(parseThemePreference("light")).toBe("light");
    expect(parseThemePreference("dark")).toBe("dark");
    expect(parseThemePreference("system")).toBe("system");
    expect(parseThemePreference(null)).toBe("light");
    expect(parseThemePreference("")).toBe("light");
    expect(parseThemePreference("midnight")).toBe("light");
  });

  it("resolveTheme resolves all preference and OS dark-mode combinations", () => {
    expect(resolveTheme("light", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("dark", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("system", true)).toBe("dark");
  });
});
