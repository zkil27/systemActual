import { describe, expect, it } from "vitest";
import {
  buildApprovalInlineKeyboard,
  canDecideActionRequest,
  formatApprovalTelegramCard,
  parseApprovalCallbackData,
} from "../rules";

describe("parseApprovalCallbackData", () => {
  it("parses valid approve and reject callback tokens", () => {
    expect(parseApprovalCallbackData("ar:approve:cm12345678")).toEqual({
      action: "approve",
      id: "cm12345678",
    });
    expect(parseApprovalCallbackData("ar:reject:req_abcdef_99")).toEqual({
      action: "reject",
      id: "req_abcdef_99",
    });
  });

  it("rejects malformed or unknown callbacks", () => {
    expect(parseApprovalCallbackData("")).toBeNull();
    expect(parseApprovalCallbackData("ar:delete:cm12345678")).toBeNull();
    expect(parseApprovalCallbackData("ar:approve:short")).toBeNull();
    expect(parseApprovalCallbackData("other:approve:cm12345678")).toBeNull();
  });
});

describe("canDecideActionRequest", () => {
  it("allows PENDING before expiry and rejects decided or expired rows", () => {
    const now = new Date("2026-11-26T12:00:00.000Z");
    const future = new Date("2026-11-27T12:00:00.000Z");
    const past = new Date("2026-11-26T11:59:00.000Z");

    expect(canDecideActionRequest("PENDING", future, now)).toEqual({ ok: true });
    expect(canDecideActionRequest("PENDING", null, now)).toEqual({ ok: true });
    expect(canDecideActionRequest("PENDING", past, now)).toEqual({
      ok: false,
      reason: "This approval expired.",
    });
    expect(canDecideActionRequest("DONE", future, now)).toEqual({
      ok: false,
      reason: "Already done.",
    });
  });
});

describe("Telegram approval cards and inline buttons", () => {
  it("formats a readable card and two 1-tap inline buttons", () => {
    const text = formatApprovalTelegramCard({
      title: "Reply to kkkeewl",
      buyerName: "kkkeewl",
      topic: "size",
      buyerPreview: "Kasya po ba sa M?",
      replyText: "Yes po, kasya sa medium!",
      needsCheck: true,
      baseUrl: "https://kyna-ops.example.com/",
    });
    expect(text).toContain("APPROVAL NEEDED — Reply to kkkeewl");
    expect(text).toContain("(Needs your check)");
    expect(text).toContain("https://kyna-ops.example.com/approvals");

    const kb = buildApprovalInlineKeyboard("req_12345678");
    expect(kb.inline_keyboard[0]).toEqual([
      { text: "Approve & send", callback_data: "ar:approve:req_12345678" },
      { text: "Reject", callback_data: "ar:reject:req_12345678" },
    ]);
  });
});
