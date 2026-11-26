"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, Smartphone, Trash2 } from "lucide-react";
import { Group } from "@/components/ui/Button";
import { Disclosure } from "@/components/ui/Disclosure";
import { Switch } from "@/components/ui/Switch";
import { toast } from "@/components/ui/Toast";
import { rowClass, rowLinkClass } from "@/components/settings/shared";
import {
  detectPushEnvironment,
  getCurrentPushSubscription,
  subscribeThisDevice,
  unsubscribeThisDevice,
  type PushEnvironment,
} from "@/lib/ui/push-client";

interface PushDeviceRow {
  id: string;
  endpoint: string;
  deviceLabel: string;
  createdAt: string;
  lastUsedAt: string | null;
}

interface PushServerState {
  configured: boolean;
  migrationPending?: boolean;
  publicKey: string | null;
  devices: PushDeviceRow[];
}

export function PushSettings() {
  const [env, setEnv] = useState<PushEnvironment | null>(null);
  const [server, setServer] = useState<PushServerState | null>(null);
  const [currentEndpoint, setCurrentEndpoint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const loadState = useCallback(async () => {
    setEnv(detectPushEnvironment());
    const [res, sub] = await Promise.all([
      fetch("/api/push/subscriptions", { cache: "no-store" }).catch(() => null),
      getCurrentPushSubscription(),
    ]);
    setCurrentEndpoint(sub?.endpoint ?? null);
    if (res?.ok) {
      const data = (await res.json()) as PushServerState;
      setServer(data);
    }
  }, []);

  useEffect(() => {
    void loadState();
  }, [loadState]);

  const isThisDeviceSubscribed = Boolean(
    currentEndpoint && server?.devices.some((d) => d.endpoint === currentEndpoint)
  );
  const deviceCount = server?.devices.length ?? 0;

  async function handleToggle(next: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      if (next) {
        if (!server?.publicKey) {
          toast("Push keys aren't set up on the server yet", "error");
          return;
        }
        await subscribeThisDevice(server.publicKey);
        toast("Notifications turned on");
      } else {
        await unsubscribeThisDevice();
        toast("Notifications turned off");
      }
      await loadState();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't update notifications", "error");
      await loadState();
    } finally {
      setBusy(false);
    }
  }

  async function handleTest() {
    if (testing) return;
    setTesting(true);
    try {
      const res = await fetch("/api/push/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(currentEndpoint ? { endpoint: currentEndpoint } : {}),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        toast(data?.error || "Couldn't send test notification", "error");
        await loadState();
        return;
      }
      toast("Test notification sent");
    } finally {
      setTesting(false);
    }
  }

  async function handleRemoveDevice(device: PushDeviceRow) {
    setRemovingId(device.id);
    try {
      if (device.endpoint === currentEndpoint) {
        await unsubscribeThisDevice();
      } else {
        await fetch("/api/push/subscriptions", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: device.id }),
        });
      }
      toast(`Removed ${device.deviceLabel}`);
      await loadState();
    } catch {
      toast("Couldn't remove device", "error");
    } finally {
      setRemovingId(null);
    }
  }

  const blocked = env?.permission === "denied";
  const canToggle = Boolean(server?.configured && !server.migrationPending && env?.supported && !blocked);

  let subtitle = "Buyer messages, approvals, finished waves, return & stock alerts";
  if (server && !server.configured) {
    subtitle = "Needs VAPID push keys in server settings";
  } else if (server?.migrationPending) {
    subtitle = "Database update needed before turning on";
  } else if (env?.needsHomeScreenInstall) {
    subtitle = "Add to Home Screen first on iPhone/iPad";
  } else if (env && !env.supported) {
    subtitle = "Not supported in this browser";
  } else if (blocked) {
    subtitle = "Blocked in your phone or browser settings";
  } else if (!isThisDeviceSubscribed) {
    subtitle = "Get alerts on your phone even when the app is closed";
  }

  return (
    <section>
      <h2 className="mb-2 px-4 text-[15px] font-semibold text-ink-3">Phone notifications</h2>
      <Group className="divide-y divide-hairline">
        <div className={rowClass}>
          <span className="flex min-w-0 flex-col">
            <span className="flex items-center gap-2 text-[17px] text-ink">
              <Bell className="h-[18px] w-[18px] shrink-0 text-ink-3" />
              <span>Alerts on this device</span>
            </span>
            <span className="text-[13px] text-ink-3">{subtitle}</span>
          </span>
          <Switch
            checked={isThisDeviceSubscribed}
            onChange={(next) => void handleToggle(next)}
            disabled={busy || !canToggle}
            label="Alerts on this device"
          />
        </div>

        {env?.needsHomeScreenInstall && (
          <div className="bg-brand-soft/60 px-4 py-3 text-[14px] leading-snug text-ink-2">
            On iPhone or iPad, tap <strong className="font-semibold text-ink">Share</strong> →{" "}
            <strong className="font-semibold text-ink">Add to Home Screen</strong>, then open Kyna Ops from your Home
            Screen to turn on alerts.
          </div>
        )}

        {blocked && (
          <div className="px-4 py-3 text-[14px] leading-snug text-ink-2">
            Notifications are blocked for Kyna Ops. Allow them in your browser or phone settings, then refresh this
            page.
          </div>
        )}

        {isThisDeviceSubscribed && (
          <button
            type="button"
            disabled={testing}
            onClick={() => void handleTest()}
            className={`${rowLinkClass} w-full text-left disabled:opacity-50`}
          >
            <span className="text-[17px] text-brand">
              {testing ? "Sending test…" : "Send a test notification"}
            </span>
          </button>
        )}

        {deviceCount > 0 && (
          <Disclosure
            summaryClassName={rowLinkClass}
            label={
              <span className="text-[17px] text-ink">
                {deviceCount === 1 ? "1 linked device" : `${deviceCount} linked devices`}
              </span>
            }
          >
            <div className="divide-y divide-hairline border-t border-hairline">
              {server?.devices.map((d) => {
                const isHere = d.endpoint === currentEndpoint;
                return (
                  <div key={d.id} className="flex min-h-[52px] items-center justify-between gap-3 px-4 py-2">
                    <span className="flex min-w-0 items-center gap-2.5">
                      <Smartphone className="h-4 w-4 shrink-0 text-ink-3" />
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-[15px] font-medium text-ink">
                          {d.deviceLabel}
                          {isHere ? " · This device" : ""}
                        </span>
                      </span>
                    </span>
                    <button
                      type="button"
                      disabled={removingId === d.id}
                      onClick={() => void handleRemoveDevice(d)}
                      aria-label={`Remove ${d.deviceLabel}`}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-ink-3 hover:bg-surface-muted hover:text-missing-ink disabled:opacity-50"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          </Disclosure>
        )}
      </Group>
    </section>
  );
}
