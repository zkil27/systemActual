import { NextRequest, NextResponse } from "next/server";
import { OWNER_COOKIE, verifyOwnerToken } from "@/lib/session-edge";
import { isPublicPath } from "@/lib/public-paths";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const token = request.cookies.get(OWNER_COOKIE)?.value;
  const session = await verifyOwnerToken(token);

  if (!session) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Owner sign-in required." }, { status: 401 });
    }
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
