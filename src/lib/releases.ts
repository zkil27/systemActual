/**
 * Release notes shown in the "New update available" sheet.
 *
 * When you push a major update to main, add an entry at the TOP of this list
 * (next `id`, today's date) in the same commit. Open copies of the app will
 * show these notes and ask the user to refresh.
 *
 * A deploy with no new entry counts as a minor update: open copies only get a
 * small "Update available · Refresh" banner.
 */
export type Release = {
  /** Strictly increasing. Never reuse or reorder. */
  id: number;
  /** YYYY-MM-DD */
  date: string;
  title: string;
  changes: string[];
};

export const RELEASES: Release[] = [
  {
    id: 1,
    date: "2026-11-23",
    title: "Update notices",
    changes: [
      "The app now tells you when a new version is out and what changed.",
      "Tap Refresh now to load it. No need to delete and re-add the app.",
    ],
  },
];

export const LATEST_RELEASE_ID = RELEASES[0]?.id ?? 0;
