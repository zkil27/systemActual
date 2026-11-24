/**
 * Chats assistant test run: about 100 buyer chats through the real prompt,
 * the free AI services and the reply checks, graded automatically, plus a
 * sale-day burst simulation. Writes a report and prints a summary.
 *
 * Usage (with .env pointing at the real database, which counts AI use):
 *   npm run ai:eval                       # every case + the burst simulation
 *   npm run ai:eval -- --group attack     # one group
 *   npm run ai:eval -- --only faq-cod,cx-burst
 *   npm run ai:eval -- --sim              # only the simulation (no AI calls)
 *   npm run ai:eval -- --live-answers     # use the shop answers saved in Settings
 *   npm run ai:eval -- --max-share 0.3    # use at most 30% of each daily free limit (default 50%)
 *
 * The cases contain no real buyer details. Real buyers keep the rest of the
 * daily free limits: the run stops using a service at --max-share.
 */
import { writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { prisma } from "../src/lib/prisma";
import { EVAL_CASES, type EvalCase } from "../src/lib/ai/eval/cases";
import { EVAL_ANSWERS } from "../src/lib/ai/eval/fixtures";
import { runCase, type CaseResult, type Outcome } from "../src/lib/ai/eval/run";
import { simulateBurst } from "../src/lib/ai/eval/simulate";
import { activeShopAnswers } from "../src/lib/ai/settings-store";
import { configuredProviders } from "../src/lib/ai/providers/catalog";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const OUTCOMES: Outcome[] = ["pass", "edit", "held", "fail", "unsafe", "skip_ok"];
const LABEL: Record<Outcome, string> = {
  pass: "Ready to send",
  edit: "Needs an edit",
  held: "Held back (safe)",
  fail: "Wrong",
  unsafe: "UNSAFE",
  skip_ok: "Correctly skipped",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "-");

async function runAll(cases: EvalCase[], maxShare: number, liveAnswers: boolean) {
  const answers = liveAnswers ? await activeShopAnswers() : EVAL_ANSWERS;
  const results: CaseResult[] = [];
  for (const [i, c] of cases.entries()) {
    let r = await runCase(c, answers, { maxShare });
    // Busy for a minute (per-minute token limits): wait and try again, up to ~3 minutes.
    for (let wait = 0; r.graded.outcome === "held" && r.graded.notes.includes("quota_out") && wait < 6; wait++) {
      await sleep(30_000);
      r = await runCase(c, answers, { maxShare });
    }
    results.push(r);
    const u = r.usage ? ` ${r.usage.model} ${r.usage.latencyMs}ms` : "";
    console.log(`[${i + 1}/${cases.length}] ${r.graded.outcome.padEnd(7)} ${c.id}${u}${r.graded.notes.length ? `  (${r.graded.notes.join("; ")})` : ""}`);
  }
  return results;
}

function report(results: CaseResult[], sims: Array<{ label: string; r: Awaited<ReturnType<typeof simulateBurst>> }>, meta: string[]) {
  const lines: string[] = ["# Chats assistant test run", "", ...meta, ""];
  if (results.length) {
    const answerable = results.filter((r) => r.graded.outcome !== "skip_ok" && !(r.graded.outcome === "fail" && !r.route.pending));
    const count = (o: Outcome, list = results) => list.filter((r) => r.graded.outcome === o).length;
    const lat = results.map((r) => r.usage?.latencyMs).filter((n): n is number => n !== undefined).sort((a, b) => a - b);
    const tokens = results.map((r) => r.usage?.tokensIn).filter((n): n is number => n !== undefined);
    lines.push(
      "## Summary",
      "",
      `- Cases: ${results.length} (${answerable.length} with a question to answer)`,
      `- **Ready to send: ${count("pass", answerable)} of ${answerable.length} (${pct(count("pass", answerable), answerable.length)})**`,
      `- Safe (ready, needs an edit, or held back): ${pct(answerable.length - count("unsafe", answerable) - count("fail", answerable), answerable.length)}`,
      `- Unsafe replies shown: ${count("unsafe")}`,
      `- Answered free by shop answers (no AI): ${results.filter((r) => r.route.templateCovers).length}`,
      `- Replies thrown away by the checks: ${results.reduce((n, r) => n + r.blockedCount, 0)}`,
      `- AI time per reply: median ${lat[Math.floor(lat.length / 2)] ?? 0} ms, slowest ${lat[lat.length - 1] ?? 0} ms`,
      `- Prompt size: about ${tokens.length ? Math.round(tokens.reduce((a, b) => a + b, 0) / tokens.length) : 0} tokens`,
      "",
      "| Outcome | Cases |",
      "|---|---|",
      ...OUTCOMES.map((o) => `| ${LABEL[o]} | ${count(o)} |`),
      "",
      "## By group",
      "",
      "| Group | Ready | Edit | Held | Wrong | Unsafe | Skipped ok |",
      "|---|---|---|---|---|---|---|"
    );
    const groups = [...new Set(results.map((r) => r.group))];
    for (const g of groups) {
      const list = results.filter((r) => r.group === g);
      lines.push(`| ${g} | ${count("pass", list)} | ${count("edit", list)} | ${count("held", list)} | ${count("fail", list)} | ${count("unsafe", list)} | ${count("skip_ok", list)} |`);
    }
    const models: Record<string, number> = {};
    for (const r of results) if (r.usage) models[r.usage.model] = (models[r.usage.model] ?? 0) + 1;
    lines.push("", "Answered by: " + Object.entries(models).map(([m, n]) => `${m} ${n}`).join(", "), "");
    lines.push("## Every case that wasn't ready to send", "");
    for (const r of results.filter((x) => x.graded.outcome !== "pass" && x.graded.outcome !== "skip_ok")) {
      const c = EVAL_CASES.find((x) => x.id === r.id)!;
      const asked = c.chat.map((t) => (typeof t === "string" ? t : "card" in t ? `[product: ${t.card}]` : "shop" in t ? `[shop: ${t.shop}]` : "photo" in t ? "[photo]" : "holding" in t ? "[Duoke wait]" : `[${t.system}]`)).join(" / ");
      lines.push(`### ${LABEL[r.graded.outcome]}: ${r.id}`, `- Buyer: ${asked}`, `- Reply: ${r.graded.reply ?? "(none shown)"}${r.graded.needsCheck ? " [needs your check]" : ""}`, `- Why: ${r.graded.notes.join("; ") || "-"}`, "");
    }
  }
  if (sims.length) {
    lines.push("## Sale-day burst (simulated, real free limits)", "", "| Burst | Answered | Gave up (owner answers) | Wait p50 | Wait p90 | Longest | Over a daily limit |", "|---|---|---|---|---|---|---|");
    for (const { label, r } of sims) {
      lines.push(`| ${label} | ${r.answered} | ${r.gaveUp} | ${r.waitMinutes.p50} min | ${r.waitMinutes.p90} min | ${r.waitMinutes.max} min | ${r.overDailyLimit} |`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

async function main() {
  const maxShare = Number(value("max-share") ?? 0.5);
  const only = value("only")?.split(",");
  const group = value("group");
  const simOnly = flag("sim");
  const cases = EVAL_CASES.filter((c) => (!only || only.includes(c.id)) && (!group || c.group === group));
  const meta = [
    `- Run: ${new Date().toISOString()}`,
    `- Shop answers: ${flag("live-answers") ? "saved in Settings" : "fixed copy (2026-11-24)"}`,
    `- AI services: ${configuredProviders().map((p) => p.spec.label).join(", ") || "none"}; at most ${Math.round(maxShare * 100)}% of each daily free limit`,
  ];

  let results: CaseResult[] = [];
  if (!simOnly) {
    if (!configuredProviders().length) throw new Error("No AI service is set up. Add GROQ_API_KEY to .env.");
    console.log(`Running ${cases.length} cases...`);
    results = await runAll(cases, maxShare, flag("live-answers"));
  }

  const sims: Array<{ label: string; r: Awaited<ReturnType<typeof simulateBurst>> }> = [];
  if (simOnly || (!only && !group)) {
    for (const [label, chats, secs] of [
      ["20 chats in 1 min", 20, 60],
      ["50 chats in 1 min", 50, 60],
      ["100 chats in 1 min", 100, 60],
      ["300 chats in 30 min", 300, 1800],
    ] as const) {
      sims.push({ label, r: await simulateBurst({ chats, arrivalSeconds: secs, tokensIn: 2_500 }) });
    }
  }

  const md = report(results, sims, meta);
  const file = path.join(os.tmpdir(), `kyna-ai-eval-${new Date().toISOString().replace(/[:.]/g, "-")}.md`);
  writeFileSync(file, md);
  const summaryEnd = md.indexOf("## Every case");
  console.log("\n" + (summaryEnd > 0 ? md.slice(0, summaryEnd) : md));
  if (sims.length && summaryEnd > 0) console.log(md.slice(md.indexOf("## Sale-day")));
  console.log(`Full report: ${file}`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
