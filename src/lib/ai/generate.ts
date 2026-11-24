import type { OrderPanel } from "@/lib/chats/types";
import type { ListingFacts } from "./listing";
import { checkReply, type CheckReason } from "./output-check";
import { buildPrompt, groundingText, parseReply, shopFactsText, type PromptAnswer, type PromptMessage } from "./prompt";
import { complete, type Attempt, type CompletionDeps } from "./providers";

/**
 * Asks the AI for the shop's next reply, checks it, and retries once with the
 * reason when it breaks a rule. No database writes: the button (suggest.ts)
 * and the test run (scripts/ai-eval.ts) both use this.
 */

export interface ReplyUsage {
  provider: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
}

export interface BlockedReply {
  reason: CheckReason;
  label: string;
  text: string;
  usage: ReplyUsage;
}

export type GenerateResult =
  | { ok: true; text: string; needsCheck: boolean; usage: ReplyUsage; blocked: BlockedReply[]; attempts: Attempt[] }
  | {
      ok: false;
      reason: "no_keys" | "quota_out" | "failed" | "blocked";
      /** Why the last reply was thrown away (reason "blocked"). */
      label?: string;
      blocked: BlockedReply[];
      attempts: Attempt[];
    };

export async function generateReply(
  input: {
    answers: PromptAnswer[];
    order: OrderPanel | null;
    messages: PromptMessage[];
    listings?: ListingFacts[];
    reservePct?: number;
    /** At most this share of each daily free limit (the test run leaves room for real buyers). */
    maxShare?: number;
  },
  deps: CompletionDeps = {}
): Promise<GenerateResult> {
  const listings = input.listings ?? [];
  const stockKnown = listings.some((l) => l.skus.some((s) => s.stock !== null));
  const prompt = buildPrompt({ answers: input.answers, order: input.order, messages: input.messages, listings });
  const facts = groundingText({ answers: input.answers, order: input.order, messages: input.messages, listings });
  const shopFacts = shopFactsText({ answers: input.answers, order: input.order, listings });
  const blocked: BlockedReply[] = [];
  const attempts: Attempt[] = [];

  for (let attempt = 0; attempt < 2; attempt++) {
    const retry =
      attempt === 0
        ? []
        : [{ role: "user" as const, content: `Your reply was rejected because ${blocked[blocked.length - 1].label}. Write a new reply that follows every rule.` }];
    const result = await complete(
      { messages: [...prompt, ...retry], privacy: "private", reservePct: input.reservePct, maxShare: input.maxShare },
      deps
    );
    attempts.push(...result.attempts);
    if (!result.ok) {
      // A rejected first reply explains more than "the AI didn't answer".
      if (attempt > 0) return { ok: false, reason: "blocked", label: blocked[blocked.length - 1].label, blocked, attempts };
      const reason = result.reason === "no_keys" || result.reason === "no_private" ? "no_keys" : result.reason;
      return { ok: false, reason, blocked, attempts };
    }
    const usage: ReplyUsage = {
      provider: result.provider,
      model: result.model,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      latencyMs: result.latencyMs,
    };
    const parsed = parseReply(result.text);
    const verdict = checkReply(parsed.text, { facts, shopFacts, stockKnown });
    if (verdict.ok) return { ok: true, ...parsed, usage, blocked, attempts };
    blocked.push({ reason: verdict.reason, label: verdict.label, text: parsed.text, usage });
  }
  return { ok: false, reason: "blocked", label: blocked[blocked.length - 1]?.label, blocked, attempts };
}
