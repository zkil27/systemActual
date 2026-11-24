import { describe, expect, it } from "vitest";
import { simulateBurst } from "../eval/simulate";

describe("sale-day burst on the free limits", () => {
  it("answers 100 chats that arrive in one minute, without crossing a daily limit", async () => {
    const r = await simulateBurst({ chats: 100, arrivalSeconds: 60, tokensIn: 2_500 });
    expect(r.answered + r.gaveUp).toBe(100);
    expect(r.answered).toBe(100);
    expect(r.overDailyLimit).toBe(0);
    // Groq takes most; Cloudflare helps when Groq's per-minute limit is hit.
    expect(Object.keys(r.byModel).some((m) => m.startsWith("openai/") || m.startsWith("qwen/"))).toBe(true);
  });

  it("stops at Cloudflare's daily neurons and Groq's daily tokens instead of going over", async () => {
    // 1,000 chats is far past a normal day (about 8 questions).
    const r = await simulateBurst({ chats: 1_000, arrivalSeconds: 600, tokensIn: 2_500, maxWaitMinutes: 20 });
    expect(r.overDailyLimit).toBe(0);
    expect(r.answered).toBeGreaterThan(0);
    expect(r.answered + r.gaveUp).toBe(1_000);
  });
});
