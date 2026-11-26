import { NextResponse } from "next/server";
import type { OwnerSessionPayload } from "@/lib/auth";
import { devNotFound, getDeveloperSession } from "@/lib/dev/access";
import { isMissingTableError, MIGRATION_PENDING } from "@/lib/dev/db-errors";

/** Runs a Developer API handler: 404 for anyone not on the allowlist, JSON errors otherwise. */
export async function devRoute(
  handler: (session: OwnerSessionPayload) => Promise<unknown>
): Promise<NextResponse> {
  const session = await getDeveloperSession();
  if (!session) return devNotFound();
  try {
    const body = await handler(session);
    return body instanceof NextResponse
      ? body
      : NextResponse.json(body ?? { ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (isMissingTableError(err)) {
      return NextResponse.json({ error: MIGRATION_PENDING, migrationPending: true }, { status: 409 });
    }
    console.error("[dev]", err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message.slice(0, 300) }, { status: 500 });
  }
}

/** Runs one section; a missing table or failing query becomes `null` plus a note, so the rest still loads. */
export async function section<T>(
  notes: Record<string, string>,
  name: string,
  fn: () => Promise<T>
): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    notes[name] = isMissingTableError(err)
      ? MIGRATION_PENDING
      : (err instanceof Error ? err.message : String(err)).split("\n").slice(-1)[0]!.slice(0, 200);
    return null;
  }
}
