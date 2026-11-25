import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { actorFromSession, auditRow, changedFields, systemActor } from "@/lib/audit";

describe("actorFromSession", () => {
  it("names staff, scanner-owner and owner sessions", () => {
    expect(actorFromSession({ actorType: "staff", staffId: "s1", name: "Ana" })).toEqual({ type: "STAFF", id: "s1", name: "Ana" });
    expect(actorFromSession({ actorType: "owner", userId: "u1", name: "Kyna" })).toEqual({ type: "OWNER", id: "u1", name: "Kyna" });
    expect(actorFromSession({ role: "owner", userId: "u1", name: "Kyna" })).toEqual({ type: "OWNER", id: "u1", name: "Kyna" });
  });
  it("labels the app's own changes", () => {
    expect(systemActor("waves")).toEqual({ type: "SYSTEM", id: null, name: "system:waves" });
  });
});

describe("changedFields", () => {
  const keys = ["wavesAutoEnabled", "defaultUnitCostPhp", "missingSinceAt"] as const;

  it("keeps only what changed, comparing Decimals and Dates by value", () => {
    const at = new Date("2026-11-26T00:00:00Z");
    const diff = changedFields(
      { wavesAutoEnabled: false, defaultUnitCostPhp: new Prisma.Decimal("82.00"), missingSinceAt: at },
      { wavesAutoEnabled: true, defaultUnitCostPhp: new Prisma.Decimal("82.00"), missingSinceAt: new Date(at) },
      keys
    );
    expect(diff).toEqual({ before: { wavesAutoEnabled: false }, after: { wavesAutoEnabled: true } });
  });

  it("is null when nothing changed", () => {
    expect(changedFields({ wavesAutoEnabled: true }, { wavesAutoEnabled: true }, keys)).toBeNull();
  });

  it("treats a first save as a change from nothing", () => {
    expect(changedFields(null, { wavesAutoEnabled: true }, ["wavesAutoEnabled"])).toEqual({
      before: { wavesAutoEnabled: null },
      after: { wavesAutoEnabled: true },
    });
  });
});

describe("auditRow", () => {
  it("stores plain JSON and trims long names", () => {
    const at = new Date("2026-11-26T00:00:00Z");
    const row = auditRow({
      actor: { type: "OWNER", id: "u1", name: "x".repeat(200) },
      action: "return.resolve",
      entity: "ReturnParcel",
      entityId: "p1",
      after: { resolvedAt: at },
      at,
    });
    expect(row.actorName).toHaveLength(120);
    expect(row.after).toEqual({ resolvedAt: "2026-11-26T00:00:00.000Z" });
    expect(row.before).toBe(Prisma.JsonNull);
  });
});
