import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { deviceFromAuthHeader } from "@/lib/print/device";
import { reportJob } from "@/lib/print/jobs";

const bodySchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("PRINTED") }),
  z.object({ status: z.literal("FAILED"), error: z.string().max(2000) }),
]);

/** The PC reports each job. The reply says whether to keep going or pause. */
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const device = await deviceFromAuthHeader(req.headers.get("authorization"));
  if (!device) return NextResponse.json({ error: "Unknown printer" }, { status: 401 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid report" }, { status: 400 });

  const { id } = await context.params;
  const result = await reportJob(device.id, id, parsed.data);
  const fresh = await prisma.printDevice.findUnique({ where: { id: device.id }, select: { paused: true } });
  if (!result.ok) {
    return NextResponse.json({ error: result.reason, paused: Boolean(fresh?.paused) }, { status: 409 });
  }
  return NextResponse.json({ ok: true, paused: Boolean(fresh?.paused) });
}
