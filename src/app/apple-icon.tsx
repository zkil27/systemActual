import { renderAppIcon } from "@/lib/brand/app-icon";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// iOS rounds the corners itself, so the square stays full-bleed.
export default function AppleIcon() {
  return renderAppIcon(180);
}
