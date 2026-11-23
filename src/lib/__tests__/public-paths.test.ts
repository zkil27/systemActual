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

  it("lets the worker tick and the printer agent through (they check their own tokens)", () => {
    expect(isPublicPath("/api/worker/tick")).toBe(true);
    expect(isPublicPath("/api/agent/poll")).toBe(true);
  });

  it("lets every open app check for updates, signed in or not", () => {
    expect(isPublicPath("/api/version")).toBe(true);
    expect(isPublicPath("/api/version-admin")).toBe(false);
  });

  it("keeps the owner's printer controls private", () => {
    expect(isPublicPath("/api/printer")).toBe(false);
  });

  it("protects owner pages and raw /uploads/ paths while letting authenticated proof route pass Edge", () => {
    for (const path of ["/", "/returns", "/settings", "/imports", "/api/dashboard", "/api/returns/abc", "/uploads/return-proof-1.jpg"]) {
      expect(isPublicPath(path), path).toBe(false);
    }
    expect(isPublicPath("/api/proofs/return-proof-1.jpg")).toBe(true);
  });

  it("does not treat lookalike paths as the exact icon routes", () => {
    expect(isPublicPath("/icon-admin")).toBe(false);
    expect(isPublicPath("/apple-icon/secret")).toBe(false);
  });
});
