import { NextResponse } from "next/server";
import { z } from "zod";
import { getOwnerSession } from "@/lib/auth";
import { suggestReply } from "@/lib/ai/suggest";

export const dynamic = "force-dynamic";
// The AI chain gives up after 40 seconds; leave room to save the draft.
export const maxDuration = 60;

const idSchema = z.string().min(1).max(64);

/** Ask the AI for a draft reply. Never sends anything. */
export async function POST(_req: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await getOwnerSession())) {
    return NextResponse.json({ error: "Owner sign-in required." }, { status: 401 });
  }
  const { id } = await context.params;
  if (!idSchema.safeParse(id).success) return NextResponse.json({ error: "Chat not found." }, { status: 404 });
  try {
    const r = await suggestReply(id);
    if (r.ok) return NextResponse.json({ draft: r.draft });
    const status = r.reason === "not_found" ? 404 : r.reason === "quota_out" ? 429 : r.reason === "failed" ? 502 : 409;
    return NextResponse.json({ error: r.message, reason: r.reason }, { status });
  } catch (err) {
    console.error("[assistant] suggest", id, err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Couldn't write a reply. Try again." }, { status: 500 });
  }
}
