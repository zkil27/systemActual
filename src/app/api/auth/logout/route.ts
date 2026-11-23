import { NextRequest, NextResponse } from "next/server";
import { OWNER_COOKIE, STAFF_COOKIE } from "@/lib/auth";

export async function POST(req: NextRequest) {
  let scope = req.nextUrl.searchParams.get("scope");
  if (!scope) {
    const body = await req.json().catch(() => null) as { scope?: string } | null;
    scope = body?.scope ?? null;
  }

  const res = NextResponse.json({ ok: true });
  if (scope === "staff") {
    res.cookies.delete(STAFF_COOKIE);
  } else {
    res.cookies.delete(OWNER_COOKIE);
    res.cookies.delete(STAFF_COOKIE);
  }
  return res;
}
