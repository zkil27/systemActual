/**
 * Deciding what a scanned code refers to.
 *
 * - Exact matches on any waybill (original or return), order no. or return no.
 *   win. If more than one parcel matches exactly (e.g. a failed delivery and a
 *   later buyer return on the same order), staff pick from a list rather than
 *   the newest being chosen for them.
 * - Typing only the last digits (smudged label) is accepted only when exactly
 *   one parcel ends with them; otherwise staff must scan the full barcode.
 */
export const MIN_SUFFIX_LENGTH = 6;

export type ScanMatch<T> =
  | { kind: "one"; parcel: T }
  | { kind: "pick"; parcels: T[] }
  | { kind: "ambiguous" }
  | { kind: "none" };

export function resolveScanMatch<T extends { physicallyReceivedAt: Date | null }>(
  exact: T[],
  suffix: T[]
): ScanMatch<T> {
  if (exact.length === 1) return { kind: "one", parcel: exact[0] };
  if (exact.length > 1) {
    // Not-yet-scanned parcels first: that's almost always the one in hand.
    const sorted = [...exact].sort(
      (a, b) => Number(Boolean(a.physicallyReceivedAt)) - Number(Boolean(b.physicallyReceivedAt))
    );
    return { kind: "pick", parcels: sorted };
  }
  if (suffix.length === 1) return { kind: "one", parcel: suffix[0] };
  if (suffix.length > 1) return { kind: "ambiguous" };
  return { kind: "none" };
}
