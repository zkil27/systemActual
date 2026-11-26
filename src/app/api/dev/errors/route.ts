import { prisma } from "@/lib/prisma";
import { devRoute } from "@/lib/dev/route";
import { ERROR_RETENTION_DAYS } from "@/lib/dev/errors";

export const dynamic = "force-dynamic";

/** Error groups, most recent first. Stacks are included (owner-only screen, max 4 KB each). */
export async function GET() {
  return devRoute(async () => {
    const errors = await prisma.appError.findMany({ orderBy: { lastAt: "desc" }, take: 200 });
    return { errors, retentionDays: ERROR_RETENTION_DAYS };
  });
}
