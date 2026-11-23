import { describe, expect, it } from "vitest";
import { listMessage, planAlerts, type AlertSpec } from "@/lib/reports/alerts";
import { adaptWindowMs, MAX_WINDOW_MS, MIN_WINDOW_MS } from "@/lib/ledger/window";
import { parseCommand } from "@/lib/telegram-commands";
import { planStockRollup } from "@/lib/worker/prune";
import { parseBackupReport } from "@/lib/print/device";

const NOW = new Date("2026-11-23T04:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const HOUR = 3600_000;

describe("proactive alert episodes", () => {
  const spec = (key: string, active: boolean, repeatAfterMs?: number): AlertSpec => ({ key, active, message: key, repeatAfterMs });

  it("sends once per episode, repeats only after the interval", () => {
    expect(planAlerts([spec("printer:offline", true, HOUR)], new Map(), NOW).send).toHaveLength(1);
    const recent = new Map([["printer:offline", ago(10 * 60_000)]]);
    expect(planAlerts([spec("printer:offline", true, HOUR)], recent, NOW).send).toHaveLength(0);
    const old = new Map([["printer:offline", ago(2 * HOUR)]]);
    expect(planAlerts([spec("printer:offline", true, HOUR)], old, NOW).send).toHaveLength(1);
  });

  it("clears an episode once the condition is gone, so the next one alerts", () => {
    const plan = planAlerts([spec("printer:offline", false)], new Map([["printer:offline", ago(HOUR)]]), NOW);
    expect(plan.clear).toEqual(["printer:offline"]);
  });

  it("items that drop off a list end their episode; others are untouched", () => {
    const sent = new Map([
      ["stock:out:v1", ago(HOUR)],
      ["stock:out:v2", ago(HOUR)],
      ["printer:status", ago(HOUR)],
    ]);
    const plan = planAlerts([spec("stock:out:v1", true), spec("stock:out:v3", true)], sent, NOW, ["stock:out:"]);
    expect(plan.send.map((s) => s.key)).toEqual(["stock:out:v3"]);
    expect(plan.clear).toEqual(["stock:out:v2"]);
  });

  it("list messages count everything but show the first few", () => {
    const msg = listMessage("OUT OF STOCK", ["a", "b", "c"], 2);
    expect(msg).toBe("OUT OF STOCK (3)\n• a\n• b\n…and 1 more");
  });
});

describe("adaptive Shopee order windows", () => {
  it("halves after a tick that finished nothing, never below the minimum", () => {
    expect(adaptWindowMs(MAX_WINDOW_MS, { windowsFinished: 0, ranOutOfTime: true })).toBe(MAX_WINDOW_MS / 2);
    expect(adaptWindowMs(MIN_WINDOW_MS, { windowsFinished: 0, ranOutOfTime: true })).toBe(MIN_WINDOW_MS);
  });
  it("grows back once windows finish, never above the maximum", () => {
    expect(adaptWindowMs(MIN_WINDOW_MS, { windowsFinished: 3, ranOutOfTime: false })).toBe(MIN_WINDOW_MS * 2);
    expect(adaptWindowMs(MAX_WINDOW_MS, { windowsFinished: 1, ranOutOfTime: false })).toBe(MAX_WINDOW_MS);
    expect(adaptWindowMs(30 * 60_000, { windowsFinished: 1, ranOutOfTime: true })).toBe(30 * 60_000);
  });
});

describe("telegram commands", () => {
  it("parses commands with arguments and bot mentions", () => {
    expect(parseCommand("/order 2611ABC")).toEqual({ cmd: "order", arg: "2611ABC" });
    expect(parseCommand("/Health@KynaOpsBot")).toEqual({ cmd: "health", arg: "" });
    expect(parseCommand("  /order  ribbed top ")).toEqual({ cmd: "order", arg: "ribbed top" });
    expect(parseCommand("how many missing?")).toBeNull();
  });
});

describe("stock history rollup", () => {
  it("folds many old rows into one carried-forward row with the same total", () => {
    const cutoff = new Date("2026-05-27T00:00:00Z");
    const plan = planStockRollup(
      [
        { garmentVariantId: "v1", delta: 37, count: 120 },
        { garmentVariantId: "v2", delta: 5, count: 1 },
      ],
      cutoff
    );
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ garmentVariantId: "v1", delta: 37, sourceKey: "rollup:v1:2026-05-27" });
    expect(plan[0].createdAt.getTime()).toBeLessThan(cutoff.getTime());
  });
});

describe("agent backup report", () => {
  it("accepts a real report and ignores junk", () => {
    expect(parseBackupReport(null)).toBeNull();
    expect(parseBackupReport({ enabled: false })).toBeNull();
    const r = parseBackupReport({ enabled: true, lastBackupAt: "2026-11-22T10:00:00Z", lastBackupBytes: 52_000_000, lastBackupError: null });
    expect(r).toEqual({ lastBackupAt: new Date("2026-11-22T10:00:00Z"), lastBackupBytes: 52_000_000, lastBackupError: null });
    expect(parseBackupReport({ lastBackupAt: "nope", lastBackupBytes: -4 })).toEqual({
      lastBackupAt: null,
      lastBackupBytes: null,
      lastBackupError: null,
    });
  });
});
