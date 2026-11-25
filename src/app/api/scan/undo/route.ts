import { after, NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getScannerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { undoReturnScan } from "@/lib/returns/undo-scan";
import { missingWhere } from "@/lib/returns/rules";
import { resolveActorStaffMemberId } from "@/lib/shipping/outbound";
import { pushStock } from "@/lib/stock/push";
import { actorFromSession } from "@/lib/audit";

const bodySchema = z.object({ scanId: z.string().min(1) });

/** Take back a return scan saved in the last 5 minutes. */
export async function POST(req: NextRequest) {
  const session = await getScannerSession();
  if (!session) return NextResponse.json({ error: "Unlock with your PIN first." }, { status: 401 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Pick a scan." }, { status: 400 });

  try {
    const res = await undoReturnScan(parsed.data.scanId, {
      staffMemberId: await resolveActorStaffMemberId(session),
      isOwner: session.actorType === "owner",
      audit: actorFromSession(session),
    });
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
    if (res.restockDelta !== 0) {
      after(() => pushStock(Date.now() + 25_000).catch((err) => console.error("[scan undo] pushStock", err)));
    }
    const settings = await prisma.appSettings.findUnique({ where: { id: "default" }, select: { missingSinceAt: true } });
    const pendingMissingCount = await prisma.returnParcel.count({ where: missingWhere(settings?.missingSinceAt ?? null) });
    return NextResponse.json({ ok: true, restockDelta: res.restockDelta, pendingMissingCount });
  } catch (err) {
    console.error("[scan undo]", err);
    return NextResponse.json({ error: "Couldn't undo. Try again." }, { status: 500 });
  }
}
