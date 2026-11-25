/** Home-screen icons served by src/app/icons/[file]/route.tsx. */
export interface AppIconSpec {
  file: string;
  size: number;
  purpose: "any" | "maskable";
}

export const APP_ICONS: AppIconSpec[] = [
  { file: "192.png", size: 192, purpose: "any" },
  { file: "512.png", size: 512, purpose: "any" },
  { file: "maskable-512.png", size: 512, purpose: "maskable" },
];

export function findAppIcon(file: string): AppIconSpec | undefined {
  return APP_ICONS.find((icon) => icon.file === file);
}

export const BRAND_PINK = "#f4a7c1";
export const BRAND_INK = "#4a1228";
export const BRAND_TEAL = BRAND_PINK;

/**
 * The app icon's soft wash, matching the Kyna pink mood of the background
 * field: a light highlight top-left, a cool mist top-right, a deeper rose low.
 * Painted over BRAND_PINK, so the icon still reads pink at favicon size.
 */
// Angled linear washes: the icon renderer (Satori) ignores the vertical
// position of radial gradients, so corners are reached with angles instead.
export const BRAND_ICON_GRADIENT = [
  "linear-gradient(225deg, rgba(190, 210, 242, 0.8) 0%, rgba(190, 210, 242, 0) 48%)",
  "linear-gradient(135deg, rgba(253, 222, 232, 0.9) 0%, rgba(253, 222, 232, 0) 52%)",
  "linear-gradient(0deg, rgba(232, 118, 160, 0.42) 0%, rgba(232, 118, 160, 0) 55%)",
].join(", ");
export const GROUND = "#f4f7f8";
export const SURFACE = "#ffffff";
