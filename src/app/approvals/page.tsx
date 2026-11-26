"use client";

import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Group } from "@/components/ui/Button";
import { toast } from "@/components/ui/Toast";
import { ApprovalsPanel } from "@/components/approvals/ApprovalsPanel";
import type { ActionRequestDto } from "@/lib/approvals/service";
import { useLiveRefresh } from "@/lib/ui/use-live-refresh";

export default function ApprovalsPage() {
  const [requests, setRequests] = useState<ActionRequestDto[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/approvals", { cache: "no-store" });
      if (!res.ok) {
        if (res.status === 401) toast("Owner sign-in required.", "error");
        return;
      }
      const data = await res.json();
      setRequests(data.requests ?? []);
    } catch {
      toast("Couldn't refresh approvals.", "error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useLiveRefresh({ onRefresh: load });

  return (
    <AppShell title="Approvals" onRefresh={load}>
      {loading ? (
        <Group className="p-6 text-center text-[14px] text-ink-3">
          Loading approvals...
        </Group>
      ) : (
        <ApprovalsPanel requests={requests} onChanged={load} />
      )}
    </AppShell>
  );
}
