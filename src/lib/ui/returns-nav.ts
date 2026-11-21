/** Step parcel selection up or down in the Returns list, clamping at both ends. */
export function stepSelection(
  ids: string[],
  current: string | null,
  delta: number
): string | null {
  if (ids.length === 0) return null;
  const idx = current !== null ? ids.indexOf(current) : -1;
  if (idx === -1) return delta > 0 ? ids[0] : ids[ids.length - 1];
  const next = Math.max(0, Math.min(ids.length - 1, idx + delta));
  return ids[next];
}
