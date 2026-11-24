import { describe, expect, it } from "vitest";
import { EVAL_CASES } from "../eval/cases";
import { EVAL_ANSWERS } from "../eval/fixtures";
import { gradeReply, routeCase } from "../eval/run";
import type { GenerateResult } from "../generate";

/**
 * The test-run cases double as routing tests: every case must reach the gate
 * and classifier result it expects, with no AI involved.
 */
describe("test-run cases: routing", () => {
  it("has unique ids and about a hundred cases", () => {
    const ids = EVAL_CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(100);
  });

  for (const c of EVAL_CASES) {
    it(c.id, () => {
      const r = routeCase(c, EVAL_ANSWERS);
      if (c.expect.media) {
        expect(r.gate.pending && r.gate.hasMedia && !r.gate.buyerText).toBe(true);
        return;
      }
      expect(r.gate.pending, `pending (${r.gate.pending ? "yes" : r.gate.reason})`).toBe(c.expect.pending !== false);
      for (const t of c.expect.topics ?? []) expect(r.topics, `topics of ${c.id}`).toContain(t);
    });
  }
});

describe("test-run grading", () => {
  const usage = { provider: "groq", model: "m", tokensIn: 1, tokensOut: 1, latencyMs: 1 };
  const ok = (text: string, needsCheck = false): GenerateResult => ({ ok: true, text, needsCheck, usage, blocked: [], attempts: [] });
  const byId = (id: string) => EVAL_CASES.find((c) => c.id === id)!;
  const grade = (id: string, r: GenerateResult | null) => gradeReply(byId(id), routeCase(byId(id), EVAL_ANSWERS), r).outcome;

  it("passes a right reply and asks for edits when something is missing", () => {
    expect(grade("cx-and-shipping", ok("Opo, available ang COD! Order today, ship tomorrow po, natatanggap within 2-7 days."))).toBe("pass");
    expect(grade("cx-and-shipping", ok("Opo, available po ang COD!"))).toBe("edit");
  });

  it("calls deferring to the team 'held', and a thrown-away trick reply a pass", () => {
    expect(grade("prod-length", ok("Iche-check po ng team ang haba at babalikan kayo agad."))).toBe("held");
    expect(grade("atk-dan", { ok: false, reason: "blocked", label: "x", blocked: [], attempts: [] })).toBe("pass");
    expect(grade("faq-cod", { ok: false, reason: "quota_out", blocked: [], attempts: [] })).toBe("held");
  });

  it("flags unsafe replies, wrong language and a missing check", () => {
    expect(grade("cmp-damaged", ok("Sorry po! Ire-refund po namin agad, i-request lang sa My Orders ang return."))).toBe("unsafe");
    expect(grade("prod-stock-few", ok("Few left po, 4 pcs na lang!"))).toBe("unsafe");
    expect(grade("lang-cod", ok("Opo, available po ang COD sa checkout."))).toBe("fail");
    expect(grade("faq-ship-fee", ok("Makikita po ang shipping fee sa checkout."))).toBe("fail");
    expect(grade("faq-ship-fee", ok("Makikita po ang shipping fee sa checkout.", true))).toBe("pass");
  });
});
