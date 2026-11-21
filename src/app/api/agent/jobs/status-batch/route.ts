import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { deviceFromAuthHeader } from "@/lib/print/device";
import { reportJobsBatch } from "@/lib/print/jobs";

const itemSchema = z.discriminatedUnion("status", [
  z.object({ id: z.string().min(1), status: z.literal("PRINTED") }),
  z.object({ id: z.string().min(1), status: z.literal("FAILED"), error: z.string().max(2000) }),
]);

const bodySchema = z.object({
  results: z.array(itemSchema).min(1).max(100),
});

/** Batch job status reporting so the print agent sends 1 POST per chunk instead of 25. */
export async function POST(req: NextRequest) {
  const device = await deviceFromAuthHeader(req.headers.get("authorization"));
  if (!device) return NextResponse.json({ error: "Unknown printer" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid batch report" }, { status: 400 });

  const outcomes = await reportJobsBatch(device.id, parsed.data.results);
  const fresh = await prisma.printDevice.findUnique({ where: { id: device.id }, select: { paused: true } });

  return NextResponse.json({
    ok: true,
    paused: Boolean(fresh?.paused),
    results: outcomes,
  });
}
