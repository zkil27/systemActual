"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { toast } from "@/components/ui/Toast";
import { fieldClass, postSettings, type StaffRow } from "./shared";

/** Tap a staff row: rename, reset PIN, clear a lockout. */
export function StaffSheet({
  staff,
  onClose,
  onSaved,
}: {
  staff: StaffRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const last = useRef<StaffRow | null>(null);
  if (staff) last.current = staff;
  const s = last.current;
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (staff) {
      setName(staff.name);
      setPin("");
    }
  }, [staff]);

  async function run(body: Record<string, unknown>, done: string) {
    setBusy(true);
    const { ok, data } = await postSettings(body);
    setBusy(false);
    if (!ok) return toast(String(data.error ?? "Couldn't save"), "error");
    toast(done);
    onSaved();
  }

  return (
    <Sheet open={staff !== null} onClose={onClose} title={s?.name ?? "Staff"}>
      {s && (
        <div className="space-y-6 pt-1">
          {s.locked && (
            <div className="flex items-center justify-between gap-3 rounded-[var(--radius-control)] bg-missing-soft px-4 py-2">
              <span className="text-[15px] font-semibold text-missing-ink">Locked out after wrong PINs</span>
              <Button
                variant="plain"
                disabled={busy}
                onClick={() => run({ action: "clear_staff_lockout", staffId: s.id }, "Unlocked")}
                className="h-11 px-3"
              >
                Unlock
              </Button>
            </div>
          )}
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!/^\d{4}$/.test(pin)) return toast("PIN must be 4 digits", "error");
              void run({ action: "update_staff_pin", staffId: s.id, pin }, "New PIN saved. They need to unlock again.");
              setPin("");
            }}
          >
            <label className="block">
              <span className="mb-1 block text-[14px] font-semibold text-ink-3">New 4-digit PIN</span>
              <input
                inputMode="numeric"
                autoComplete="off"
                maxLength={4}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                className={`tabular-nums tracking-[0.4em] ${fieldClass}`}
              />
            </label>
            <Button type="submit" full disabled={busy || pin.length !== 4}>
              Reset PIN
            </Button>
          </form>
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim() || name.trim() === s.name) return;
              void run({ action: "rename_staff", staffId: s.id, staffName: name.trim() }, "Renamed");
            }}
          >
            <label className="block">
              <span className="mb-1 block text-[14px] font-semibold text-ink-3">Name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} className={fieldClass} />
            </label>
            <Button type="submit" variant="secondary" full disabled={busy || !name.trim() || name.trim() === s.name}>
              Rename
            </Button>
          </form>
          <Button
            variant={s.active ? "danger" : "secondary"}
            full
            disabled={busy}
            onClick={() =>
              run({ action: "toggle_staff", staffId: s.id, active: !s.active }, s.active ? "Turned off" : "Turned on")
            }
          >
            {s.active ? "Turn off (signs them out now)" : "Let them use the scanner again"}
          </Button>
        </div>
      )}
    </Sheet>
  );
}
