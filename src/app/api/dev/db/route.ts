import { devRoute } from "@/lib/dev/route";
import { DB_QUOTA_BYTES, DISK_BYTES, getDbHealth } from "@/lib/dev/db-health";

export const dynamic = "force-dynamic";

export async function GET() {
  return devRoute(async () => ({ ...(await getDbHealth()), quotaBytes: DB_QUOTA_BYTES, diskBytes: DISK_BYTES }));
}
