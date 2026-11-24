/**
 * Release notes shown in the "New update available" sheet.
 *
 * When you push a major update to main, add an entry at the TOP of this list
 * (next `id`, today's date) in the same commit. Open copies of the app will
 * show these notes and ask the user to refresh. Devices that open the new
 * version directly see the same notes once, as "What's new".
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
    id: 4,
    date: "2026-11-24",
    title: "What's new after updates",
    changes: [
      "When you open the app after an update, a What's new sheet shows what changed. Tap Got it to close it.",
      "In Chats, the reply box now sits right on top of the keyboard, without the empty gap.",
    ],
  },
  {
    id: 3,
    date: "2026-11-24",
    title: "Chats and new date picker",
    changes: [
      "New Chats tab: read and reply to your TikTok buyers, with photos, and see each buyer's order and tracking beside the chat.",
      "Scan moved to the top bar, next to Settings.",
      "Pick date on Today and custom dates in Returns open a new calendar that looks the same on every phone and computer.",
      "Tap the month name at the top of the calendar to jump straight to any month or year.",
    ],
  },
  {
    id: 2,
    date: "2026-11-23",
    title: "Easier taps",
    changes: [
      "Wave time buttons in Auto-ship schedule are bigger and easier to tap.",
      "Tabs in Money no longer cut off labels like Yesterday and Withdraw.",
    ],
  },
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
