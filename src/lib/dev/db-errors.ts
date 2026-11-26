/** True when a Prisma error means a table or column the code expects isn't in the database yet. */
export function isMissingTableError(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  if (code === "P2021" || code === "P2022") return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /relation .* does not exist|column .* does not exist|42P01|42703/i.test(msg);
}

export const MIGRATION_PENDING = "Migration not applied yet. Run `npm run db:deploy`.";
