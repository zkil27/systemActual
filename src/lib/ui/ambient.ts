/**
 * Ambient field: the soft color wash behind the cards.
 *
 * Color here still means something. The resting mood says which shop you are
 * looking at (pink everywhere else), and a short bloom says how an action went.
 * Crimson stays reserved for Missing and never appears in the field.
 *
 * Pure module: no DOM, so the moods, routes and store are testable in node.
 */

export const AMBIENT_STORAGE_KEY = "kyna:ambient";

/** One entry per shop. Adding Lazada or Shopify later means adding one entry here. */
export type AmbientMoodId = "kyna" | "TIKTOK" | "SHOPEE";
export type AmbientShop = Exclude<AmbientMoodId, "kyna">;
export type AmbientTone = "success" | "warn" | "error";
export type AmbientSurface = "full" | "bloom-only" | "none";

export interface AmbientBlob {
  /** Center of the blob, as CSS lengths relative to the viewport. */
  x: string;
  y: string;
  /** Blob size; the gradient fades to nothing at its edge. */
  w: string;
  h: string;
  /** Peak color at the blob's center, with its strength in the alpha. */
  light: string;
  dark: string;
}

export interface AmbientMood {
  label: string;
  /** Two large top-corner blobs, then one faint low blob. */
  blobs: readonly [AmbientBlob, AmbientBlob, AmbientBlob];
}

// Weather-style: most of the color sits at the top behind the large title,
// about 15% strength, fading to a few percent low on the screen. Dark mode is
// a deeper, low-light glow rather than a brighter one.
const TOP = { w: "max(130vw, 760px)", h: "max(62vh, 420px)" } as const;
const LOW = { x: "62%", y: "104%", w: "max(150vw, 900px)", h: "max(55vh, 380px)" } as const;

export const AMBIENT_MOODS: Record<AmbientMoodId, AmbientMood> = {
  kyna: {
    label: "Kyna pink",
    blobs: [
      { x: "8%", y: "-4%", ...TOP, light: "rgb(240 140 176 / 0.19)", dark: "rgb(176 64 112 / 0.22)" },
      { x: "96%", y: "6%", ...TOP, light: "rgb(165 196 232 / 0.2)", dark: "rgb(72 96 150 / 0.2)" },
      { ...LOW, light: "rgb(244 167 193 / 0.08)", dark: "rgb(150 60 100 / 0.1)" },
    ],
  },
  TIKTOK: {
    label: "TikTok",
    // Cyan up-left, red down-right: the offset of the TikTok logo.
    blobs: [
      { x: "4%", y: "-8%", ...TOP, light: "rgb(37 244 238 / 0.18)", dark: "rgb(18 150 160 / 0.2)" },
      { x: "98%", y: "12%", ...TOP, light: "rgb(254 44 85 / 0.1)", dark: "rgb(190 28 70 / 0.2)" },
      { ...LOW, light: "rgb(37 244 238 / 0.08)", dark: "rgb(18 130 140 / 0.1)" },
    ],
  },
  SHOPEE: {
    label: "Shopee",
    blobs: [
      { x: "8%", y: "-4%", ...TOP, light: "rgb(238 77 45 / 0.11)", dark: "rgb(200 70 36 / 0.22)" },
      { x: "96%", y: "6%", ...TOP, light: "rgb(255 179 138 / 0.22)", dark: "rgb(170 100 60 / 0.16)" },
      { ...LOW, light: "rgb(255 179 138 / 0.08)", dark: "rgb(160 80 40 / 0.1)" },
    ],
  },
};

/** Bloom colors. Error is a warm coral, never the Missing crimson. */
export const AMBIENT_TONES: Record<AmbientTone, { light: string; dark: string }> = {
  success: { light: "rgb(52 211 153 / 0.26)", dark: "rgb(16 150 100 / 0.26)" },
  warn: { light: "rgb(251 191 36 / 0.3)", dark: "rgb(190 130 20 / 0.24)" },
  error: { light: "rgb(255 122 89 / 0.2)", dark: "rgb(210 90 60 / 0.26)" },
};

/** How long a bloom stays mounted; the CSS animation itself is a little shorter. */
export const BLOOM_MS = 1400;

export function moodForShop(shop: string | null | undefined): AmbientMoodId {
  if (shop && shop in AMBIENT_MOODS && shop !== "kyna") return shop as AmbientMoodId;
  return "kyna";
}

