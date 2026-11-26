export interface StaffRow {
  id: string;
  name: string;
  active: boolean;
  locked: boolean;
  lockedUntil: string | null;
  failedPinAttempts: number;
}

export const fieldClass =
  "h-12 w-full rounded-[var(--radius-control)] bg-surface-muted px-3.5 text-[16px] text-ink focus:shadow-[0_0_0_2px_var(--color-brand)] focus:outline-none";

export const rowClass = "flex min-h-[52px] items-center justify-between gap-4 px-4";
export const rowLinkClass = `${rowClass} group pressable-row hover:bg-surface-subtle active:bg-surface-muted`;

export async function postSettings(
  body: Record<string, unknown>
): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  try {
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok && data.ok !== false, data };
  } catch {
    return { ok: false, data: { error: "No connection" } };
  }
}
