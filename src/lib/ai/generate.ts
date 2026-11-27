import type { OrderPanel } from "@/lib/chats/types";
import { sizeRangesOf } from "./fact-check";
import type { CatalogItem, ListingFacts } from "./listing";
import { checkReply, type CheckReason } from "./output-check";
import { buildPrompt, groundingText, hasTagalog, parseReply, replyLanguage, shopFactsText, type PromptAnswer, type PromptMessage } from "./prompt";
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

/** The reply is in the buyer's language: Taglish buyers get Tagalog words, English buyers get English. */
export function checkLanguage(
  reply: string,
  want: "English" | "Taglish"
): { ok: true } | { ok: false; reason: CheckReason; label: string } {
  if (want === "Taglish" && !hasTagalog(reply)) {
    return { ok: false, reason: "language", label: "it replied in English to a Taglish message (write it in Taglish with po)" };
  }
  if (want === "English" && replyLanguage([{ sender: "BUYER", kind: "TEXT", text: reply, card: null }]) !== "English") {
    return { ok: false, reason: "language", label: "it replied in Taglish to an English message (write it in English)" };
  }
  return { ok: true };
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
    platform?: "SHOPEE" | "TIKTOK";
    listings?: ListingFacts[];
    catalog?: CatalogItem[];
    reservePct?: number;
    /** At most this share of each daily free limit (the test run leaves room for real buyers). */
    maxShare?: number;
  },
  deps: CompletionDeps = {}
): Promise<GenerateResult> {
  const listings = input.listings ?? [];
  const catalog = input.catalog ?? [];
  const stockKnown = listings.some((l) => l.skus.some((s) => s.stock !== null));
  const lastShop = input.messages.map((m) => m.sender).lastIndexOf("SELLER");
  const buyerText = input.messages
    .slice(lastShop + 1)
    .filter((m) => m.sender === "BUYER" && m.text)
    .map((m) => m.text)
    .join("\n");
  const prompt = buildPrompt({
    answers: input.answers,
    order: input.order,
    messages: input.messages,
    platform: input.platform,
    listings,
    catalog,
  });
  const facts = groundingText({ answers: input.answers, order: input.order, messages: input.messages, listings, catalog });
  const shopFacts = shopFactsText({ answers: input.answers, order: input.order, listings, catalog, buyerText });
  const sizeRanges = sizeRangesOf(listings);
  const wantLang = replyLanguage(input.messages);
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
    const verdict = checkReply(parsed.text, {
      facts,
      shopFacts,
      stockKnown,
      buyerText,
      sizeRanges,
      orderStatus: input.order?.statusLabel ?? null,
    });
    const lang = verdict.ok ? checkLanguage(parsed.text, wantLang) : verdict;
    if (lang.ok) return { ok: true, ...parsed, usage, blocked, attempts };
    blocked.push({ reason: lang.reason, label: lang.label, text: parsed.text, usage });
  }
  return { ok: false, reason: "blocked", label: blocked[blocked.length - 1]?.label, blocked, attempts };
}
