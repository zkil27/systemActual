import { NextRequest, NextResponse } from "next/server";
import { deviceFromAuthHeader } from "@/lib/print/device";
import { releaseJobs } from "@/lib/print/jobs";

/** The PC hands back jobs it claimed but won't print (paused, shutting down). */
export async function POST(req: NextRequest) {
  const device = await deviceFromAuthHeader(req.headers.get("authorization"));
  if (!device) return NextResponse.json({ error: "Unknown printer" }, { status: 401 });
  return NextResponse.json({ released: await releaseJobs(device.id) });
}
