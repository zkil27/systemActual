import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { NextConfig } from "next";

/** Migration folders in this build. Developer › Controls compares them with the database to list pending ones. */
function migrationNames(): string {
  try {
    return readdirSync(join(process.cwd(), "prisma", "migrations"), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort()
      .join(",");
  } catch {
    return "";
  }
}

const nextConfig: NextConfig = {
  // Baked into the client bundle at build time. Open apps compare it with
  // /api/version to know a newer deploy is live (see <UpdatePrompt />).
  env: {
    NEXT_PUBLIC_BUILD_ID: process.env.VERCEL_GIT_COMMIT_SHA || "dev",
    // Server-only use (Developer screen); never read in client code.
    EXPECTED_MIGRATIONS: migrationNames(),
  },
  serverExternalPackages: ["web-push"],
  images: {
    unoptimized: true,
  },
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
