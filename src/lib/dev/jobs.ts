import type { StepTiming } from "@/lib/dev/tick-context";

/** Pure summaries for Developer › Jobs. */

export interface StepSummary {
  name: string;
  runs: number;
  avgMs: number;
  p95Ms: number;
  maxMs: number;
  errors: number;
}

export function parseSteps(raw: unknown): StepTiming[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((s) => {
    if (!s || typeof s !== "object") return [];
    const { name, ms, error } = s as Record<string, unknown>;
    if (typeof name !== "string" || typeof ms !== "number") return [];
    return [{ name, ms, ...(typeof error === "string" ? { error } : {}) }];
  });
}

/** Per step across many ticks, slowest (by p95) first. Steps named "error:*" are counted as errors only. */
export function summarizeSteps(runs: ReadonlyArray<{ steps: unknown }>): StepSummary[] {
  const byName = new Map<string, { ms: number[]; errors: number }>();
  for (const run of runs) {
    for (const s of parseSteps(run.steps)) {
      const isErrorMarker = s.name.startsWith("error:");
      const name = isErrorMarker ? s.name.slice("error:".length) : s.name;
      const entry = byName.get(name) ?? { ms: [], errors: 0 };
      if (!isErrorMarker) entry.ms.push(s.ms);
      if (s.error) entry.errors++;
      byName.set(name, entry);
    }
  }
  return [...byName.entries()]
    .map(([name, e]) => {
      const sorted = [...e.ms].sort((a, b) => a - b);
      const at = (q: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)]! : 0);
      return {
        name,
        runs: sorted.length,
        avgMs: sorted.length ? Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length) : 0,
        p95Ms: at(0.95),
        maxMs: sorted.length ? sorted[sorted.length - 1]! : 0,
        errors: e.errors,
      };
    })
    .sort((a, b) => b.p95Ms - a.p95Ms || b.errors - a.errors);
}
