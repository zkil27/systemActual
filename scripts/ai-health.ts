/**
 * Checks the free AI services for the Chats assistant: which keys are set,
 * whether each model answers, and how much of today's free use is left.
 *
 * Usage (with .env pointing at the real database):
 *   npm run ai:health            # one tiny test question per model (counts as one request each)
 *   npm run ai:health -- --usage # only show today's use, no calls
 *
 * The test question has no buyer details. Keys are never printed.
 */
import { prisma } from "../src/lib/prisma";
import { configuredProviders, providerKeyStatus, PROVIDERS, type ConfiguredProvider } from "../src/lib/ai/providers/catalog";
import { allowanceShare, providerDayBounds, providerDayKey } from "../src/lib/ai/providers/clock";
import { prismaUsageStore, SHARED_MODEL, takeBudget } from "../src/lib/ai/providers/ledger";
import { callChat } from "../src/lib/ai/providers/openai-compatible";

const usageOnly = process.argv.includes("--usage");

function pad(s: string | number, n: number) {
  return String(s).padEnd(n);
}

async function reservePct(): Promise<number> {
  const row = await prisma.aiSettings.findUnique({ where: { id: "default" } }).catch(() => null);
  return row?.eveningReservePct ?? 15;
}

async function check(p: ConfiguredProvider, reserve: number) {
  for (const model of p.models) {
    const now = new Date();
    const budget = await takeBudget({ provider: p, model, estimateIn: 40, estimateOut: 20 + (model.thinkingTokens ?? 0), reservePct: reserve, now, store: prismaUsageStore });
    if (!budget.ok) {
      console.log(`  ${pad(model.model, 34)} skipped: no free use left (${budget.reason})`);
      continue;
    }
    const res = await callChat({
      provider: p,
      model,
      messages: [{ role: "user", content: "Reply with just the word OK." }],
      maxTokens: 20,
      temperature: 0,
      timeoutMs: 15_000,
    });
    if (res.ok) {
      await prismaUsageStore.addTokens(budget.key, { tokensIn: res.tokensIn, tokensOut: res.tokensOut, cachedTokens: res.cachedTokens });
      const answered = res.model !== model.model ? ` via ${res.model}` : "";
      console.log(`  ${pad(model.model, 34)} OK   ${pad(res.latencyMs + " ms", 9)} "${res.text.slice(0, 30)}"${answered}`);
    } else {
      await prismaUsageStore.addError(budget.key);
      console.log(`  ${pad(model.model, 34)} FAIL ${res.kind}${res.status ? ` (${res.status})` : ""} ${res.detail ?? ""}`);
    }
  }
}

async function usage(p: ConfiguredProvider, reserve: number) {
  const now = new Date();
  const dayKey = providerDayKey(p.spec.dayZone, now);
  const share = allowanceShare(p.spec.dayZone, reserve, now);
  const resets = providerDayBounds(p.spec.dayZone, now).end;
  const rows = await prismaUsageStore.read(p.spec.id, dayKey);
  const resetsAt = new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit" }).format(resets);
  console.log(`  day ${dayKey}, resets ${resetsAt} Manila${share < 1 ? `, ${Math.round((1 - share) * 100)}% held for tonight` : ""}`);
  const byModel = new Map(p.models.map((m) => [m.model, m]));
  let neurons = 0;
  for (const r of rows) {
    const m = byModel.get(r.model);
    if (m?.unitsPerMIn || m?.unitsPerMOut) neurons += (r.tokensIn * (m.unitsPerMIn ?? 0) + r.tokensOut * (m.unitsPerMOut ?? 0)) / 1e6;
    const caps = [
      m?.requestsPerDay ? `${r.requests}/${m.requestsPerDay} req` : `${r.requests} req`,
      m?.tokensPerDay ? `${r.tokensIn + r.tokensOut}/${m.tokensPerDay} tokens` : `${r.tokensIn + r.tokensOut} tokens`,
      r.errors ? `${r.errors} errors` : "",
    ].filter(Boolean);
    const label = r.model === SHARED_MODEL ? "(all models)" : r.model;
    console.log(`  ${pad(label, 34)} ${caps.join(", ")}`);
  }
  if (p.spec.shared?.unitsPerDay) console.log(`  neurons ${Math.round(neurons)}/${p.spec.shared.unitsPerDay}`);
  if (rows.length === 0) console.log("  nothing used yet today");
}

async function main() {
  const keys = providerKeyStatus();
  const providers = configuredProviders();
  const reserve = await reservePct();

  console.log("Keys:");
  for (const id of Object.keys(PROVIDERS) as Array<keyof typeof PROVIDERS>) {
    const live = providers.some((p) => p.spec.id === id);
    const note = keys[id] && !live ? "  (set, but the Cloudflare account id should be 32 letters/numbers)" : "";
    console.log(`  ${pad(PROVIDERS[id].label, 11)} ${keys[id] ? "set" : "not set"}${note}`);
  }
  if (providers.length === 0) {
    console.log("\nNo AI service is set up yet. Add at least GROQ_API_KEY to .env (see .env.example).");
    return;
  }
  if (keys.groq) console.log("  Reminder: in the Groq console, Settings > Data Controls, turn on Zero Data Retention.");

  for (const p of providers) {
    console.log(`\n${p.spec.label}${p.spec.privateOk ? "" : " (general questions only, never buyer details)"}`);
    if (!usageOnly) await check(p, reserve);
    await usage(p, reserve);
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
