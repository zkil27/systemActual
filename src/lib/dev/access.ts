import { NextResponse } from "next/server";
import { getOwnerSession, type OwnerSessionPayload } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * The Developer section (/dev) is for the app's developer only, not the shop
 * owner. Access is an allowlist of owner-account emails in DEVELOPER_EMAILS
 * (comma-separated). Empty or unset means nobody gets in.
 */

export function parseDeveloperEmails(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.includes("@"));
}

export function isDeveloperEmail(email: string | null | undefined, allow: readonly string[]): boolean {
  if (!email || allow.length === 0) return false;
  return allow.includes(email.trim().toLowerCase());
}

/**
 * The owner session, only if its account is on the developer allowlist.
 * Re-reads the email from the database because the cookie can be up to 30 days old.
 */
export async function getDeveloperSession(): Promise<OwnerSessionPayload | null> {
  const allow = parseDeveloperEmails(process.env.DEVELOPER_EMAILS);
  if (allow.length === 0) return null;
  const session = await getOwnerSession();
  if (!session) return null;
  const owner = await prisma.ownerUser.findUnique({ where: { id: session.userId }, select: { email: true } });
  if (!owner || !isDeveloperEmail(owner.email, allow)) return null;
  return { ...session, email: owner.email };
}

/** 404, so the section doesn't reveal that it exists. */
export function devNotFound() {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

export { isMissingTableError, MIGRATION_PENDING } from "@/lib/dev/db-errors";
