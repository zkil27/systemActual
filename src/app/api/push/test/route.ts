import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getOwnerSession } from "@/lib/auth";
import { isPushConfigured, sendOwnerPush } from "@/lib/push";

const testSchema = z
  .object({
    endpoint: z.string().trim().url().optional(),
  })
  .optional();

export async function POST(req: NextRequest) {
  const owner = await getOwnerSession();
  if (!owner) {
    return NextResponse.json({ error: "Owner sign-in required." }, { status: 401 });
  }
  if (!isPushConfigured()) {
    return NextResponse.json({ error: "Push notifications are not configured on the server." }, { status: 503 });
  }

  const body = await req.json().catch(() => undefined);
  const parsed = testSchema.safeParse(body);
  const endpoint = parsed.success ? parsed.data?.endpoint : undefined;

  const result = await sendOwnerPush(
    {
      title: "Kyna Ops notifications are on",
      body: "You'll get alerts here for buyer messages, approvals, finished waves, and stock or return issues.",
      url: "/settings",
      tag: "kyna-test",
    },
    { ownerUserId: owner.userId, endpoint }
  );

  if (result.sent === 0) {
    return NextResponse.json(
      {
        error:
          result.pruned > 0
            ? "This device's notification link expired. Turn notifications off and on again."
            : "No active device received the test notification.",
        ...result,
      },
      { status: 400 }
    );
  }

  return NextResponse.json({ ok: true, ...result });
}
