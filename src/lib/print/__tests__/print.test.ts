import { PrintJobStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { buildPdf, pdfEscape } from "@/lib/print/pdf";
import { bearerDeviceToken, hashDeviceToken, isOnline, newDeviceToken } from "@/lib/print/device";
import { applyReport } from "@/lib/print/jobs";
import { isBriefDue } from "@/lib/reports/daily-brief";

describe("buildPdf", () => {
  it("writes a valid single-page 4x6 PDF with correct object offsets", () => {
    const pdf = buildPdf([["Hello (world)", "Kyna Ops"]]);
    const text = pdf.toString("latin1");
    expect(text.startsWith("%PDF-1.4\n")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(text).toContain("/MediaBox [0 0 288 432]");
    expect(text).toContain("(Hello \\(world\\)) Tj");

    // Every xref offset must point at "N 0 obj".
    const xrefAt = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(xrefAt, xrefAt + 4)).toBe("xref");
    const entries = text.slice(xrefAt).split("\n").slice(3).filter((l) => / 00000 n $/.test(l));
    entries.forEach((line, i) => {
      const offset = Number(line.slice(0, 10));
      expect(text.slice(offset).startsWith(`${i + 1} 0 obj`)).toBe(true);
    });
  });

  it("supports several pages", () => {
    const text = buildPdf([["page 1"], ["page 2"], ["page 3"]]).toString("latin1");
    expect(text).toContain("/Count 3");
  });

  it("keeps Filipino Latin-1 letters and replaces characters it can't show", () => {
    expect(pdfEscape("Niña \\ 😀")).toBe("Niña \\\\ ?");
  });
});

describe("printer device token", () => {
  it("is long and random, and only its hash is stored", () => {
    const a = newDeviceToken();
    const b = newDeviceToken();
    expect(a.token).toMatch(/^kpd_[A-Za-z0-9_-]{32}$/);
    expect(a.token).not.toBe(b.token);
    expect(a.hash).toBe(hashDeviceToken(a.token));
    expect(a.hash).not.toContain(a.token);
  });

  it("reads only well-formed device bearer tokens", () => {
    const { token } = newDeviceToken();
    expect(bearerDeviceToken(`Bearer ${token}`)).toBe(token);
    expect(bearerDeviceToken(token)).toBeNull();
    expect(bearerDeviceToken("Bearer some-worker-secret-value-123456")).toBeNull();
    expect(bearerDeviceToken(null)).toBeNull();
  });

  it("is online only if seen in the last 2 minutes", () => {
    const now = new Date("2026-11-21T02:00:00Z");
    expect(isOnline(new Date(now.getTime() - 60_000), now)).toBe(true);
    expect(isOnline(new Date(now.getTime() - 3 * 60_000), now)).toBe(false);
    expect(isOnline(null, now)).toBe(false);
  });
});

describe("print job reports", () => {
  const now = new Date();
  const printing = { status: PrintJobStatus.PRINTING, deviceId: "pc1" };

  it("marks printed or failed", () => {
    expect(applyReport(printing, "pc1", { status: "PRINTED" }, now)).toEqual({
      ok: true,
      data: { status: PrintJobStatus.PRINTED, printedAt: now, error: null },
    });
    const failed = applyReport(printing, "pc1", { status: "FAILED", error: "Paper out" }, now);
    expect(failed).toEqual({ ok: true, data: { status: PrintJobStatus.FAILED, error: "Paper out" } });
  });

  it("rejects reports from another PC or for a job that was requeued or finished", () => {
    expect(applyReport(printing, "other-pc", { status: "PRINTED" }, now).ok).toBe(false);
    expect(applyReport({ status: PrintJobStatus.QUEUED, deviceId: null }, "pc1", { status: "PRINTED" }, now).ok).toBe(false);
    expect(applyReport({ status: PrintJobStatus.PRINTED, deviceId: "pc1" }, "pc1", { status: "FAILED", error: "x" }, now).ok).toBe(false);
  });
});

describe("daily brief timing", () => {
  // "12:00" UTC = 8:00 PM Manila
  it("is due once, on the first tick at or after 8 PM Manila", () => {
    expect(isBriefDue(new Date("2026-11-21T11:59:00Z"), "12:00", null)).toBe(false); // 7:59 PM
    expect(isBriefDue(new Date("2026-11-21T12:00:00Z"), "12:00", null)).toBe(true); // 8:00 PM
    expect(isBriefDue(new Date("2026-11-21T14:30:00Z"), "12:00", "2026-11-20")).toBe(true); // 10:30 PM, sent yesterday
    expect(isBriefDue(new Date("2026-11-21T14:30:00Z"), "12:00", "2026-11-21")).toBe(false); // already sent today
  });

  it("does not resend after midnight Manila for the previous day", () => {
    // 00:30 Nov 22 Manila: new Manila day, but before 8 PM
    expect(isBriefDue(new Date("2026-11-21T16:30:00Z"), "12:00", "2026-11-21")).toBe(false);
  });
});
