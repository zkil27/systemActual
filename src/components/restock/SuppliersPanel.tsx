"use client";

import { useState } from "react";
import { Archive, Pencil, Plus, RotateCcw } from "lucide-react";
import { Button, Group } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmSheet";
import { Sheet } from "@/components/ui/Sheet";
import { toast } from "@/components/ui/Toast";
import type { SupplierDto } from "./types";

export function SuppliersPanel({
  suppliers,
  onChanged,
}: {
  suppliers: SupplierDto[];
  onChanged: () => Promise<void> | void;
}) {
  const { confirm, sheet: confirmSheet } = useConfirm();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<SupplierDto | null>(null);
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [leadTimeText, setLeadTimeText] = useState("7");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const visible = suppliers.filter((s) => showArchived || !s.archivedAt);
  const archivedCount = suppliers.filter((s) => s.archivedAt).length;

  function openAdd() {
    setEditing(null);
    setName("");
    setContact("");
    setLeadTimeText("7");
    setNotes("");
    setSheetOpen(true);
  }

  function openEdit(s: SupplierDto) {
    setEditing(s);
    setName(s.name);
    setContact(s.contact ?? "");
    setLeadTimeText(String(s.leadTimeDays));
    setNotes(s.notes ?? "");
    setSheetOpen(true);
  }

  async function save() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast("Enter a supplier name.", "error");
      return;
    }
    const leadTimeDays = Math.min(
      90,
      Math.max(1, Number.parseInt(leadTimeText, 10) || 7)
    );
    setSaving(true);
    try {
      const res = await fetch("/api/restock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          editing
            ? {
                action: "updateSupplier",
                id: editing.id,
                name: trimmed,
                contact: contact.trim() || null,
                leadTimeDays,
                notes: notes.trim() || null,
              }
            : {
                action: "createSupplier",
                name: trimmed,
                contact: contact.trim() || null,
                leadTimeDays,
                notes: notes.trim() || null,
              }
        ),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data.error || "Couldn't save supplier.", "error");
        return;
      }
      toast(editing ? `Updated ${trimmed}` : `Added ${trimmed}`);
      setSheetOpen(false);
      await onChanged();
    } catch {
      toast("No connection. Try again.", "error");
    } finally {
      setSaving(false);
    }
  }

  async function toggleArchive(s: SupplierDto) {
    const archiving = !s.archivedAt;
    const ok = await confirm({
      title: archiving ? `Archive ${s.name}?` : `Restore ${s.name}?`,
      message: archiving
        ? "Past supplier orders stay visible in history. You can restore this supplier anytime."
        : "This supplier will appear again when creating new orders.",
      confirmLabel: archiving ? "Archive" : "Restore",
      danger: archiving,
    });
    if (!ok) return;

    try {
      const res = await fetch("/api/restock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "updateSupplier",
          id: s.id,
          archived: archiving,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data.error || "Couldn't update supplier.", "error");
        return;
      }
      toast(archiving ? `Archived ${s.name}` : `Restored ${s.name}`);
      await onChanged();
    } catch {
      toast("No connection. Try again.", "error");
    }
  }

  return (
    <div className="space-y-4">
      {confirmSheet}
      <div className="flex items-center justify-between gap-3">
        <Button variant="primary" size="md" onClick={openAdd} className="!h-11">
          <Plus className="h-4 w-4" />
          Add supplier
        </Button>
        {archivedCount > 0 && (
          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            className="text-[13px] font-semibold text-brand hover:underline"
          >
            {showArchived ? "Hide archived" : `Show archived (${archivedCount})`}
          </button>
        )}
      </div>

      {!visible.length ? (
        <Group className="p-6 text-center space-y-1.5">
          <p className="text-[16px] font-bold text-ink">No suppliers yet</p>
          <p className="text-[14px] text-ink-2">
            Add your tahian or wholesale suppliers so you can track expected deliveries and lead times.
          </p>
        </Group>
      ) : (
        <Group>
          <ul className="divide-y divide-hairline">
            {visible.map((s) => (
              <li key={s.id} className="flex items-start gap-3 px-4 py-3.5">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[15px] font-bold text-ink">
                      {s.name}
                    </span>
                    <span className="shrink-0 rounded-full bg-surface-muted px-2 py-0.5 text-[11px] font-semibold text-ink-2">
                      {s.leadTimeDays}d lead
                    </span>
                    {s.archivedAt && (
                      <span className="shrink-0 rounded-full bg-ink/10 px-2 py-0.5 text-[11px] font-semibold text-ink-3">
                        Archived
                      </span>
                    )}
                  </div>
                  {(s.contact || s.openPoCount > 0) && (
                    <div className="text-[13px] text-ink-2">
                      {s.contact ? s.contact : "No contact"}
                      {s.openPoCount > 0
                        ? ` · ${s.openPoCount} open order${s.openPoCount === 1 ? "" : "s"}`
                        : s.poCount > 0
                          ? ` · ${s.poCount} past order${s.poCount === 1 ? "" : "s"}`
                          : ""}
                    </div>
                  )}
                  {s.notes && (
                    <p className="text-[12px] text-ink-3 line-clamp-2">{s.notes}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => openEdit(s)}
                    aria-label={`Edit ${s.name}`}
                    className="flex h-11 w-11 items-center justify-center rounded-full text-ink-2 hover:bg-ink/[0.06]"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleArchive(s)}
                    aria-label={s.archivedAt ? `Restore ${s.name}` : `Archive ${s.name}`}
                    className="flex h-11 w-11 items-center justify-center rounded-full text-ink-2 hover:bg-ink/[0.06]"
                  >
                    {s.archivedAt ? (
                      <RotateCcw className="h-4 w-4" />
                    ) : (
                      <Archive className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </Group>
      )}

      <Sheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={editing ? "Edit supplier" : "Add supplier"}
        footer={
          <Button full onClick={save} disabled={saving}>
            {saving ? "Saving..." : editing ? "Save changes" : "Save supplier"}
          </Button>
        }
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="block text-[13px] font-semibold text-ink-2">
              Supplier name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Taytay Tahian — Ate Rose"
              className="h-11 w-full rounded-[var(--radius-control)] border border-ink/12 bg-surface px-3 text-[16px] text-ink outline-none focus:border-brand"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="block text-[13px] font-semibold text-ink-2">
                Contact (phone / FB)
              </label>
              <input
                type="text"
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                placeholder="0917..."
                className="h-11 w-full rounded-[var(--radius-control)] border border-ink/12 bg-surface px-3 text-[16px] text-ink outline-none focus:border-brand"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-[13px] font-semibold text-ink-2">
                Lead time (days)
              </label>
              <input
                type="number"
                min={1}
                max={90}
                inputMode="numeric"
                value={leadTimeText}
                onChange={(e) => setLeadTimeText(e.target.value)}
                className="h-11 w-full rounded-[var(--radius-control)] border border-ink/12 bg-surface px-3 text-[16px] font-semibold text-ink outline-none focus:border-brand"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="block text-[13px] font-semibold text-ink-2">
              Notes (optional)
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Min. order, payment terms, pickup schedule..."
              className="w-full rounded-[var(--radius-control)] border border-ink/12 bg-surface p-3 text-[16px] text-ink outline-none focus:border-brand"
            />
          </div>
        </div>
      </Sheet>
    </div>
  );
}
