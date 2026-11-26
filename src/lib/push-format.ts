/**
 * Pure helpers for Web Push notifications: payload formatting, URL safety, and
 * human-readable device labels. Kept free of database/runtime imports for unit tests.
 */

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag?: string;
}

const MAX_TITLE_LEN = 64;
const MAX_BODY_LEN = 220;

export function sanitizePushUrl(url: string | undefined | null): string {
  if (!url) return "/";
  const trimmed = url.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return "/";
  return trimmed;
}

function truncate(text: string, max: number): string {
  const clean = text.trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trimEnd()}…`;
}

/** Strip raw URLs like "https://..." that look noisy in native OS banners. */
function stripInlineUrls(text: string): string {
  return text
    .replace(/Open\s+[A-Za-z &]+:\s*https?:\/\/\S+/gi, "")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Turn ALL-CAPS Telegram alert headers like "WAVE STALLED — 3 parcels" into readable sentence case. */
function friendlyTitle(raw: string): string {
  const clean = raw.replace(/\s*[—–-]\s*.*$/, "").trim();
  if (!clean) return "Kyna Ops";
  const letters = clean.replace(/[^A-Za-z]/g, "");
  if (letters.length > 0 && letters === letters.toUpperCase()) {
    return clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase();
  }
  return clean;
}

interface AlertMatchRule {
  test: RegExp;
  title?: string;
  url: string;
  tag: string;
}

const ALERT_RULES: readonly AlertMatchRule[] = [
  { test: /new buyer message/i, title: "New buyer message", url: "/chats", tag: "kyna-chat" },
  { test: /approval|approve\s*&?\s*send|price change|copy listing/i, title: "Approval needed", url: "/approvals", tag: "kyna-approval" },
  { test: /pull cancelled label/i, title: "Pull cancelled label", url: "/waves", tag: "kyna-cancel" },
  { test: /wave\b/i, url: "/waves", tag: "kyna-wave" },
  { test: /not picked up|handover/i, title: "Parcels waiting for pickup", url: "/waves", tag: "kyna-handover" },
  { test: /return issue|dispute deadline/i, url: "/returns", tag: "kyna-returns" },
  { test: /overdue supplier/i, title: "Overdue supplier orders", url: "/restock", tag: "kyna-restock" },
  { test: /out of stock|low stock|shelf alert|stock not updated|new listing on one shop/i, url: "/items", tag: "kyna-stock" },
  { test: /printer|print failed/i, url: "/settings", tag: "kyna-printer" },
  { test: /reconnect|token|session expired/i, title: "Shop needs reconnect", url: "/settings", tag: "kyna-shop" },
  { test: /daily truth|daily summary|8 pm|kyna ops\s*[—–-]/i, title: "Daily summary", url: "/", tag: "kyna-brief" },
];

/**
 * Convert an existing owner alert message into a concise native push notification
 * with a clean title, readable body, and the right screen to open on tap.
 */
export function formatPushFromAlert(text: string, override?: Partial<PushPayload>): PushPayload {
  const cleaned = stripInlineUrls(text);
  const lines = cleaned
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const firstLine = lines[0] ?? "Kyna Ops";
  const rest = lines.slice(1).join(" · ");

  const matched = ALERT_RULES.find((r) => r.test.test(cleaned));
  const dashSplit = firstLine.split(/\s+[—–]\s+/);
  const title = truncate(
    override?.title ??
      matched?.title ??
      (lines.length > 1 || dashSplit.length > 1 ? friendlyTitle(firstLine) : "Kyna Ops"),
    MAX_TITLE_LEN
  );

  let defaultBody = rest || firstLine;
  // If firstLine had extra details after "—", keep those details at the start of the body.
  if (dashSplit.length > 1) {
    const detail = dashSplit.slice(1).join(" — ").trim();
    defaultBody = rest ? `${detail} · ${rest}` : detail;
  }

  return {
    title,
    body: truncate(override?.body ?? defaultBody, MAX_BODY_LEN),
    url: sanitizePushUrl(override?.url ?? matched?.url ?? "/"),
    tag: override?.tag ?? matched?.tag,
  };
}

/** Short, plain-English label for a subscribed device from its browser User-Agent. */
export function labelFromUserAgent(ua: string | null | undefined): string {
  const s = (ua ?? "").trim();
  if (!s) return "Browser";
  if (/iPhone/i.test(s)) return "iPhone";
  if (/iPad/i.test(s)) return "iPad";
  if (/Android/i.test(s)) {
    return /Mobile/i.test(s) ? "Android phone" : "Android tablet";
  }
  const os = /Macintosh|Mac OS X/i.test(s)
    ? "Mac"
    : /Windows/i.test(s)
      ? "Windows"
      : /Linux/i.test(s)
        ? "Linux"
        : "";
  const browser = /Edg\//i.test(s)
    ? "Edge"
    : /Chrome\//i.test(s)
      ? "Chrome"
      : /Firefox\//i.test(s)
        ? "Firefox"
        : /Safari\//i.test(s)
          ? "Safari"
          : "Browser";
  return os ? `${os} ${browser}` : browser;
}
