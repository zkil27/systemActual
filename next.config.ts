import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Baked into the client bundle at build time. Open apps compare it with
  // /api/version to know a newer deploy is live (see <UpdatePrompt />).
  env: {
    NEXT_PUBLIC_BUILD_ID: process.env.VERCEL_GIT_COMMIT_SHA || "dev",
  },
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
