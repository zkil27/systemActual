import { NextResponse } from "next/server";
import { getScannerSession } from "@/lib/auth";
import { recordError } from "@/lib/dev/errors";

export const dynamic = "force-dynamic";

const MAX_BODY = 8 * 1024;
/** Per server instance. A crash loop on one phone must not flood the database. */
const MAX_PER_MINUTE = 30;
let windowStart = 0;
let windowCount = 0;

function allow(now: number): boolean {
  if (now - windowStart > 60_000) {
    windowStart = now;
    windowCount = 0;
  }
  windowCount++;
  return windowCount <= MAX_PER_MINUTE;
}

const str = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() ? v.slice(0, max) : null);

/**
 * Browser errors from owner and staff screens (see <ClientErrorReporter />).
 * Public in middleware so staff phones can reach it; needs an owner or staff session.
 */
export async function POST(request: Request) {
  const text = await request.text().catch(() => "");
  if (!text || text.length > MAX_BODY) return new NextResponse(null, { status: 413 });
  const session = await getScannerSession();
  if (!session) return new NextResponse(null, { status: 401 });
  if (!allow(Date.now())) return new NextResponse(null, { status: 429 });

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  const message = str(body.message, 500);
  if (!message) return new NextResponse(null, { status: 400 });

  await recordError({
    source: "client",
    message,
    stack: str(body.stack, 4_000),
    route: str(body.route, 300),
    buildId: str(body.buildId, 64),
    actorType: session.actorType === "staff" ? "STAFF" : "OWNER",
    userAgent: request.headers.get("user-agent"),
  });
  return new NextResponse(null, { status: 204 });
}
