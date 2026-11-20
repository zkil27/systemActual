/** What staff can report about a returned parcel. Shared by /scan and the parcel sheet. */
export type ConditionTone = "good" | "neutral" | "warn" | "bad";

export interface ConditionOption {
  id: string;
  label: string;
  tone: ConditionTone;
  /** Ask for a photo: this is dispute evidence. */
  needsPhoto: boolean;
}

export const CONDITIONS: readonly ConditionOption[] = [
  { id: "GOOD_RESTOCKABLE", label: "Good, can resell", tone: "good", needsPhoto: false },
  { id: "DAMAGED_PACKAGING", label: "Torn pouch only", tone: "neutral", needsPhoto: false },
  { id: "DAMAGED_ITEM", label: "Damaged or stained", tone: "warn", needsPhoto: true },
  { id: "WRONG_OR_SWAPPED_ITEM", label: "Wrong or swapped item", tone: "bad", needsPhoto: true },
  { id: "MISSING_PIECE", label: "Missing piece", tone: "bad", needsPhoto: true },
];

export const DEFAULT_CONDITION = "GOOD_RESTOCKABLE";

export function findCondition(id: string | null | undefined): ConditionOption | undefined {
  return CONDITIONS.find((c) => c.id === id);
}

export function conditionLabel(id: string | null | undefined): string {
  return findCondition(id)?.label ?? "Not checked";
}

export function isIssueCondition(id: string | null | undefined): boolean {
  return findCondition(id)?.needsPhoto ?? false;
}
