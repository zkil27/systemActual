import { describe, expect, it } from "vitest";
import { formatPushFromAlert, labelFromUserAgent, sanitizePushUrl } from "@/lib/push-format";
import { getVapidConfig, isPushConfigured } from "@/lib/push";

describe("formatPushFromAlert", () => {
  it("routes buyer messages to /chats and strips noisy inline URLs", () => {
    const out = formatPushFromAlert("2 new buyer messages. Open Chats: https://kyna.vercel.app/chats");
    expect(out.title).toBe("New buyer message");
    expect(out.url).toBe("/chats");
    expect(out.tag).toBe("kyna-chat");
    expect(out.body).not.toContain("https://");
    expect(out.body).toContain("2 new buyer messages");
  });

  it("routes approval alerts to /approvals", () => {
    const out = formatPushFromAlert(
      "APPROVAL NEEDED — Reply to Maria\nBuyer asked: Meron po bang large?\nOpen Approvals: https://kyna.vercel.app/approvals"
    );
    expect(out.title).toBe("Approval needed");
    expect(out.url).toBe("/approvals");
    expect(out.body).toContain("Reply to Maria");
    expect(out.body).not.toContain("https://");
  });

  it("routes wave finished & stalled alerts to /waves", () => {
    const done = formatPushFromAlert("WAVE DONE — 42 parcels\n• Printed: 42");
    expect(done.title).toBe("Wave done");
    expect(done.url).toBe("/waves");
    expect(done.body).toContain("42 parcels");

    const stalled = formatPushFromAlert("WAVE STALLED — 5 of 20 parcels haven't moved for 25 min.");
    expect(stalled.title).toBe("Wave stalled");
    expect(stalled.url).toBe("/waves");
  });

  it("routes return, stock, restock, and printer alerts to the right screens", () => {
    expect(formatPushFromAlert("RETURN ISSUE SCANNED — DAMAGED ITEM\nOrder: 123").url).toBe("/returns");
    expect(formatPushFromAlert("OUT OF STOCK (2)\n• Dress (S)").url).toBe("/items");
    expect(formatPushFromAlert("OVERDUE SUPPLIER ORDERS (1)\n• PO-1").url).toBe("/restock");
    expect(formatPushFromAlert("PRINTER PC OFFLINE — 3 label(s) waiting").url).toBe("/settings");
    expect(formatPushFromAlert("PULL CANCELLED LABEL — DO NOT SHIP\nTracking ends in: 123456").url).toBe("/waves");
  });

  it("respects explicit overrides while sanitizing unsafe URLs", () => {
    const out = formatPushFromAlert("anything", {
      title: "Custom",
      body: "Body",
      url: "https://evil.example/phish",
    });
    expect(out.title).toBe("Custom");
    expect(out.body).toBe("Body");
    expect(out.url).toBe("/");
  });
});

describe("sanitizePushUrl", () => {
  it("allows internal paths and rejects external or protocol-relative URLs", () => {
    expect(sanitizePushUrl("/chats")).toBe("/chats");
    expect(sanitizePushUrl("/returns?filter=missing")).toBe("/returns?filter=missing");
    expect(sanitizePushUrl("https://evil.com")).toBe("/");
    expect(sanitizePushUrl("//evil.com/x")).toBe("/");
    expect(sanitizePushUrl("")).toBe("/");
  });
});

describe("labelFromUserAgent", () => {
  it("produces plain-English labels for mobile and desktop browsers", () => {
    expect(labelFromUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15")).toBe(
      "iPhone"
    );
    expect(labelFromUserAgent("Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Mobile Safari/537.36")).toBe(
      "Android phone"
    );
    expect(labelFromUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0 Safari/537.36")).toBe(
      "Windows Chrome"
    );
    expect(labelFromUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/18.0 Safari/605.1.15")).toBe(
      "Mac Safari"
    );
    expect(labelFromUserAgent("")).toBe("Browser");
  });
});

describe("getVapidConfig", () => {
  it("returns null when keys are missing and falls back to default mailto subject", () => {
    expect(isPushConfigured({})).toBe(false);
    expect(getVapidConfig({ VAPID_PUBLIC_KEY: "pub" })).toBeNull();
    expect(getVapidConfig({ VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "priv" })).toEqual({
      publicKey: "pub",
      privateKey: "priv",
      subject: "mailto:ops@kyna.ph",
    });
    expect(
      getVapidConfig({
        VAPID_PUBLIC_KEY: "pub",
        VAPID_PRIVATE_KEY: "priv",
        VAPID_SUBJECT: "mailto:owner@example.com",
      })?.subject
    ).toBe("mailto:owner@example.com");
  });
});
