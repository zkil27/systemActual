"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, ChevronRight, Minus, PackageX, Plus, RotateCcw, Search, Truck } from "lucide-react";
import { ReceivePoPanel } from "@/components/stock-in/ReceivePoPanel";
import { Button, Group } from "@/components/ui/Button";
import { ItemThumb } from "@/components/ui/ItemThumb";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Toaster, toast } from "@/components/ui/Toast";
import type { StaffPurchaseOrderView } from "@/lib/restock/rules";
import { pulseAmbient } from "@/lib/ui/ambient";
import { haptic } from "@/lib/ui/motion";

type StockMode = "SUPPLIER_IN" | "EMPTY_SHELF" | "DEFECTIVE";

const STOCK_MODES: readonly { id: StockMode; label: string }[] = [
  { id: "SUPPLIER_IN", label: "New stock (+)" },
  { id: "EMPTY_SHELF", label: "Shelf empty (0)" },
  { id: "DEFECTIVE", label: "Damaged (-)" },
];

interface VariantOption {
  id: string;
  name: string;
  label: string;
  imageUrl: string | null;
  started: boolean;
  onShelf: number | null;
}

interface TodayEntry {
  id: string;
  name: string;
  label: string;
  quantity: number;
  note: string | null;
  staffName: string | null;
  createdAt: string;
  undoable: boolean;
}

function timeOf(iso: string) {
  return new Date(iso).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" });
}

function newKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Staff shelf & stock operations:
 * - New stock (+): record a supplier delivery
 * - Shelf empty (0): zero shelf stock immediately & push to shops
 * - Damaged (-): deduct damaged/stained pieces found on the rack
 */
