import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { updateDraft } from "@/lib/ai/drafts";

const body = z.object({
  draftId: z.string().min(1).max(64),
  action: z.enum(["use", "dismiss", "rate"]),
  rating: z.enum(["good", "bad"]).optional(),
});

/** Owner only (middleware). Use, dismiss or rate the assistant's draft. */
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!id || id.length > 64 || !parsed.success) return NextResponse.json({ error: "Try again." }, { status: 400 });
  try {
    const ok = await updateDraft(id, parsed.data.draftId, parsed.data.action, parsed.data.rating);
    if (!ok) return NextResponse.json({ error: "This draft isn't here anymore." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[assistant] draft", id, err);
    return NextResponse.json({ error: "Couldn't update the draft." }, { status: 500 });
  }
}
