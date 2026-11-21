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

  return (
    <section>
      <h2 className="mb-2 px-4 text-[15px] font-semibold text-ink-3">Printer</h2>
      <Group className="space-y-4 p-4">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[17px] text-ink">{d?.printerName || "Warehouse PC"}</span>
          <span
            className={`text-[16px] font-semibold ${
              state === "Online" ? "text-arrived" : state === "Paused" ? "text-amber-800" : "text-ink-3"
            }`}
          >
            {state}
          </span>
        </div>

        {d && (
          <p className="text-[14px] text-ink-3 tabular-nums">
            {d.lastSeenAt ? `Last seen ${manilaDateTime(d.lastSeenAt)}` : "Hasn't connected yet"}
            {status && status.queued + status.printing > 0 ? ` · ${status.queued + status.printing} to print` : ""}
            {status?.failedToday ? ` · ${status.failedToday} failed today` : ""}
          </p>
        )}

        {status?.lastTest && (
          <p className={`text-[14px] ${status.lastTest.status === "FAILED" ? "text-missing-ink" : "text-ink-3"}`}>
            Test print: {TEST_LABEL[status.lastTest.status] ?? status.lastTest.status}
            {status.lastTest.error ? ` (${status.lastTest.error})` : ""}
          </p>
        )}

        {token && (
          <div className="space-y-2 rounded-[var(--radius-control)] bg-brand-soft p-3">
            <p className="text-[14px] font-semibold text-ink">
              Put this code in the print agent on the warehouse PC. It&apos;s shown only once.
            </p>
            <code className="block select-all break-all rounded-lg bg-white p-2 text-[15px] text-ink">{token}</code>
            <Button
              variant="secondary"
              onClick={() => navigator.clipboard?.writeText(token).then(() => toast("Copied"))}
            >
              Copy code
            </Button>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {d && (
            <>
              <Button disabled={busy} onClick={() => run("test_print", "Test print sent")}>
                Test print
              </Button>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => run(d.paused ? "resume" : "pause", d.paused ? "Printing resumed" : "Printing paused")}
              >
                {d.paused ? "Resume printing" : "Pause printing"}
              </Button>
            </>
          )}
          <Button
            variant={d ? "plain" : "primary"}
            disabled={busy}
            onClick={() => {
              if (d && !window.confirm("Make a new code? The PC stops printing until you enter the new code there.")) return;
              run("setup", "New code made");
            }}
          >
            {d ? "New PC code" : "Set up printer PC"}
          </Button>
        </div>
      </Group>
    </section>
  );
}
