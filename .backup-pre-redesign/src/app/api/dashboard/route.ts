import { NextRequest, NextResponse } from "next/server";
import { getDailyTruthReport } from "@/lib/analytics/daily-returns";

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const rangeParam = sp.get("range");
    const range: "today" | "yesterday" | "7days" =
      rangeParam === "yesterday" || rangeParam === "7days" ? rangeParam : "today";
    const date = sp.get("date") || undefined;

    const report = await getDailyTruthReport({ range, date });
    return NextResponse.json(report);
  } catch (err) {
    console.error("[Dashboard API error]", err);
    return NextResponse.json(
      { error: "Could not load today's return report." },
      { status: 500 }
    );
  }
}
