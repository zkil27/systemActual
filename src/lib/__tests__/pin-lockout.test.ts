import { describe, expect, it } from "vitest";
import {
  PIN_LOCK_MINUTES,
  PIN_MAX_ATTEMPTS,
  lockedMessage,
  pinFailureUpdate,
  pinLockRemainingMs,
} from "@/lib/pin-lockout";

const now = new Date("2026-11-21T02:00:00.000Z");

describe("staff PIN lockout", () => {
  it("counts down attempts before the limit", () => {
    const first = pinFailureUpdate(1, now);
    expect(first).toMatchObject({ locked: false, failedPinAttempts: 1, attemptsLeft: PIN_MAX_ATTEMPTS - 1 });
    expect(first.pinLockedUntil).toBeNull();
    expect(pinFailureUpdate(PIN_MAX_ATTEMPTS - 1, now).attemptsLeft).toBe(1);
  });

  it("locks on the 5th wrong PIN for 15 minutes and resets the counter", () => {
    const fifth = pinFailureUpdate(PIN_MAX_ATTEMPTS, now);
    expect(fifth.locked).toBe(true);
    expect(fifth.failedPinAttempts).toBe(0);
    expect(fifth.pinLockedUntil!.getTime() - now.getTime()).toBe(PIN_LOCK_MINUTES * 60_000);
  });

  it("a 6th attempt during the lock is refused", () => {
    const { pinLockedUntil } = pinFailureUpdate(PIN_MAX_ATTEMPTS, now);
    const sixthTry = new Date(now.getTime() + 60_000);
    expect(pinLockRemainingMs(pinLockedUntil, sixthTry)).toBe(14 * 60_000);
  });

  it("the lock expires after 15 minutes", () => {
    const { pinLockedUntil } = pinFailureUpdate(PIN_MAX_ATTEMPTS, now);
    const later = new Date(now.getTime() + PIN_LOCK_MINUTES * 60_000);
    expect(pinLockRemainingMs(pinLockedUntil, later)).toBe(0);
    expect(pinLockRemainingMs(null, now)).toBe(0);
  });

  it("tells staff how long to wait", () => {
    expect(lockedMessage(14 * 60_000 + 1)).toContain("15 minutes");
    expect(lockedMessage(30_000)).toContain("1 minute,");
  });
});
