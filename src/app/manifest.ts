import type { MetadataRoute } from "next";
import { APP_ICONS, GROUND, SURFACE } from "@/lib/brand/icons";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Kyna Ops",
    short_name: "Kyna Ops",
    description: "Daily failed deliveries, buyer returns and warehouse scanning.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    // Splash ground matches the page; the status bar matches the white header.
    background_color: GROUND,
    theme_color: SURFACE,
    icons: APP_ICONS.map((icon) => ({
      src: `/icons/${icon.file}`,
      sizes: `${icon.size}x${icon.size}`,
      type: "image/png",
      purpose: icon.purpose,
    })),
  };
}
