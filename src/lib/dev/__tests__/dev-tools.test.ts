import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isDeveloperEmail, parseDeveloperEmails } from "@/lib/dev/access";
import { isMissingTableError } from "@/lib/dev/db-errors";
import { fingerprintError, hash32, normalizeRoute, normalizeText, topFrame } from "@/lib/dev/errors";
import { addApiCall, classifyApiUrl, hourBucket, stepName, TickRecorder, type ApiCallBucket } from "@/lib/dev/tick-context";
import { parseSteps, summarizeSteps } from "@/lib/dev/jobs";
import { assessDevOverview, formatBytes, type DevOverviewInput } from "@/lib/dev/overview";
import { checkEnv, ENV_SPECS } from "@/lib/dev/env-check";
import { RETENTION_RULES } from "@/lib/dev/retention-map";
import { compareMigrations } from "@/lib/dev/db-health";
import { activeMaintenance, parseMaintenanceNotice } from "@/lib/ops-notice";
import { shouldIgnoreClientError } from "@/lib/client-errors";

describe("developer allowlist", () => {
  it("parses a comma list, lowercased, ignoring junk", () => {
    expect(parseDeveloperEmails(" Dev@Example.com , ,nope, b@x.co ")).toEqual(["dev@example.com", "b@x.co"]);
    expect(parseDeveloperEmails(undefined)).toEqual([]);
  });

  it("matches case-insensitively and lets nobody in when the list is empty", () => {
    const allow = parseDeveloperEmails("dev@example.com");
    expect(isDeveloperEmail("DEV@example.com ", allow)).toBe(true);
    expect(isDeveloperEmail("owner@example.com", allow)).toBe(false);
    expect(isDeveloperEmail("dev@example.com", [])).toBe(false);
    expect(isDeveloperEmail(null, allow)).toBe(false);
  });
});

describe("missing-table detection", () => {
  it("recognises Prisma and Postgres codes for a migration that isn't applied", () => {
    expect(isMissingTableError({ code: "P2021" })).toBe(true);
    expect(isMissingTableError({ code: "P2022" })).toBe(true);
    expect(isMissingTableError(new Error('relation "AppError" does not exist'))).toBe(true);
    expect(isMissingTableError(new Error("connection refused"))).toBe(false);
  });
});

