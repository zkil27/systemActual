import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Who changed what. One row per owner/staff action and per change the app
 * makes by itself, shown in a parcel's history. Never holds buyer details.
 */

export type AuditActorType = "OWNER" | "STAFF" | "SYSTEM";

export interface AuditActor {
  type: AuditActorType;
  id: string | null;
  name: string;
}

export interface AuditInput {
  actor: AuditActor;
  /** Dotted verb, e.g. "return.scan", "return.resolve", "shop.writes". */
  action: string;
  entity: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  at?: Date;
}

/**
 * Only the fields that changed, as { before, after }, comparing by value
 * (Decimals and Dates as text). Null when nothing changed.
 */
export function changedFields(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown>,
  keys: readonly string[]
): { before: Record<string, unknown>; after: Record<string, unknown> } | null {
  const show = (v: unknown) => (v instanceof Date ? v.toISOString() : v === null || v === undefined ? null : typeof v === "object" ? String(v) : v);
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const k of keys) {
    const was = show(before?.[k]);
    const now = show(after[k]);
    if (JSON.stringify(was) === JSON.stringify(now)) continue;
    b[k] = was;
    a[k] = now;
  }
  return Object.keys(a).length ? { before: b, after: a } : null;
}

/** Retention for the daily prune. */
export const AUDIT_RETENTION_DAYS = 365;

/** The person behind a scanner or owner session. */
export function actorFromSession(
  session:
    | { actorType: "staff"; staffId: string; name: string }
    | { actorType: "owner"; userId: string; name: string }
    | { role: "owner"; userId: string; name: string }
): AuditActor {
  if ("role" in session) return { type: "OWNER", id: session.userId, name: session.name };
  return session.actorType === "staff"
    ? { type: "STAFF", id: session.staffId, name: session.name }
    : { type: "OWNER", id: session.userId, name: session.name };
}

export function systemActor(job: string): AuditActor {
  return { type: "SYSTEM", id: null, name: `system:${job}` };
}

const json = (v: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull =>
  v === undefined || v === null ? Prisma.JsonNull : (JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue);

export function auditRow(input: AuditInput): Prisma.AuditLogCreateManyInput {
  return {
    at: input.at ?? new Date(),
    actorType: input.actor.type,
    actorId: input.actor.id,
    actorName: input.actor.name.slice(0, 120),
    action: input.action,
    entity: input.entity,
    entityId: input.entityId,
    before: json(input.before),
    after: json(input.after),
  };
}

/**
 * Records an audit row. Inside a transaction, pass its client so the row
 * commits or rolls back with the change. Outside one, a failure is logged and
 * swallowed: a missing history line must never undo the owner's action.
 */
export async function recordAudit(input: AuditInput, tx?: Prisma.TransactionClient): Promise<void> {
  if (tx) {
    await tx.auditLog.create({ data: auditRow(input) });
    return;
  }
  try {
    await prisma.auditLog.create({ data: auditRow(input) });
  } catch (err) {
    console.error("[audit] could not record", input.action, err);
  }
}
