import { NextResponse } from "next/server";
import { buildTikTokAuthUrl, isTikTokConfigured } from "@/lib/connectors/tiktok";

export async function GET() {
  if (!isTikTokConfigured()) {
    return NextResponse.json(
      {
        error:
          "TikTok Shop API keys are not set yet. Add TIKTOK_APP_KEY and TIKTOK_APP_SECRET in .env from Kyna Ops Hub.",
      },
      { status: 400 }
    );
  }
  return NextResponse.redirect(buildTikTokAuthUrl());
}
