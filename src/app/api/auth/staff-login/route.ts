import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createStaffToken, STAFF_COOKIE, verifySecret } from "@/lib/auth";

const staffPinSchema = z.object({
  staffId: z.string().min(1),
  pin: z.string().regex(/^\d{4}$/, "PIN must be 4 digits"),
});

export async function GET() {
  try {
    const staff = await prisma.staffMember.findMany({
      where: { active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    return NextResponse.json({ staff });
  } catch (err) {
    console.error("[Staff list error]", err);
    return NextResponse.json({ staff: [], error: "Could not load staff list." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = staffPinSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Pick your name and enter your 4-digit PIN." },
        { status: 400 }
      );
    }

    const member = await prisma.staffMember.findFirst({
      where: { id: parsed.data.staffId, active: true },
    });
    if (!member) {
      return NextResponse.json({ error: "Staff member not found." }, { status: 404 });
    }

    const ok = await verifySecret(parsed.data.pin, member.pinHash);
    if (!ok) {
      return NextResponse.json({ error: "Wrong 4-digit PIN. Try again." }, { status: 401 });
    }

    const token = await createStaffToken({
      role: "staff",
      staffId: member.id,
      name: member.name,
    });

    const res = NextResponse.json({
      ok: true,
      staff: { id: member.id, name: member.name },
    });
    res.cookies.set(STAFF_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 14,
    });
    return res;
  } catch (err) {
    console.error("[Staff PIN login error]", err);
    return NextResponse.json({ error: "Could not unlock scanner." }, { status: 500 });
  }
}
