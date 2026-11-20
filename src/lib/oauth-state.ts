import crypto from "crypto";
import type { NextRequest, NextResponse } from "next/server";

/**
 * One-time OAuth `state`, bound to the owner's browser with an httpOnly cookie.
 * Stops anyone from connecting their own shop by opening our callback URL with
 * their auth code, and stops tricking the owner into finishing someone else's flow.
 */
const COOKIE = "kyna_oauth_state";
const MAX_AGE_SECONDS = 10 * 60;

export function newOAuthState(): string {
  return crypto.randomBytes(24).toString("base64url");
}

export function setOAuthStateCookie(res: NextResponse, state: string): void {
  res.cookies.set(COOKIE, state, {
    httpOnly: true,
    sameSite: "lax", // sent on the top-level redirect back from Shopee/TikTok
    secure: process.env.NODE_ENV === "production",
    path: "/api/oauth",
    maxAge: MAX_AGE_SECONDS,
  });
}

export function statesMatch(expected: string | undefined, received: string | null): boolean {
  if (!expected || !received) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function checkOAuthState(req: NextRequest): boolean {
  return statesMatch(req.cookies.get(COOKIE)?.value, req.nextUrl.searchParams.get("state"));
}

export function clearOAuthStateCookie(res: NextResponse): void {
  res.cookies.set(COOKIE, "", { path: "/api/oauth", maxAge: 0 });
}