describe("error fingerprints", () => {
  it("groups the same bug with different ids and numbers", () => {
    const a = fingerprintError({ source: "server", message: "Order 2411ABC123 not found for shop 12345", route: "/api/orders/ckx1abc2def3ghi4jkl5mno6p" });
    const b = fingerprintError({ source: "server", message: "Order 2411ZZZ999 not found for shop 67890", route: "/api/orders/ckz9zyx8wvu7tsr6qpo5nml4k" });
    expect(a).toBe(b);
  });

  it("keeps different sources, messages and code locations apart", () => {
    const base = { source: "server" as const, message: "boom", route: "/x" };
    expect(fingerprintError(base)).not.toBe(fingerprintError({ ...base, source: "client" }));
    expect(fingerprintError(base)).not.toBe(fingerprintError({ ...base, message: "bang" }));
    const s1 = "Error: boom\n    at load (/app/src/lib/a.ts:10:5)";
    const s2 = "Error: boom\n    at save (/app/src/lib/b.ts:10:5)";
    expect(fingerprintError({ ...base, stack: s1 })).not.toBe(fingerprintError({ ...base, stack: s2 }));
  });

  it("ignores line numbers and build chunk hashes so a redeploy doesn't split a group", () => {
    const f1 = topFrame("Error: x\n    at Foo (https://app/_next/static/chunks/page-1a2b3c4d5e6f.js:1:2345)");
    const f2 = topFrame("Error: x\n    at Foo (https://app/_next/static/chunks/page-9f8e7d6c5b4a.js:1:999)");
    expect(f1).toBe(f2);
    expect(topFrame("Error: x\n    at node_modules/lib.js:1:1\n    at mine (/src/a.ts:3:4)")).toBe("at mine /src/a.ts");
  });

  it("normalises text and routes", () => {
    expect(normalizeText('Shop "Kyna PH" failed 3 times')).toBe("Shop <str> failed <n> times");
    expect(normalizeRoute("/returns/ckx1abc2def3ghi4/edit?x=1")).toBe("/returns/<id>/edit");
    expect(normalizeRoute("/settings")).toBe("/settings");
    expect(normalizeRoute(null)).toBeNull();
    expect(hash32("abc")).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("tick recorder", () => {
  it("classifies marketplace URLs by platform, shop and endpoint", () => {
    expect(classifyApiUrl("https://partner.shopeemobile.com/api/v2/order/get_order_list?shop_id=123&sign=x")).toEqual({
      platform: "SHOPEE",
      shopKey: "123",
      pathKey: "/api/v2/order/get_order_list",
    });
    expect(classifyApiUrl("https://open-api.tiktokglobalshop.com/order/202309/orders/search?shop_cipher=ROW_abc")).toEqual({
      platform: "TIKTOK",
      shopKey: "ROW_abc",
      pathKey: "/order/<v>/orders/search",
    });
    expect(classifyApiUrl("https://api.telegram.org/bot1/sendMessage")).toBeNull();
    expect(classifyApiUrl("not a url")).toBeNull();
  });

  it("adds calls into hourly buckets with errors and 429s counted apart", () => {
    const map = new Map<string, ApiCallBucket>();
    const at = new Date("2026-11-27T03:25:10Z");
    const url = "https://partner.shopeemobile.com/api/v2/x?shop_id=1";
    addApiCall(map, url, 200, 120, at);
    addApiCall(map, url, 429, 30, at);
    addApiCall(map, url, 500, 50, at);
    addApiCall(map, url, null, 15_000, at);
    addApiCall(map, url, 200, 10, new Date("2026-11-27T04:00:00Z"));
    const buckets = [...map.values()];
    expect(buckets).toHaveLength(2);
    expect(buckets[0]).toMatchObject({ calls: 4, throttled: 1, errors: 2, totalMs: 15_200 });
    expect(buckets[0]!.hour.toISOString()).toBe("2026-11-27T03:00:00.000Z");
    expect(hourBucket(at).toISOString()).toBe("2026-11-27T03:00:00.000Z");
  });

  it("records steps and counts failed ones", () => {
    const rec = new TickRecorder();
    rec.step(stepName("worker.tick.shopee"), 1234.6);
    rec.step("waves", 10, "boom");
    expect(rec.steps).toEqual([{ name: "shopee", ms: 1235 }, { name: "waves", ms: 10, error: "boom" }]);
    expect(rec.errors).toBe(1);
  });
});

describe("step summary", () => {
  it("ranks steps by p95 and counts error markers without skewing timings", () => {
    const runs = [
      { steps: [{ name: "shopee", ms: 100 }, { name: "waves", ms: 5 }] },
      { steps: [{ name: "shopee", ms: 300 }, { name: "error:waves", ms: 0, error: "x" }] },
      { steps: [{ name: "shopee", ms: 200 }, { name: "waves", ms: 15, error: "y" }] },
      { steps: "garbage" },
    ];
    const s = summarizeSteps(runs);
    expect(s.map((x) => x.name)).toEqual(["shopee", "waves"]);
    expect(s[0]).toMatchObject({ runs: 3, avgMs: 200, p95Ms: 300, maxMs: 300, errors: 0 });
    expect(s[1]).toMatchObject({ runs: 2, avgMs: 10, errors: 2 });
    expect(parseSteps([{ name: 1 }, null, { name: "a", ms: 2 }])).toEqual([{ name: "a", ms: 2 }]);
  });
});

describe("overview cards", () => {
  const now = new Date("2026-11-27T10:00:00Z");
  const base: DevOverviewInput = {
    now,
    dbBytes: 100 * 1024 * 1024,
    dbQuotaBytes: 500 * 1024 * 1024,
    errors24h: 0,
    newErrorGroups24h: 0,
    lastRun: { startedAt: new Date(now.getTime() - 60_000), durationMs: 8_000, ok: true },
    tickBudgetMs: 90_000,
    failedEvents: 0,
    stuckEvents: 0,
    lastBackupAt: new Date(now.getTime() - 3600_000),
    backupError: null,
    pendingMigrations: 0,
    tokens: [],
    workerPaused: false,
    maintenanceOn: false,
    throttled24h: 0,
  };
  const level = (i: DevOverviewInput, id: string) => assessDevOverview(i).find((c) => c.id === id)?.level;

  it("is all green on a healthy system", () => {
    expect(assessDevOverview(base).every((c) => c.level === "ok")).toBe(true);
  });

  it("warns at 70% of the database quota and alarms at 90%", () => {
    expect(level({ ...base, dbBytes: 360 * 1024 * 1024 }, "db")).toBe("warn");
    expect(level({ ...base, dbBytes: 460 * 1024 * 1024 }, "db")).toBe("bad");
  });

  it("flags a paused or stale worker, new error kinds and pending migrations", () => {
    expect(level({ ...base, workerPaused: true }, "tick")).toBe("bad");
    expect(level({ ...base, lastRun: { ...base.lastRun!, startedAt: new Date(now.getTime() - 40 * 60_000) } }, "tick")).toBe("bad");
    expect(level({ ...base, lastRun: { ...base.lastRun!, durationMs: 85_000 } }, "tick")).toBe("warn");
    expect(level({ ...base, errors24h: 3, newErrorGroups24h: 0 }, "errors")).toBe("warn");
    expect(level({ ...base, errors24h: 3, newErrorGroups24h: 1 }, "errors")).toBe("bad");
    expect(level({ ...base, pendingMigrations: 2 }, "migrations")).toBe("bad");
    expect(level({ ...base, failedEvents: 1 }, "events")).toBe("bad");
    expect(level({ ...base, lastBackupAt: null }, "backup")).toBe("warn");
  });

  it("formats bytes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(5.5 * 1024 * 1024)).toBe("5.5 MB");
  });
});

describe("env check", () => {
  it("reports names only, set or not", () => {
    const status = checkEnv({ DATABASE_URL: "postgres://x", AUTH_SECRET: "  " });
    expect(status.find((s) => s.name === "DATABASE_URL")?.set).toBe(true);
    expect(status.find((s) => s.name === "AUTH_SECRET")?.set).toBe(false);
    expect(status).toHaveLength(ENV_SPECS.length);
    expect(JSON.stringify(status)).not.toContain("postgres://x");
  });
});

describe("retention map", () => {
  it("lists every Prisma model, so new tables get a retention decision", () => {
    const schema = readFileSync(join(process.cwd(), "prisma", "schema.prisma"), "utf8");
    const models = [...schema.matchAll(/^model (\w+) \{/gm)].map((m) => m[1]!);
    expect(models.length).toBeGreaterThan(10);
    expect(models.filter((m) => !RETENTION_RULES[m])).toEqual([]);
  });
});

describe("migration status", () => {
  it("lists pending, failed and unknown migrations", () => {
    const s = compareMigrations(
      ["0_init", "2_b", "3_c"],
      [
        { name: "0_init", finished: true, rolledBack: false },
        { name: "2_b", finished: false, rolledBack: false },
        { name: "9_newer", finished: true, rolledBack: false },
      ]
    );
    expect(s.pending).toEqual(["2_b", "3_c"]);
    expect(s.failed).toEqual(["2_b"]);
    expect(s.unknown).toEqual(["9_newer"]);
  });
});

describe("maintenance notice", () => {
  const now = new Date("2026-11-27T10:00:00Z");
  it("shows while set and hides after its end time", () => {
    expect(activeMaintenance("  Updating  ", null, now)).toEqual({ message: "Updating", until: null });
    expect(activeMaintenance("Updating", new Date("2026-11-27T09:00:00Z"), now)).toBeNull();
    expect(activeMaintenance("", null, now)).toBeNull();
  });

  it("parses the /api/version field defensively", () => {
    expect(parseMaintenanceNotice({ maintenance: { message: "Hi", until: "2026-11-27T11:00:00Z" } }, now)).toEqual({
      message: "Hi",
      until: "2026-11-27T11:00:00.000Z",
    });
    expect(parseMaintenanceNotice({ maintenance: null }, now)).toBeNull();
    expect(parseMaintenanceNotice({ maintenance: { message: 3 } }, now)).toBeNull();
    expect(parseMaintenanceNotice("nope", now)).toBeNull();
  });
});

describe("client error filter", () => {
  it("drops deploy chunk errors, extension noise and aborted requests", () => {
    expect(shouldIgnoreClientError("ChunkLoadError: Loading chunk 12 failed.", null)).toBe(true);
    expect(shouldIgnoreClientError("ResizeObserver loop limit exceeded", null)).toBe(true);
    expect(shouldIgnoreClientError("TypeError: x is undefined", "at y (chrome-extension://abc/x.js:1:1)")).toBe(true);
    expect(shouldIgnoreClientError("AbortError: The user aborted a request.", null)).toBe(true);
    expect(shouldIgnoreClientError("TypeError: Cannot read properties of undefined (reading 'id')", null)).toBe(false);
  });
});

describe("owner health shows developer switches", () => {
  it("says background sync is paused and that maintenance is on", async () => {
    const { assessHealth } = await import("@/lib/health");
    const now = new Date("2026-11-27T10:00:00Z");
    const summary = assessHealth({
      now,
      shops: [],
      workerLockedUntil: now,
      workerRunning: false,
      printer: null,
      queuedJobs: 0,
      failedJobs24h: 0,
      runningWave: false,
      workerPaused: true,
      maintenanceMessage: "Updating",
    });
    expect(summary.checks.find((c) => c.id === "worker")).toMatchObject({ level: "bad" });
    expect(summary.checks.find((c) => c.id === "maintenance")).toMatchObject({ level: "warn", detail: "Updating" });
    expect(summary.level).toBe("bad");
  });
});
