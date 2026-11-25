/**
 * Phone-side rules for the item-by-item return check. Mirrors
 * src/lib/returns/item-check.ts (the server re-checks everything), but uses
 * plain strings so it stays out of the Prisma client bundle.
 *
 * Every piece starts as received. Staff only mark what's wrong.
 */

export type ItemProblem = "MISSING" | "WRONG" | "DAMAGED";

export interface ItemMark {
  problem: ItemProblem;
  /** Pieces with this problem, 1..quantity. */
  count: number;
}

export type ItemMarks = Record<string, ItemMark>;

export interface CheckableLine {
  lineKey: string;
  quantity: number;
}

export const PROBLEMS: ReadonlyArray<{ id: ItemProblem; label: string }> = [
  { id: "MISSING", label: "Missing" },
  { id: "WRONG", label: "Wrong item" },
  { id: "DAMAGED", label: "Damaged" },
];

/** One piece in the parcel: the normal condition buttons say it all. */
export function needsItemCheck(lines: CheckableLine[]): boolean {
  return lines.length > 1 || (lines.length === 1 && lines[0].quantity > 1);
}

/** "How many?" buttons: a few small numbers, then All. Nothing to type. */
export function countChoices(quantity: number): Array<{ label: string; count: number }> {
  if (quantity <= 1) return [];
  const small = Array.from({ length: Math.min(quantity - 1, 3) }, (_, i) => ({ label: String(i + 1), count: i + 1 }));
  return [...small, { label: "All", count: quantity }];
}

/** Picking a problem: one-piece lines are done; bigger lines start at all pieces until a count is picked. */
export function markProblem(marks: ItemMarks, line: CheckableLine, problem: ItemProblem): ItemMarks {
  const prev = marks[line.lineKey];
  const count = prev && prev.problem === problem ? prev.count : line.quantity;
  return { ...marks, [line.lineKey]: { problem, count } };
}

export function setMarkCount(marks: ItemMarks, line: CheckableLine, count: number): ItemMarks {
  const prev = marks[line.lineKey];
  if (!prev) return marks;
  return { ...marks, [line.lineKey]: { ...prev, count: Math.max(1, Math.min(line.quantity, count)) } };
}

/** Back to received. */
export function clearMark(marks: ItemMarks, lineKey: string): ItemMarks {
  if (!(lineKey in marks)) return marks;
  const next = { ...marks };
  delete next[lineKey];
  return next;
}

/** What the server expects: only the lines staff marked. */
export function toSubmission(
  lines: CheckableLine[],
  marks: ItemMarks
): Array<{ lineKey: string; missing?: number; wrong?: number; damaged?: number }> {
  const out: Array<{ lineKey: string; missing?: number; wrong?: number; damaged?: number }> = [];
  for (const line of lines) {
    const m = marks[line.lineKey];
    if (!m) continue;
    const count = Math.max(1, Math.min(line.quantity, m.count));
    out.push(
      m.problem === "MISSING"
        ? { lineKey: line.lineKey, missing: count }
        : m.problem === "WRONG"
          ? { lineKey: line.lineKey, wrong: count }
          : { lineKey: line.lineKey, damaged: count }
    );
  }
  return out;
}

/** Parcel condition, worst item wins. Same order as the server. */
export function conditionFromMarks(marks: ItemMarks, packagingTorn: boolean): string {
  const problems = new Set(Object.values(marks).map((m) => m.problem));
  if (problems.has("WRONG")) return "WRONG_OR_SWAPPED_ITEM";
  if (problems.has("MISSING")) return "MISSING_PIECE";
  if (problems.has("DAMAGED")) return "DAMAGED_ITEM";
  return packagingTorn ? "DAMAGED_PACKAGING" : "GOOD_RESTOCKABLE";
}

/** Short summary under the list, e.g. "4 of 5 pieces OK". */
export function marksSummary(lines: CheckableLine[], marks: ItemMarks): string {
  const total = lines.reduce((n, l) => n + l.quantity, 0);
  const bad = lines.reduce((n, l) => n + (marks[l.lineKey] ? Math.min(l.quantity, marks[l.lineKey].count) : 0), 0);
  return bad === 0 ? `All ${total} pieces OK` : `${total - bad} of ${total} pieces OK`;
}
