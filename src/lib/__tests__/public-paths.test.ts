import { describe, expect, it } from "vitest";
import { isPublicPath } from "@/lib/public-paths";

describe("isPublicPath", () => {
  it("lets the phone fetch the manifest and every icon before sign-in", () => {
    for (const path of [
      "/manifest.webmanifest",
      "/icon",
      "/apple-icon",
      "/icons/192.png",
      "/icons/512.png",
      "/icons/maskable-512.png",
    ]) {
      expect(isPublicPath(path), path).toBe(true);
    }
  });

  it("keeps the staff scanner and login public", () => {
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/scan")).toBe(true);
    expect(isPublicPath("/api/scan/lookup")).toBe(true);
    expect(isPublicPath("/stock-in")).toBe(true);
    expect(isPublicPath("/api/stock-in")).toBe(true);
  });

  it("lets the worker tick through (it checks WORKER_SECRET itself)", () => {
    expect(isPublicPath("/api/worker/tick")).toBe(true);
  });

  it("protects owner pages and owner APIs", () => {
    for (const path of ["/", "/returns", "/settings", "/imports", "/api/dashboard", "/api/returns/abc"]) {
      expect(isPublicPath(path), path).toBe(false);
    }
  });

  it("does not treat lookalike paths as the exact icon routes", () => {
    expect(isPublicPath("/icon-admin")).toBe(false);
    expect(isPublicPath("/apple-icon/secret")).toBe(false);
  });
});
