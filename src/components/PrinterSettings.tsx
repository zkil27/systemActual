"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Group } from "@/components/ui/Button";
import { toast } from "@/components/ui/Toast";
import { manilaDateTime } from "@/lib/ui/format";

interface PrinterStatus {
  device: { name: string; online: boolean; lastSeenAt: string | null; paused: boolean; printerName: string | null } | null;
  queued: number;
  printing: number;
  failedToday: number;
  lastTest: { status: string; error: string | null; createdAt: string } | null;
}

const TEST_LABEL: Record<string, string> = {
  QUEUED: "waiting for the PC",
  PRINTING: "printing…",
  PRINTED: "printed",
  FAILED: "failed",
};

async function call(action: string) {
  const res = await fetch("/api/printer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong");
  return data;
}

/** Warehouse printer: status, test print, pause/resume, first-time setup. */
export function PrinterSettings() {
  const [status, setStatus] = useState<PrinterStatus | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/printer");
    if (res.ok) setStatus(await res.json());
  }, []);

  useEffect(() => {
    load();
    const tick = () => {
      if (!document.hidden) void load();
    };
    const onVisibility = () => {
      if (!document.hidden) void load();
    };
    const t = setInterval(tick, 10_000);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load]);

  async function run(action: string, done: string) {
    setBusy(true);
    try {
      const data = await call(action);
      if (data.token) setToken(data.token);
      toast(done);
      await load();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  const d = status?.device;
  const state = !d ? "Not set up" : d.paused ? "Paused" : d.online ? "Online" : "Offline";
  const pendingCount = (status?.queued ?? 0) + (status?.printing ?? 0);
  const dotClass = !d
    ? "bg-ink-3/40"
    : d.paused
      ? "bg-failed"
      : d.online
        ? "bg-arrived anim-pulse-dot"
        : "bg-ink-3/50";
  const rowActionClass =
    "group pressable-row flex min-h-[52px] w-full items-center justify-between gap-4 px-4 text-left hover:bg-surface-subtle active:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <section>
      <h2 className="mb-2 px-4 text-[15px] font-semibold text-ink-3">Printer</h2>
      <Group className="divide-y divide-hairline">
        <div className="space-y-4 p-4">
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[17px] font-semibold text-ink">{d?.printerName || "Warehouse PC"}</span>
              <span
                className={`inline-flex items-center gap-1.5 text-[15px] font-semibold ${
                  state === "Online" ? "text-arrived" : state === "Paused" ? "text-failed-ink" : "text-ink-3"
                }`}
              >
                <span className={`h-2 w-2 rounded-full ${dotClass}`} aria-hidden="true" />
                {state}
              </span>
            </div>

            {d && (
              <p className="text-[15px] text-ink-3 tabular-nums">
                {d.lastSeenAt ? `Last seen ${manilaDateTime(d.lastSeenAt)}` : "Hasn't connected yet"}
                {pendingCount > 0 ? ` · ${pendingCount} to print` : ""}
                {status?.failedToday ? ` · ${status.failedToday} failed today` : ""}
              </p>
            )}

            {status?.lastTest && (
              <p className={`text-[15px] ${status.lastTest.status === "FAILED" ? "text-missing-ink" : "text-ink-3"}`}>
                Test print: {TEST_LABEL[status.lastTest.status] ?? status.lastTest.status}
                {status.lastTest.error ? ` (${status.lastTest.error})` : ""}
              </p>
            )}
          </div>

          {token && (
            <div className="anim-rise-in space-y-2 rounded-[var(--radius-control)] bg-brand-soft p-3">
              <p className="text-[15px] font-semibold text-ink">
                Put this code in the print agent on the warehouse PC. It&apos;s shown only once.
              </p>
              <code className="block select-all break-all rounded-lg bg-surface p-2 text-[15px] text-ink">{token}</code>
              <Button
                variant="secondary"
                onClick={() => navigator.clipboard?.writeText(token).then(() => toast("Copied"))}
              >
                Copy code
              </Button>
            </div>
          )}

          {d ? (
            <div className="grid grid-cols-2 gap-2.5">
              <Button full disabled={busy} onClick={() => run("test_print", "Test print sent")}>
                Test print
              </Button>
              <Button
                full
                variant="secondary"
                disabled={busy}
                onClick={() => run(d.paused ? "resume" : "pause", d.paused ? "Printing resumed" : "Printing paused")}
              >
                {d.paused ? "Resume printing" : "Pause printing"}
              </Button>
            </div>
          ) : (
            <Button full disabled={busy} onClick={() => run("setup", "PC code ready")}>
              Set up printer PC
            </Button>
          )}
        </div>

        {d && pendingCount > 0 && (
          <button
            type="button"
            disabled={busy}
            className={rowActionClass}
            onClick={() => {
              if (!window.confirm(`Cancel ${pendingCount} pending print ${pendingCount === 1 ? "job" : "jobs"}?`)) return;
              run("clear_queue", "Print queue cleared");
            }}
          >
            <span className="text-[16px] font-semibold text-missing-ink">Clear print queue</span>
            <span className="text-[15px] font-semibold tabular-nums text-missing-ink">{pendingCount} pending</span>
          </button>
        )}

        {d && (
          <button
            type="button"
            disabled={busy}
            className={rowActionClass}
            onClick={() => {
              if (!window.confirm("Make a new code? The PC stops printing until you enter the new code there.")) return;
              run("setup", "New code made");
            }}
          >
            <span className="text-[16px] font-semibold text-brand">New PC code</span>
          </button>
        )}
      </Group>
    </section>
  );
}
