import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createStaffToken, STAFF_COOKIE, verifySecret } from "@/lib/auth";
import { lockedMessage, pinFailureUpdate, pinLockRemainingMs } from "@/lib/pin-lockout";

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

    const now = new Date();
    const lockRemaining = pinLockRemainingMs(member.pinLockedUntil, now);
    if (lockRemaining > 0) {
      // Don't check the PIN at all while locked.
      return NextResponse.json({ error: lockedMessage(lockRemaining) }, { status: 429 });
    }

    const ok = await verifySecret(parsed.data.pin, member.pinHash);
    if (!ok) {
      // Atomic increment so parallel guesses can't undercount.
      const bumped = await prisma.staffMember.update({
        where: { id: member.id },
        data: { failedPinAttempts: { increment: 1 } },
        select: { failedPinAttempts: true },
      });
      const next = pinFailureUpdate(bumped.failedPinAttempts, now);
      if (next.locked) {
        await prisma.staffMember.update({
          where: { id: member.id },
          data: { failedPinAttempts: next.failedPinAttempts, pinLockedUntil: next.pinLockedUntil },
        });
        return NextResponse.json(
          { error: lockedMessage(next.pinLockedUntil!.getTime() - now.getTime()) },
          { status: 429 }
        );
      }
      return NextResponse.json(
        {
          error: `Wrong PIN. ${next.attemptsLeft} ${next.attemptsLeft === 1 ? "try" : "tries"} left.`,
        },
        { status: 401 }
      );
    }

    if (member.failedPinAttempts > 0 || member.pinLockedUntil) {
      await prisma.staffMember.update({
        where: { id: member.id },
        data: { failedPinAttempts: 0, pinLockedUntil: null },
      });
    }

    const token = await createStaffToken({
      role: "staff",
      staffId: member.id,
      name: member.name,
      tv: member.tokenVersion,
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
