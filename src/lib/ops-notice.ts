/** Pure maintenance-notice helpers, safe for client code (no database imports). */

export interface MaintenanceNotice {
  message: string;
  /** ISO time the banner hides itself, or null for "until turned off". */
  until: string | null;
}

export const MAX_MAINTENANCE_MESSAGE = 160;

/** The banner shows while a message is set and its end time (if any) hasn't passed. */
export function activeMaintenance(
  message: string | null | undefined,
  until: Date | null | undefined,
  now: Date
): MaintenanceNotice | null {
  const text = message?.trim();
  if (!text) return null;
  if (until && until.getTime() <= now.getTime()) return null;
  return { message: text.slice(0, MAX_MAINTENANCE_MESSAGE), until: until ? until.toISOString() : null };
}

/** Narrow the `maintenance` field of an untrusted /api/version body, and hide it once `until` passes. */
export function parseMaintenanceNotice(body: unknown, now: Date = new Date()): MaintenanceNotice | null {
  if (!body || typeof body !== "object") return null;
  const m = (body as Record<string, unknown>).maintenance;
  if (!m || typeof m !== "object") return null;
  const { message, until } = m as Record<string, unknown>;
  if (typeof message !== "string") return null;
  const untilDate = typeof until === "string" && !Number.isNaN(Date.parse(until)) ? new Date(until) : null;
  return activeMaintenance(message, untilDate, now);
}

/** Window event <UpdatePrompt /> fires with each /api/version body it fetches. */
export const VERSION_EVENT = "kyna:version";