/** Owner screens get the full field; staff screens get blooms only; login gets none. */
export function resolveSurface(pathname: string | null | undefined): AmbientSurface {
  const p = pathname || "/";
  if (p === "/login" || p.startsWith("/login/")) return "none";
  if (p === "/scan" || p.startsWith("/scan/") || p === "/stock-in" || p.startsWith("/stock-in/")) {
    return "bloom-only";
  }
  return "full";
}

/** Stored switch value. Anything but an explicit "off" means on. */
export function parseAmbientPreference(raw: string | null | undefined): "on" | "off" {
  return raw === "off" ? "off" : "on";
}

// ── Store ───────────────────────────────────────────────────────────────────
// The last shop registered wins, so a parcel sheet opened over Chats takes
// over until it closes, then Chats' shop shows again.

export interface AmbientPulse {
  id: number;
  tone: AmbientTone;
}

export interface AmbientSnapshot {
  mood: AmbientMoodId;
  pulse: AmbientPulse | null;
}

interface Registration {
  token: number;
  shop: AmbientShop;
}

let registrations: Registration[] = [];
let nextToken = 0;
let pulseSeq = 0;
let snapshot: AmbientSnapshot = { mood: "kyna", pulse: null };
const listeners = new Set<() => void>();

function publish(next: Partial<AmbientSnapshot>) {
  const merged = { ...snapshot, ...next };
  if (merged.mood === snapshot.mood && merged.pulse === snapshot.pulse) return;
  snapshot = merged;
  for (const l of listeners) l();
}

function currentMood(): AmbientMoodId {
  const top = registrations[registrations.length - 1];
  return top ? moodForShop(top.shop) : "kyna";
}

/** Show a shop's colors until the returned release function runs. */
export function registerAmbientShop(shop: AmbientShop): () => void {
  const token = ++nextToken;
  registrations.push({ token, shop });
  publish({ mood: currentMood() });
  return () => {
    registrations = registrations.filter((r) => r.token !== token);
    publish({ mood: currentMood() });
  };
}

/** A short bloom from the bottom of the screen. A new pulse restarts it. */
export function pulseAmbient(tone: AmbientTone): void {
  publish({ pulse: { id: ++pulseSeq, tone } });
}

export function subscribeAmbient(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getAmbientSnapshot(): AmbientSnapshot {
  return snapshot;
}

const SERVER_SNAPSHOT: AmbientSnapshot = { mood: "kyna", pulse: null };
export function getServerAmbientSnapshot(): AmbientSnapshot {
  return SERVER_SNAPSHOT;
}

/** Test-only: forget every registration and pulse. */
export function resetAmbientForTests(): void {
  registrations = [];
  snapshot = { mood: "kyna", pulse: null };
}

// ── Contrast helpers (used by tests to keep text readable over the field) ────

type RGB = [number, number, number];

export function parseColor(input: string): { rgb: RGB; alpha: number } {
  const s = input.trim();
  if (s.startsWith("#")) {
    const hex = s.slice(1);
    const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
    const n = parseInt(full.slice(0, 6), 16);
    return { rgb: [(n >> 16) & 255, (n >> 8) & 255, n & 255], alpha: 1 };
  }
  const m = s.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[/,]\s*([\d.]+))?\s*\)$/);
  if (!m) throw new Error(`Unsupported color: ${input}`);
  return {
    rgb: [Number(m[1]), Number(m[2]), Number(m[3])],
    alpha: m[4] === undefined ? 1 : Number(m[4]),
  };
}

/** Paint each translucent color over `base`, in order, as the browser does. */
export function composite(base: string, layers: string[]): RGB {
  let out = parseColor(base).rgb;
  for (const layer of layers) {
    const { rgb, alpha } = parseColor(layer);
    out = [0, 1, 2].map((i) => rgb[i] * alpha + out[i] * (1 - alpha)) as RGB;
  }
  return out;
}

function luminance([r, g, b]: RGB): number {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrastRatio(a: RGB | string, b: RGB | string): number {
  const ca = typeof a === "string" ? parseColor(a).rgb : a;
  const cb = typeof b === "string" ? parseColor(b).rgb : b;
  const la = luminance(ca);
  const lb = luminance(cb);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
