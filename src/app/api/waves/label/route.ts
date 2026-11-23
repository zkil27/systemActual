import { NextRequest, NextResponse } from "next/server";
import { PrintJobKind } from "@prisma/client";
import { getOwnerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { renderJobPdf } from "@/lib/print/render";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Owner-only on-device PDF download fallback when the warehouse thermal
 * printer PC is offline or unreachable.
 */
export async function GET(req: NextRequest) {
  if (!(await getOwnerSession())) {
    return NextResponse.json({ error: "Sign in" }, { status: 401 });
  }

  const packageId = req.nextUrl.searchParams.get("packageId")?.trim() || "";
  const orderSn = req.nextUrl.searchParams.get("orderSn")?.trim() || "";
  if (!packageId && !orderSn) {
    return NextResponse.json({ error: "Missing packageId or orderSn." }, { status: 400 });
  }

  const pkg = packageId
    ? await prisma.package.findUnique({
        where: { id: packageId },
        include: { order: { select: { orderSn: true } } },
      })
    : await prisma.package.findFirst({
        where: { order: { orderSn: { equals: orderSn, mode: "insensitive" } } },
        include: { order: { select: { orderSn: true } } },
        orderBy: { order: { platformCreatedAt: "desc" } },
      });

  if (!pkg) {
    return NextResponse.json({ error: "Parcel not found." }, { status: 404 });
  }

  try {
    const pdf = await renderJobPdf({
      kind: PrintJobKind.LABEL,
      title: `Label · ${pkg.order.orderSn}`,
      createdAt: new Date(),
      waveId: null,
      packageId: pkg.id,
      batchPackageIds: [],
    });
    const safeOrder = pkg.order.orderSn.replace(/[^A-Za-z0-9_-]+/g, "-");
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="label-${safeOrder}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not download label PDF." },
      { status: 502 }
    );
  }
}
