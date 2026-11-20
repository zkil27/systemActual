/**
 * Incremental sync windows over `update_time`.
 *
 * The cursor only moves forward after a whole window is processed, so a tick
 * that runs out of time simply redoes that window next time (writes are
 * idempotent). Windows overlap a little to catch updates whose timestamp lands
 * on the boundary or arrives late.
 */
export const INITIAL_LOOKBACK_MS = 3 * 24 * 3600_000;
export const MAX_WINDOW_MS = 2 * 3600_000;
export const OVERLAP_MS = 5 * 60_000;

export interface SyncWindow {
  from: Date;
  to: Date;
  /** True when this window reaches "now", i.e. we're caught up after it. */
  last: boolean;
}

export function nextSyncWindow(cursor: Date | null, now: Date): SyncWindow {
  const start = cursor
    ? new Date(cursor.getTime() - OVERLAP_MS)
    : new Date(now.getTime() - INITIAL_LOOKBACK_MS);
  const end = Math.min(start.getTime() + MAX_WINDOW_MS, now.getTime());
  return { from: start, to: new Date(end), last: end >= now.getTime() };
}
