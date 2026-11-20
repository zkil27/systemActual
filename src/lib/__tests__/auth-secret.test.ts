import { describe, expect, it } from "vitest";
import { resolveAuthSecret } from "@/lib/auth-secret";

const good = "x".repeat(40);

describe("AUTH_SECRET has no fallback", () => {
  it("throws when missing or blank", () => {
    expect(() => resolveAuthSecret(undefined, "development")).toThrow(/not set/);
    expect(() => resolveAuthSecret("   ", "production")).toThrow(/not set/);
  });

  it("throws when shorter than 32 characters", () => {
    expect(() => resolveAuthSecret("short", "development")).toThrow(/32/);
  });

  it("rejects the old example placeholder in production only", () => {
    const placeholder = "kyna-ops-dev-secret-change-in-production-32chars";
    expect(() => resolveAuthSecret(placeholder, "production")).toThrow(/placeholder/);
    expect(resolveAuthSecret(placeholder, "development")).toBe(placeholder);
  });

  it("returns a valid secret", () => {
    expect(resolveAuthSecret(good, "production")).toBe(good);
  });
});
