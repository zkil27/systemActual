"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { toast } from "@/components/ui/Toast";
import { manilaDateTime } from "@/lib/ui/format";

export interface WaveSchedule {
  auto: boolean;
  continuous: boolean;
  times: string[];
  nextAt: string | null;
}

const PRESET_TIMES = ["08:30", "10:30", "12:30", "14:30", "15:30", "17:30"];

/** "08:30" → "8:30 AM" */
function clock(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** Auto-ship settings. Edits are local until Save / Turn on; reopening starts from what's saved. */
export function AutoShipSheet({
  open,
  onClose,
  schedule,
  canShip,
  busy,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  schedule: WaveSchedule | null;
  canShip: boolean;
  busy: boolean;
  onSave: (auto: boolean, times: string[], continuous: boolean) => Promise<boolean>;
}) {
  const [selectedTimes, setSelectedTimes] = useState<string[]>([]);
  const [continuousMode, setContinuousMode] = useState(false);
  const [customTime, setCustomTime] = useState("");

  useEffect(() => {
    if (!open) return;
    setSelectedTimes(schedule?.times ?? []);
    setContinuousMode(Boolean(schedule?.continuous));
    setCustomTime("");
  }, [open, schedule]);

  function toggleTime(t: string) {
    setSelectedTimes((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t].sort()));
  }

  function addCustomTime() {
    const trimmed = customTime.trim();
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(trimmed)) {
      toast("Enter time as HH:MM (e.g. 09:30 or 16:45)", "error");
      return;
    }
    setSelectedTimes((prev) => (prev.includes(trimmed) ? prev : [...prev, trimmed].sort()));
    setCustomTime("");
  }

  async function save(auto: boolean) {
    if (await onSave(auto, selectedTimes, continuousMode)) onClose();
  }

  const allTimes = [...new Set([...PRESET_TIMES, ...selectedTimes])].sort();

  return (
    <Sheet open={open} onClose={onClose} title="Auto-ship schedule">
      <div className="space-y-4">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[15px] text-ink-3">
            {schedule?.auto && schedule.nextAt ? `Next check ${manilaDateTime(schedule.nextAt)}` : "Status"}
          </span>
          <span className={`text-[15px] font-semibold ${schedule?.auto ? "text-arrived" : "text-ink-3"}`}>
            {schedule?.auto ? (schedule.continuous ? "Continuous" : "Scheduled") : "Off"}
          </span>
        </div>

        <button
          type="button"
          aria-pressed={continuousMode}
          onClick={() => setContinuousMode((c) => !c)}
          className={`pressable flex min-h-11 w-full items-center justify-between rounded-[var(--radius-control)] px-3.5 py-2 text-left text-[14px] font-semibold ${
            continuousMode
              ? "bg-brand-soft text-brand shadow-[inset_0_0_0_1.5px_var(--color-brand)]"
              : "bg-surface-muted text-ink-2"
          }`}
        >
          <span>Continuous auto-ship (every 15 mins)</span>
          <span>{continuousMode ? "Selected" : "Off"}</span>
        </button>

        {!continuousMode && (
          <div className="space-y-2.5">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-[15px] font-semibold text-ink">Wave times</p>
              <p className="text-[14px] text-ink-3 tabular-nums">
                {selectedTimes.length ? `${selectedTimes.length} selected` : "Manila time"}
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2" role="group" aria-label="Wave times, Manila time">
              {allTimes.map((t) => {
                const active = selectedTimes.includes(t);
                return (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={active}
                    onClick={() => toggleTime(t)}
                    className={`pressable relative flex h-14 items-center justify-center rounded-[var(--radius-control)] text-[16px] font-semibold tabular-nums transition-colors ${
                      active
                        ? "bg-brand-soft text-brand shadow-[inset_0_0_0_2px_var(--color-brand)]"
                        : "bg-surface-muted text-ink-2 hover:bg-surface-track"
                    }`}
                  >
                    {active && (
                      <Check className="absolute right-1.5 top-1.5 h-3.5 w-3.5" strokeWidth={3} aria-hidden="true" />
                    )}
                    {clock(t)}
                  </button>
                );
              })}
            </div>
            <div className="flex gap-2">
              <input
                value={customTime}
                onChange={(e) => setCustomTime(e.target.value)}
                placeholder="Add HH:MM (e.g. 19:00)"
                className="h-11 min-w-0 flex-1 rounded-[var(--radius-control)] bg-surface-muted px-3 text-[16px] tabular-nums text-ink focus:shadow-[0_0_0_2px_var(--color-brand)] focus:outline-none"
              />
              <Button variant="plain" type="button" onClick={addCustomTime} className="h-11 px-3">
                Add
              </Button>
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          {schedule?.auto ? (
            <>
              <Button variant="secondary" disabled={busy} onClick={() => save(true)}>
                Save schedule
              </Button>
              <Button variant="plain" disabled={busy} onClick={() => save(false)}>
                Turn off
              </Button>
            </>
          ) : (
            <Button full disabled={busy || !canShip} onClick={() => save(true)}>
              Turn on auto-ship
            </Button>
          )}
        </div>
      </div>
    </Sheet>
  );
}
