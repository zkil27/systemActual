import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Kyna Ops — Daily Returns",
    short_name: "Kyna Ops",
    description: "Daily Failed Delivery & Buyer Return tracker and warehouse scanner.",
    start_url: "/",
    display: "standalone",
    background_color: "#f4f7f8",
    theme_color: "#0f766e",
    orientation: "portrait",
  };
}
