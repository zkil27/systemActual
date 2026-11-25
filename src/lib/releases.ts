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
    id: 8,
    date: "2026-11-26",
    title: "Shopee coming soon, softer colors",
    changes: [
      "The Shopee tab in Chats now says Coming soon while Shopee reviews Kyna Ops. Your TikTok chats work as before.",
      "Shopee in Settings, Upload, Items and Today also shows Coming soon.",
      "The sample chats and sample returns are gone, so everything you see is from your real shop.",
      "Chats and orders show soft TikTok or Shopee colors behind the cards, and a soft glow and a light tap confirm what you do. Turn the colors off in Settings → Appearance.",
    ],
  },
  {
    id: 7,
    date: "2026-11-26",
    title: "Profit after fees",
    changes: [
      "New Profit screen: what each month really earned after Shopee and TikTok fees and your cost per item. Open it from Today, under Money.",
      "See what the shops took (commission, fees, shipping) and which items earn the most and the least.",
      "Pieces that come back good on a return are not counted as cost.",
      "Download a month for your bookkeeper, or send /profit on Telegram for this month so far.",
    ],
  },
  {
    id: 6,
    date: "2026-11-26",
    title: "Item-by-item return check",
    changes: [
      "For returns with more than one item, every item starts as Received. Staff tap only the one that's missing, wrong or damaged. Only good pieces go back on the shelf.",
      "Returns has new filters: Partial return, Wrong item, and Refunded, not back.",
      "Open a parcel to see what was refunded next to what actually came back, item by item.",
      "Dispute messages and the 8 PM summary now list partial returns and wrong items.",
    ],
  },
  {
    id: 5,
    date: "2026-11-24",
    title: "Smarter replies, tidier Settings",
    changes: [
      "A suggested reply now appears by itself when you open a chat with a new question. No need to tap.",
      "Every suggestion is written for the buyer's exact message, in English when they write in English, so complaints, order changes and restock questions no longer get a mismatched saved answer.",
      "Deadlines, photo requests, order changes and reviews are marked Needs your check, and the assistant won't promise an order arrives in time.",
      "Settings is tidier. Related options now sit together: shops, costs, printing, Telegram and staff.",
    ],
  },
  {
    id: 4,
    date: "2026-11-24",
    title: "Suggested chat replies",
    changes: [
      "In a TikTok chat, tap Suggest a reply to get a reply written from your shop answers, the order and the item's listing (fabric, sizes, price and stock). Check it, then send it yourself.",
      "New Chats assistant page in Settings: turn suggested replies on or off and write your shop's answers.",
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
