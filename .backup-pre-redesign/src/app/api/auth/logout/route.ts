import { NextResponse } from "next/server";
import { OWNER_COOKIE, STAFF_COOKIE } from "@/lib/auth";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(OWNER_COOKIE);
  res.cookies.delete(STAFF_COOKIE);
  return res;
}
