import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  createOwnerToken,
  OWNER_COOKIE,
  verifySecret,
} from "@/lib/auth";
import { pinFailureUpdate, pinLockRemainingMs } from "@/lib/pin-lockout";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Please enter a valid email and password." },
        { status: 400 }
      );
    }

    const user = await prisma.ownerUser.findUnique({
      where: { email: parsed.data.email.trim().toLowerCase() },
    });
    if (!user) {
      return NextResponse.json(
        { error: "Incorrect email or password." },
        { status: 401 }
      );
    }

    const now = new Date();
    const lockRemaining = pinLockRemainingMs(user.loginLockedUntil, now);
    if (lockRemaining > 0) {
      const minutes = Math.max(1, Math.ceil(lockRemaining / 60_000));
      return NextResponse.json(
        { error: `Too many wrong password tries. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.` },
        { status: 429 }
      );
    }

    const valid = await verifySecret(parsed.data.password, user.passwordHash);
    if (!valid) {
      const bumped = await prisma.ownerUser.update({
        where: { id: user.id },
        data: { failedLoginAttempts: { increment: 1 } },
        select: { failedLoginAttempts: true },
      });
      const next = pinFailureUpdate(bumped.failedLoginAttempts, now);
      if (next.locked) {
        await prisma.ownerUser.update({
          where: { id: user.id },
          data: { failedLoginAttempts: next.failedPinAttempts, loginLockedUntil: next.pinLockedUntil },
        });
        const minutes = Math.max(1, Math.ceil((next.pinLockedUntil!.getTime() - now.getTime()) / 60_000));
        return NextResponse.json(
          { error: `Too many wrong password tries. Try again in ${minutes} minutes.` },
          { status: 429 }
        );
      }
      return NextResponse.json(
        { error: "Incorrect email or password." },
        { status: 401 }
      );
    }

    if (user.failedLoginAttempts > 0 || user.loginLockedUntil) {
      await prisma.ownerUser.update({
        where: { id: user.id },
        data: { failedLoginAttempts: 0, loginLockedUntil: null },
      });
    }

    const token = await createOwnerToken({
      role: "owner",
      userId: user.id,
      email: user.email,
      name: user.name,
    });

    const res = NextResponse.json({
      ok: true,
      user: { id: user.id, email: user.email, name: user.name },
    });
    res.cookies.set(OWNER_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    return res;
  } catch (err) {
    console.error("[Owner login error]", err);
    return NextResponse.json({ error: "Could not sign in right now." }, { status: 500 });
  }
}
