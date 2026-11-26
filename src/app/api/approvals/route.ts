import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { actorFromSession } from "@/lib/audit";
import { getOwnerSession } from "@/lib/auth";
import {
  approveActionRequest,
  countPendingActionRequests,
  listActionRequests,
  rejectActionRequest,
} from "@/lib/approvals/service";

export const dynamic = "force-dynamic";

const postSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("approve"),
    id: z.string().min(1).max(64),
    editedText: z.string().max(1000).optional(),
  }),
  z.object({
    action: z.literal("reject"),
    id: z.string().min(1).max(64),
    reason: z.string().max(200).optional(),
  }),
]);

export async function GET(req: NextRequest) {
  if (!(await getOwnerSession())) {
    return NextResponse.json({ error: "Owner sign-in required." }, { status: 401 });
  }
  const statusParam = (req.nextUrl.searchParams.get("status") || "ALL").toUpperCase();
  const status =
    statusParam === "PENDING" ||
    statusParam === "DONE" ||
    statusParam === "REJECTED" ||
    statusParam === "FAILED" ||
    statusParam === "EXPIRED"
      ? statusParam
      : "ALL";

  const [requests, pendingCount] = await Promise.all([
    listActionRequests({ status }),
    countPendingActionRequests(),
  ]);
  return NextResponse.json({ requests, pendingCount });
}

export async function POST(req: NextRequest) {
  const session = await getOwnerSession();
  if (!session) {
    return NextResponse.json({ error: "Owner sign-in required." }, { status: 401 });
  }

  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request." },
      { status: 400 }
    );
  }

  const actor = actorFromSession(session);
  const d = parsed.data;
  const result =
    d.action === "approve"
      ? await approveActionRequest(d.id, { actor, editedText: d.editedText })
      : await rejectActionRequest(d.id, { actor, reason: d.reason });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ request: result.request });
}
