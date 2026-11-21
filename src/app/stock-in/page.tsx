"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Minus, Plus, Search } from "lucide-react";
import { Button, Group } from "@/components/ui/Button";
import { ItemThumb } from "@/components/ui/ItemThumb";
import { toast } from "@/components/ui/Toast";
import { haptic } from "@/lib/ui/motion";

interface VariantOption {
  id: string;
  name: string;
  label: string;
  imageUrl: string | null;
  started: boolean;
}

function newKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Staff record a supplier delivery: find the item, set how many, save. */
export default function StockInPage() {
  const [unlocked, setUnlocked] = useState<boolean | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<VariantOption[]>([]);
  const [picked, setPicked] = useState<VariantOption | null>(null);
  const [qty, setQty] = useState(1);
  const [saving, setSaving] = useState(false);
  const keyRef = useRef(newKey());

  useEffect(() => {
    fetch("/api/scan/session")
      .then((r) => r.json())
      .then((d) => setUnlocked(Boolean(d.unlocked)))
      .catch(() => setUnlocked(false));
  }, []);

  useEffect(() => {
    if (!unlocked || query.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      const res = await fetch(`/api/stock-in?q=${encodeURIComponent(query.trim())}`);
      if (res.ok) setResults((await res.json()).variants);
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
        body: JSON.stringify({ variantId: picked.id, quantity: qty, clientKey: keyRef.current }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data.error || "Couldn't save", "error");
        return;
      }
      haptic(12);
      toast(`Added ${qty} × ${picked.name} (${picked.label})`);
      keyRef.current = newKey();
      setPicked(null);
      setQty(1);
    } catch {
      // Same key on retry, so this can't be counted twice.
      toast("No connection. Tap Save again.", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="safe-top mx-auto min-h-dvh max-w-lg space-y-6 bg-ground px-4 pb-10 pt-4">
      <header className="flex items-center gap-2">
        <Link href="/scan" aria-label="Back to Scan" className="pressable flex h-11 w-11 items-center justify-center rounded-full text-brand hover:bg-black/[0.04]">
          <ArrowLeft className="h-6 w-6" />
        </Link>
        <h1 className="text-[22px] font-extrabold tracking-[-0.01em] text-ink">New stock</h1>
      </header>

      {unlocked === false && (
        <Group className="space-y-3 p-5">
          <p className="text-[16px] text-ink-2">Unlock with your PIN on the Scan page first.</p>
          <Link href="/scan" className="block text-[16px] font-bold text-brand">
            Go to Scan
          </Link>
        </Group>
      )}

      {unlocked && !picked && (
        <>
          <label className="relative block">
            <span className="sr-only">Search item</span>
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-3" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Item name, colour or size"
              className="h-12 w-full rounded-[var(--radius-control)] bg-white pl-11 pr-4 text-[16px] text-ink shadow-[var(--shadow-card)] focus:shadow-[0_0_0_2px_var(--color-brand)] focus:outline-none"
            />
          </label>
          {results.length > 0 && (
            <Group>
              <ul className="divide-y divide-hairline">
                {results.map((v) => (
                  <li key={v.id}>
                    <button
                      type="button"
                      onClick={() => setPicked(v)}
                      className="pressable flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left hover:bg-black/[0.02]"
                    >
                      <ItemThumb src={v.imageUrl} alt={v.name} size="md" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[16px] font-semibold text-ink">{v.name}</span>
                        <span className="block text-[14px] text-ink-3">
                          {v.label}
                          {!v.started ? " · owner hasn't counted this yet" : ""}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </Group>
          )}
        </>
      )}

      {unlocked && picked && (
        <Group className="space-y-6 p-5">
          <div className="flex items-center gap-4">
            <ItemThumb src={picked.imageUrl} alt={picked.name} size="xl" />
            <span className="min-w-0">
              <span className="block text-[20px] font-bold leading-snug text-ink">{picked.name}</span>
              <span className="mt-2 inline-block rounded-lg bg-ink px-2.5 py-1 text-[15px] font-bold text-white">{picked.label}</span>
            </span>
          </div>
          <div className="flex items-center justify-center gap-6">
            <button
              type="button"
              aria-label="One less"
              onClick={() => setQty((n) => Math.max(1, n - 1))}
              className="pressable flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-ink"
            >
              <Minus className="h-6 w-6" />
            </button>
            <input
              aria-label="Pieces"
              inputMode="numeric"
              value={qty}
              onChange={(e) => setQty(Math.max(1, Math.min(10_000, Number(e.target.value.replace(/\D/g, "")) || 1)))}
              className="h-14 w-24 rounded-[var(--radius-control)] bg-slate-100 text-center text-[28px] font-extrabold tabular-nums text-ink focus:outline-none"
            />
            <button
              type="button"
              aria-label="One more"
              onClick={() => setQty((n) => Math.min(10_000, n + 1))}
              className="pressable flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-ink"
            >
              <Plus className="h-6 w-6" />
            </button>
          </div>
          <div className="space-y-2">
            <Button full size="lg" disabled={saving || !picked.started} onClick={save}>
              {saving ? "Saving…" : `Add ${qty} to stock`}
            </Button>
            {!picked.started && (
              <p className="text-center text-[14px] text-amber-800">Ask the owner to count this item first.</p>
            )}
            <Button full variant="plain" onClick={() => setPicked(null)}>
              Pick another item
            </Button>
          </div>
        </Group>
      )}
    </main>
  );
}
