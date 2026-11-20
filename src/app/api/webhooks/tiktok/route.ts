import { NextRequest, NextResponse, after } from "next/server";
import { verifyTikTokWebhookSignature } from "@/lib/connectors/tiktok";
import { runTick } from "@/lib/worker/tick";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const authHeader = req.headers.get("authorization");

  // Always verify (fail closed). Without TIKTOK_APP_KEY/SECRET every webhook is rejected.
  const valid = verifyTikTokWebhookSignature({
    rawBody,
    authorizationHeader: authHeader,
  });
  if (!valid) {
    return NextResponse.json({ error: "Invalid TikTok signature" }, { status: 401 });
  }

  try {
    JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // TikTok needs a 200 within 3 seconds. The webhook is only a wake-up; the
  // tick pulls changes since the cursor, so retries and duplicates are harmless.
  after(async () => {
    try {
      await runTick("webhook");
    } catch (err) {
      console.error("[TikTok webhook tick error]", err);
    }
  });

  return NextResponse.json({ ok: true });
}
