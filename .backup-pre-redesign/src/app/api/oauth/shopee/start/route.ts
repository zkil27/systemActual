import { NextResponse } from "next/server";
import { buildShopeeAuthUrl, isShopeeConfigured } from "@/lib/connectors/shopee";

export async function GET() {
  if (!isShopeeConfigured()) {
    return NextResponse.json(
      {
        error:
          "Shopee API keys are not set yet. Add SHOPEE_PARTNER_ID and SHOPEE_PARTNER_KEY in .env after Shopee approves your profile.",
      },
      { status: 400 }
    );
  }
  return NextResponse.redirect(buildShopeeAuthUrl());
}