export function StockInClient({ initialUnlocked }: { initialUnlocked: boolean }) {
  const [unlocked] = useState<boolean>(initialUnlocked);
  const [mode, setMode] = useState<StockMode>("SUPPLIER_IN");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<VariantOption[]>([]);
  const [picked, setPicked] = useState<VariantOption | null>(null);
  // Kept as text so the box can be cleared while typing; clamped on save/blur.
  const [qtyText, setQtyText] = useState("1");
  const qty = Math.max(1, Math.min(10_000, Number(qtyText) || 1));
  const setQty = (fn: (n: number) => number) => setQtyText(String(fn(qty)));
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [searched, setSearched] = useState(false);
  const [today, setToday] = useState<TodayEntry[]>([]);
  const [openPos, setOpenPos] = useState<StaffPurchaseOrderView[]>([]);
  const [pickedPo, setPickedPo] = useState<StaffPurchaseOrderView | null>(null);
  const [undoing, setUndoing] = useState<string | null>(null);
  const [backHref, setBackHref] = useState("/scan");
  const keyRef = useRef(newKey());

  const loadToday = useCallback(async () => {
    try {
      const res = await fetch("/api/stock-in?today=1", { cache: "no-store" });
      if (res.ok) setToday((await res.json()).entries ?? []);
    } catch {
      // Offline: the list just stays as it was.
    }
  }, []);

  const loadOpenPos = useCallback(async () => {
    try {
      const res = await fetch("/api/stock-in?openPos=1", { cache: "no-store" });
      if (res.ok) setOpenPos((await res.json()).purchaseOrders ?? []);
    } catch {
      // Offline: keep last known POs.
    }
  }, []);

  useEffect(() => {
    if (unlocked) {
      void loadToday();
      void loadOpenPos();
    }
  }, [unlocked, loadToday, loadOpenPos]);

  async function undo(entry: TodayEntry) {
    setUndoing(entry.id);
    try {
      const res = await fetch("/api/stock-in", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ movementId: entry.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) toast(data.error || "Couldn't undo", "error");
      else toast(`Undid ${entry.quantity} × ${entry.name} (${entry.label})`);
      await loadToday();
    } catch {
      toast("No connection", "error");
    } finally {
      setUndoing(null);
    }
  }

  useEffect(() => {
    if (!unlocked || typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const paramMode = params.get("mode");
    const paramQuery = params.get("q");
    const paramVariantId = params.get("variantId");
    const from = params.get("from");
    if (from && /^[a-z]{2,12}$/.test(from)) setBackHref(`/scan?tab=${from}`);

    if (paramMode === "EMPTY_SHELF" || paramMode === "DEFECTIVE" || paramMode === "SUPPLIER_IN") {
      setMode(paramMode);
    }
    if (paramVariantId) {
      void fetch(`/api/stock-in?variantId=${encodeURIComponent(paramVariantId)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data?.variants?.[0]) {
            setPicked(data.variants[0]);
          }
        })
        .catch(() => {});
    } else if (paramQuery) {
      setQuery(paramQuery);
    }
  }, [unlocked]);

  useEffect(() => {
    if (!unlocked || query.trim().length < 2) {
      setResults([]);
      setSearched(false);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/stock-in?q=${encodeURIComponent(query.trim())}`);
        if (res.ok) setResults((await res.json()).variants);
        setSearched(true);
      } catch {
        toast("No connection", "error");
      }
    }, 250);
    return () => clearTimeout(t);
  }, [query, unlocked]);

  async function save() {
    if (!picked) return;
    setSaving(true);
    try {
      const res = await fetch("/api/stock-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          variantId: picked.id,
          mode,
          quantity: mode === "EMPTY_SHELF" ? 0 : qty,
          note: note.trim() || undefined,
          clientKey: keyRef.current,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data.error || "Couldn't save", "error");
        return;
      }
      haptic("success");
      pulseAmbient("success");
      if (mode === "SUPPLIER_IN") {
        toast(`Added ${qty} × ${picked.name} (${picked.label})`);
      } else if (mode === "EMPTY_SHELF") {
        toast(`${picked.name} (${picked.label}) set to 0 — updating shops`);
      } else {
        toast(`Removed ${qty} damaged × ${picked.name} (${picked.label})`);
      }
      keyRef.current = newKey();
      setPicked(null);
      setQtyText("1");
      setNote("");
      if (mode === "SUPPLIER_IN") void loadToday();
    } catch {
      // Same key on retry, so this can't be counted twice.
      toast("No connection. Tap Save again.", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="safe-top mx-auto min-h-dvh max-w-lg space-y-5 px-4 pb-10 pt-4">
      <header className="flex items-center gap-2">
        <Link
          href={backHref}
          aria-label="Back to Scan"
          className="pressable flex h-11 w-11 items-center justify-center rounded-full text-brand hover:bg-ink/[0.05]"
        >
          <ArrowLeft className="h-6 w-6" />
        </Link>
        <h1 className="text-[22px] font-extrabold tracking-[-0.01em] text-ink">Shelf &amp; stock</h1>
      </header>

      {unlocked && (
        <SegmentedControl
          options={STOCK_MODES}
          value={mode}
          onChange={(next) => {
            setMode(next);
            setPickedPo(null);
            keyRef.current = newKey();
          }}
          label="Stock action"
        />
      )}

      {unlocked === false && (
        <Group className="space-y-3 p-5">
          <p className="text-[16px] text-ink-2">Unlock with your PIN on the Scan page first.</p>
          <Link href="/scan" className="pressable-text inline-flex min-h-11 items-center text-[16px] font-bold text-brand">
            Go to Scan
          </Link>
        </Group>
      )}

      {unlocked && mode === "SUPPLIER_IN" && pickedPo && (
        <ReceivePoPanel
          po={pickedPo}
          apiMode="staff"
          onCancel={() => setPickedPo(null)}
          onReceived={async () => {
            setPickedPo(null);
            await Promise.all([loadToday(), loadOpenPos()]);
          }}
        />
      )}

      {unlocked && !picked && !(mode === "SUPPLIER_IN" && pickedPo) && (
        <>
          <label className="relative block">
            <span className="sr-only">Search item</span>
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-3" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Item name, colour or size"
              className="h-12 w-full rounded-[var(--radius-control)] bg-surface pl-11 pr-4 text-[16px] text-ink shadow-[var(--shadow-card)] focus:shadow-[0_0_0_2px_var(--color-brand)] focus:outline-none"
            />
          </label>
          {searched && results.length === 0 && (
            <p className="px-1 text-[16px] text-ink-3">
              No item matches &ldquo;{query.trim()}&rdquo;. Try the colour or size, or a shorter name.
            </p>
          )}
          {results.length > 0 && (
            <Group className="anim-rise-in">
              <ul className="divide-y divide-hairline">
                {results.map((v) => (
                  <li key={v.id}>
                    <button
                      type="button"
                      onClick={() => setPicked(v)}
                      className="pressable-row flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-subtle active:bg-surface-muted"
                    >
                      <ItemThumb src={v.imageUrl} alt={v.name} size="md" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[16px] font-semibold text-ink">{v.name}</span>
                        <span className="block text-[14px] text-ink-3 tabular-nums">
                          {v.label}
                          {v.onShelf !== null
                            ? ` · ${v.onShelf} on shelf`
                            : !v.started
                              ? " · will start stock count automatically"
                              : ""}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </Group>
          )}
          {mode === "SUPPLIER_IN" && openPos.length > 0 && query.trim().length < 2 && (
            <section className="space-y-2">
              <h2 className="px-1 text-[15px] font-semibold text-ink-3">
                Expected supplier deliveries ({openPos.length})
              </h2>
              <Group>
                <ul className="divide-y divide-hairline">
                  {openPos.map((po) => {
                    const remaining = po.lines.reduce((s, l) => s + l.remainingQty, 0);
                    return (
                      <li key={po.id}>
                        <button
                          type="button"
                          onClick={() => setPickedPo(po)}
                          className="pressable-row flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-subtle active:bg-surface-muted"
                        >
                          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] bg-brand-soft text-brand">
                            <Truck className="h-5 w-5" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[16px] font-bold text-ink">
                              {po.poNumber} · {po.supplierName}
                            </span>
                            <span className="block truncate text-[13px] text-ink-2 tabular-nums">
                              {po.lines.length} item{po.lines.length === 1 ? "" : "s"} · {remaining} pcs remaining
                              {po.expectedAt
                                ? ` · ETA ${new Date(po.expectedAt).toLocaleDateString("en-PH", {
                                    month: "short",
                                    day: "numeric",
                                    timeZone: "Asia/Manila",
                                  })}`
                                : ""}
                            </span>
                          </span>
                          <ChevronRight className="h-5 w-5 shrink-0 text-ink-3" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </Group>
            </section>
          )}
          {mode === "SUPPLIER_IN" && today.length > 0 && query.trim().length < 2 && (
            <section className="space-y-2">
              <h2 className="px-1 text-[15px] font-semibold text-ink-3">Added today</h2>
              <Group>
                <ul className="divide-y divide-hairline">
                  {today.map((e) => (
                    <li key={e.id} className="flex items-center justify-between gap-3 px-4 py-3">
                      <span className="min-w-0">
                        <span className="block truncate text-[16px] font-semibold text-ink">
                          <span className="tabular-nums">+{e.quantity}</span> {e.name}
                        </span>
                        <span className="block truncate text-[14px] text-ink-3">
                          {e.label} · {timeOf(e.createdAt)}
                          {e.staffName ? ` · ${e.staffName}` : ""}
                          {e.note ? ` · ${e.note}` : ""}
                        </span>
                      </span>
                      {e.undoable && (
                        <button
                          type="button"
                          disabled={undoing === e.id}
                          onClick={() => undo(e)}
                          className="pressable inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-3 text-[15px] font-semibold text-brand hover:bg-brand/10 disabled:opacity-50"
                        >
                          <RotateCcw className="h-4 w-4" /> Undo
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </Group>
              <p className="px-1 text-[13px] text-ink-3">Undo works for 5 minutes. After that, ask the owner to recount.</p>
            </section>
          )}
        </>
      )}

      {unlocked && picked && (
        <Group className="anim-rise-in space-y-5 p-5">
          <div className="flex items-center gap-4">
            <ItemThumb src={picked.imageUrl} alt={picked.name} size="xl" />
            <span className="min-w-0 flex-1">
              <span className="block text-[20px] font-bold leading-snug text-ink">{picked.name}</span>
              <span className="mt-2 inline-block rounded-lg bg-ink px-2.5 py-1 text-[15px] font-bold text-ink-inverse">
                {picked.label}
              </span>
              {picked.onShelf !== null && (
                <span className="mt-1.5 block text-[14px] font-semibold text-ink-3 tabular-nums">
                  Currently on shelf: {picked.onShelf} pcs
                </span>
              )}
            </span>
          </div>

          {mode === "EMPTY_SHELF" ? (
            <div className="anim-fade-in flex items-start gap-3 rounded-[var(--radius-control)] bg-missing-soft p-3.5 text-[14px] font-semibold text-missing-ink">
              <PackageX className="mt-0.5 h-5 w-5 shrink-0" />
              <span>
                This sets shelf stock to 0, updates Shopee &amp; TikTok right away to stop overselling, and alerts the
                owner.
              </span>
            </div>
          ) : (
            <>
              {mode === "DEFECTIVE" && (
                <div className="anim-fade-in flex items-start gap-3 rounded-[var(--radius-control)] bg-failed-soft p-3.5 text-[14px] font-semibold text-failed-ink">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                  <span>Deducts damaged/stained pieces from the shelf and updates shops right away.</span>
                </div>
              )}
              <div className="flex items-center justify-center gap-6">
                <button
                  type="button"
                  aria-label="One less"
                  onClick={() => setQty((n) => Math.max(1, n - 1))}
                  className="pressable flex h-14 w-14 items-center justify-center rounded-full bg-surface-muted text-ink"
                >
                  <Minus className="h-6 w-6" />
                </button>
                <input
                  aria-label="Pieces"
                  inputMode="numeric"
                  value={qtyText}
                  onChange={(e) => setQtyText(e.target.value.replace(/\D/g, "").slice(0, 5))}
                  onBlur={() => setQtyText(String(qty))}
                  onFocus={(e) => e.currentTarget.select()}
                  className="h-14 w-24 rounded-[var(--radius-control)] bg-surface-muted text-center text-[28px] font-extrabold tabular-nums text-ink focus:outline-none"
                />
                <button
                  type="button"
                  aria-label="One more"
                  onClick={() => setQty((n) => Math.min(10_000, n + 1))}
                  className="pressable flex h-14 w-14 items-center justify-center rounded-full bg-surface-muted text-ink"
                >
                  <Plus className="h-6 w-6" />
                </button>
              </div>
            </>
          )}

          <input
            type="text"
            value={note}
            maxLength={200}
            onChange={(e) => setNote(e.target.value)}
            placeholder={mode === "SUPPLIER_IN" ? "Supplier or receipt # (optional)" : "Note (optional, e.g. torn seam)"}
            aria-label="Note"
            className="h-12 w-full rounded-[var(--radius-control)] bg-surface-muted px-4 text-[16px] text-ink focus:shadow-[0_0_0_2px_var(--color-brand)] focus:outline-none"
          />

          <div className="space-y-2">
            <Button
              full
              size="lg"
              variant={mode === "EMPTY_SHELF" ? "danger" : "primary"}
              disabled={saving}
              onClick={save}
            >
              {saving
                ? "Saving…"
                : mode === "EMPTY_SHELF"
                  ? "Confirm shelf empty (0 left)"
                  : mode === "DEFECTIVE"
                    ? `Remove ${qty} damaged`
                    : `Add ${qty} to stock`}
            </Button>
            <Button full variant="plain" onClick={() => setPicked(null)}>
              Pick another item
            </Button>
          </div>
        </Group>
      )}
      <Toaster />
    </main>
  );
}
