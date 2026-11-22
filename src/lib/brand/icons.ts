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
export const GROUND = "#f4f7f8";
export const SURFACE = "#ffffff";
