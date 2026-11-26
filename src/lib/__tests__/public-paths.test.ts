import { describe, expect, it } from "vitest";
import { isPublicPath } from "@/lib/public-paths";

describe("isPublicPath", () => {
  it("lets the phone fetch the manifest, service worker, and every icon before sign-in", () => {
    for (const path of [
      "/manifest.webmanifest",
      "/sw.js",
      "/icon",
      "/apple-icon",
      "/icons/192.png",
      "/icons/512.png",
      "/icons/maskable-512.png",
    ]) {
      expect(isPublicPath(path), path).toBe(true);
    }
  });

  it("lets the staff scanner, stock-in, handover, and login pass Edge (routes verify PIN/owner session)", () => {
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/scan")).toBe(true);
    expect(isPublicPath("/api/scan/lookup")).toBe(true);
    expect(isPublicPath("/stock-in")).toBe(true);
    expect(isPublicPath("/api/stock-in")).toBe(true);
    expect(isPublicPath("/api/handover")).toBe(true);
    expect(isPublicPath("/api/handover-admin")).toBe(false);
  });

  it("lets the worker tick and the printer agent through (they check their own tokens)", () => {
    expect(isPublicPath("/api/worker/tick")).toBe(true);
    expect(isPublicPath("/api/agent/poll")).toBe(true);
  });

  it("lets every open app check for updates, signed in or not", () => {
    expect(isPublicPath("/api/version")).toBe(true);
    expect(isPublicPath("/api/version-admin")).toBe(false);
  });

  it("lets staff screens report browser errors, but keeps the Developer section private", () => {
    expect(isPublicPath("/api/client-errors")).toBe(true);
    expect(isPublicPath("/api/client-errors/x")).toBe(false);
    expect(isPublicPath("/dev")).toBe(false);
    expect(isPublicPath("/api/dev/overview")).toBe(false);
  });

  it("keeps the owner's printer and push controls private", () => {
    expect(isPublicPath("/api/printer")).toBe(false);
    expect(isPublicPath("/api/push/subscriptions")).toBe(false);
    expect(isPublicPath("/api/push/test")).toBe(false);
  });

  it("keeps buyer chats owner-only (they show prices)", () => {
    for (const path of [
      "/chats",
      "/chats/abc",
      "/api/chats",
      "/api/chats/unread",
      "/api/chats/abc/messages",
      "/api/chats/photos/chat-photo-1-ab.jpg",
    ]) {
      expect(isPublicPath(path), path).toBe(false);
    }
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
