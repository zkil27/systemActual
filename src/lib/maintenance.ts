import { prisma } from "@/lib/prisma";
import { isMissingTableError } from "@/lib/dev/db-errors";
import { activeMaintenance, type MaintenanceNotice } from "@/lib/ops-notice";

export { activeMaintenance, MAX_MAINTENANCE_MESSAGE, type MaintenanceNotice } from "@/lib/ops-notice";

/** The maintenance banner and worker pause switch, set from Developer › Controls. */

export interface OpsSwitches {
  workerPaused: boolean;
  /** Banner text while maintenance is on, else null. */
  maintenance: MaintenanceNotice | null;
}

/** Never throws; before the migration is applied both switches read as off. */
export async function getOpsSwitches(now: Date = new Date()): Promise<OpsSwitches> {
  try {
    const row = await prisma.appSettings.findUnique({
      where: { id: "default" },
      select: { workerPaused: true, maintenanceMessage: true, maintenanceUntil: true },
    });
    return {
      workerPaused: Boolean(row?.workerPaused),
      maintenance: activeMaintenance(row?.maintenanceMessage, row?.maintenanceUntil, now),
    };
  } catch (err) {
    if (!isMissingTableError(err)) console.error("[maintenance] could not read switches", err);
    return { workerPaused: false, maintenance: null };
  }
}
