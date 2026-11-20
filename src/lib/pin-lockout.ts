/**
 * Staff PIN brute-force protection.
 *
 * A 4-digit PIN has only 10,000 combinations, so after PIN_MAX_ATTEMPTS wrong
 * tries the staff member is locked for PIN_LOCK_MINUTES. Reaching the limit
 * resets the counter, so after the lock expires they get a fresh set of tries.
 */
export const PIN_MAX_ATTEMPTS = 5;
export const PIN_LOCK_MINUTES = 15;

/** Milliseconds left on the lock, or 0 if not locked. */
export function pinLockRemainingMs(lockedUntil: Date | null, now: Date): number {
  if (!lockedUntil) return 0;
  return Math.max(0, lockedUntil.getTime() - now.getTime());
}

/**
 * Given the attempt count AFTER recording this failure, returns what to store.
 */
export function pinFailureUpdate(
  attemptsAfterFailure: number,
  now: Date
): { failedPinAttempts: number; pinLockedUntil: Date | null; locked: boolean; attemptsLeft: number } {
  if (attemptsAfterFailure >= PIN_MAX_ATTEMPTS) {
    return {
      failedPinAttempts: 0,
      pinLockedUntil: new Date(now.getTime() + PIN_LOCK_MINUTES * 60_000),
      locked: true,
      attemptsLeft: 0,
    };
  }
  return {
    failedPinAttempts: attemptsAfterFailure,
    pinLockedUntil: null,
    locked: false,
    attemptsLeft: PIN_MAX_ATTEMPTS - attemptsAfterFailure,
  };
}

export function lockedMessage(remainingMs: number): string {
  const minutes = Math.max(1, Math.ceil(remainingMs / 60_000));
  return `Too many wrong PINs. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}, or ask the owner to reset your PIN.`;
}
