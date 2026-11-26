import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { actorFromSession } from "@/lib/audit";
import { getOwnerSession } from "@/lib/auth";
import { aiAutosendSetting, aiSettingsInput, shopAnswerInput } from "@/lib/ai/settings";
import {
  deleteShopAnswer,
  getAiSettings,
  listShopAnswers,
  saveShopAnswer,
  undoShopAnswer,
  updateAiSettings,
} from "@/lib/ai/settings-store";

export const dynamic = "force-dynamic";

/** Chats assistant settings and shop answers. */
export async function GET() {
  if (!(await getOwnerSession())) {
    return NextResponse.json({ error: "Owner sign-in required." }, { status: 401 });
  }
  try {
    const [settings, answers] = await Promise.all([getAiSettings(), listShopAnswers()]);
    const envAuto = aiAutosendSetting();
    return NextResponse.json({
      settings,
      answers,
      testAutosendCount: envAuto instanceof Set ? envAuto.size : 0,
    });
  } catch (err) {
    console.error("[assistant] load", err);
    return NextResponse.json({ error: "Couldn't load the assistant settings." }, { status: 500 });
  }
}

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("update_settings"), settings: aiSettingsInput }),
  z.object({ action: z.literal("save_answer"), answer: shopAnswerInput }),
  z.object({ action: z.literal("undo_answer"), id: z.string().min(1).max(64) }),
  z.object({ action: z.literal("delete_answer"), id: z.string().min(1).max(64) }),
]);

export async function POST(req: NextRequest) {
  const session = await getOwnerSession();
  if (!session) {
    return NextResponse.json({ error: "Owner sign-in required." }, { status: 401 });
  }
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Check the fields and try again." }, { status: 400 });
  }
  try {
    const d = parsed.data;
    if (d.action === "update_settings") {
      return NextResponse.json({
        settings: await updateAiSettings(d.settings, actorFromSession(session)),
      });
    }
    if (d.action === "save_answer") return NextResponse.json({ answer: await saveShopAnswer(d.answer) });
    if (d.action === "undo_answer") return NextResponse.json({ answer: await undoShopAnswer(d.id) });
    await deleteShopAnswer(d.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (message === "Answer not found." || message === "Nothing to undo.") {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    console.error("[assistant] save", err);
    return NextResponse.json({ error: "Couldn't save. Try again." }, { status: 500 });
  }
}
