"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Check, ExternalLink, X } from "lucide-react";
import { Button, Group } from "@/components/ui/Button";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { toast } from "@/components/ui/Toast";
import type { ActionRequestDto } from "@/lib/approvals/service";
import { manilaDateTime } from "@/lib/ui/format";

type Filter = "pending" | "done" | "all";

const STATUS_BADGE: Record<
  ActionRequestDto["status"],
  { label: string; cls: string }
> = {
  PENDING: { label: "Waiting", cls: "bg-brand-soft text-brand" },
  APPROVED: { label: "Sending", cls: "bg-brand-soft text-brand" },
  DONE: {
    label: "Sent",
    cls: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
  },
  REJECTED: { label: "Rejected", cls: "bg-ink/10 text-ink-3" },
  EXPIRED: { label: "Expired", cls: "bg-ink/10 text-ink-3" },
  FAILED: { label: "Failed", cls: "bg-missing-soft text-missing-ink" },
};

export function ApprovalsPanel({
  requests,
  onChanged,
}: {
  requests: ActionRequestDto[];
  onChanged: () => Promise<void> | void;
}) {
  const [filter, setFilter] = useState<Filter>("pending");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const pending = useMemo(
    () => requests.filter((r) => r.status === "PENDING"),
    [requests]
  );

  const visible = useMemo(() => {
    if (filter === "pending") return pending;
    if (filter === "done") return requests.filter((r) => r.status !== "PENDING");
    return requests;
  }, [requests, pending, filter]);

  function getReplyText(r: ActionRequestDto): string {
    if (r.id in drafts) return drafts[r.id];
    return typeof r.payload.text === "string" ? r.payload.text : "";
  }

  async function decide(
    r: ActionRequestDto,
    action: "approve" | "reject"
  ) {
    setBusyId(r.id);
    try {
      const res = await fetch("/api/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          action === "approve"
            ? { action: "approve", id: r.id, editedText: getReplyText(r) }
            : { action: "reject", id: r.id }
        ),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data.error || "Couldn't save decision.", "error");
        await onChanged();
        return;
      }
      toast(action === "approve" ? "Sent to buyer" : "Rejected");
      await onChanged();
    } catch {
      toast("No connection. Try again.", "error");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <SegmentedControl
        label="Filter approvals"
        size="sm"
        shape="pill"
        value={filter}
        onChange={setFilter}
        options={[
          { id: "pending" as const, label: `Waiting (${pending.length})` },
          {
            id: "done" as const,
            label: `History (${requests.length - pending.length})`,
          },
          { id: "all" as const, label: `All (${requests.length})` },
        ]}
      />

      {!visible.length ? (
        <Group className="p-6 text-center space-y-1.5">
          <p className="text-[16px] font-bold text-ink">
            {filter === "pending" ? "Nothing waiting for approval" : "No approvals yet"}
          </p>
          <p className="text-[14px] text-ink-2">
            {filter === "pending"
              ? "Draft or uncertain TikTok replies will appear here and in Telegram for 1-tap approval."
              : "Approved and rejected assistant replies appear here."}
          </p>
        </Group>
      ) : (
        <div className="space-y-3">
          {visible.map((r) => {
            const badge = STATUS_BADGE[r.status];
            const topic =
              typeof r.payload.topic === "string" ? r.payload.topic : null;
            const sentText =
              typeof r.result?.sentText === "string" ? r.result.sentText : null;
            const isPending = r.status === "PENDING";

            return (
              <Group key={r.id} className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[15px] font-extrabold text-ink">
                        {r.title}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${badge.cls}`}
                      >
                        {badge.label}
                      </span>
                      {topic && (
                        <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[11px] font-semibold text-ink-2">
                          {topic}
                        </span>
                      )}
                    </div>
                    <p className="text-[12px] text-ink-3">
                      {manilaDateTime(r.createdAt)} · Proposed by {r.proposedBy}
                    </p>
                  </div>

                  {r.conversationId && (
                    <Link
                      href={`/chats/${encodeURIComponent(r.conversationId)}`}
                      className="pressable inline-flex h-9 shrink-0 items-center gap-1 rounded-full px-3 text-[13px] font-bold text-brand hover:bg-brand-soft"
                    >
                      Open chat
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Link>
                  )}
                </div>

                <div className="rounded-[var(--radius-control)] bg-surface-subtle px-3 py-2.5 text-[13px] text-ink-2">
                  <span className="block text-[11px] font-semibold uppercase tracking-[0.03em] text-ink-3">
                    Buyer wrote
                  </span>
                  <span className="mt-0.5 block text-ink [overflow-wrap:anywhere]">
                    {r.summary}
                  </span>
                </div>

                {isPending ? (
                  <label className="block space-y-1">
                    <span className="block text-[12px] font-semibold text-ink-2">
                      Reply to send (editable)
                    </span>
                    <textarea
                      rows={3}
                      maxLength={1000}
                      value={getReplyText(r)}
                      onChange={(e) =>
                        setDrafts((prev) => ({ ...prev, [r.id]: e.target.value }))
                      }
                      className="w-full rounded-[var(--radius-control)] border border-ink/12 bg-surface px-3 py-2 text-[14px] leading-snug text-ink outline-none focus:border-brand"
                    />
                  </label>
                ) : (
                  (sentText || typeof r.payload.text === "string") && (
                    <div className="rounded-[var(--radius-control)] bg-surface-muted px-3 py-2 text-[13px] text-ink-2 [overflow-wrap:anywhere]">
                      {sentText ?? (r.payload.text as string)}
                    </div>
                  )
                )}

                {r.error && (
                  <p className="text-[13px] font-semibold text-missing-ink">
                    {r.error}
                  </p>
                )}

                {r.decidedBy && r.decidedAt && !isPending && (
                  <p className="text-[12px] text-ink-3">
                    {r.decidedBy} · {manilaDateTime(r.decidedAt)}
                  </p>
                )}

                {isPending && (
                  <div className="flex items-center justify-end gap-2 pt-1">
                    <Button
                      variant="secondary"
                      size="md"
                      disabled={busyId === r.id}
                      onClick={() => decide(r, "reject")}
                      className="!h-10 !px-4 !text-[13px]"
                    >
                      <X className="h-4 w-4" />
                      Reject
                    </Button>
                    <Button
                      variant="primary"
                      size="md"
                      disabled={busyId === r.id || !getReplyText(r).trim()}
                      onClick={() => decide(r, "approve")}
                      className="!h-10 !px-4 !text-[13px]"
                    >
                      <Check className="h-4 w-4" />
                      {busyId === r.id ? "Sending..." : "Approve & send"}
                    </Button>
                  </div>
                )}
              </Group>
            );
          })}
        </div>
      )}
    </div>
  );
}
