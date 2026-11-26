import { NextResponse } from "next/server";
import { getDeveloperSession } from "@/lib/dev/access";

export const dynamic = "force-dynamic";

/** Whether this owner account may open the Developer section (shows the row in Settings). */
export async function GET() {
  const session = await getDeveloperSession();
  return NextResponse.json({ developer: Boolean(session) }, { headers: { "Cache-Control": "no-store" } });
}
