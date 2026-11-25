"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronRight, Printer, Search, X } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { ParcelDetailSheet } from "@/components/ParcelDetailSheet";
import { Button, Group } from "@/components/ui/Button";
import { ItemThumb } from "@/components/ui/ItemThumb";
import { Sheet } from "@/components/ui/Sheet";
import { toast } from "@/components/ui/Toast";
import type { OrderLookupResult, OrderStage, ReturnOnlyResult } from "@/lib/orders/lookup";
import { formatPeso, manilaDateTime, shortCourier } from "@/lib/ui/format";

const MIN_QUERY = 3;

function storeName(platform: string) {
  return platform === "SHOPEE" ? "Shopee" : "TikTok Shop";
}

function Timeline({ stages }: { stages: OrderStage[] }) {
  return (
    <ol aria-label="Order timeline">
      {stages.map((s, i) => {
        const done = Boolean(s.at);
        const last = i === stages.length - 1;
        return (
          <li key={`${s.id}-${i}`} className="relative flex gap-3.5 pb-5 last:pb-0">
            {!last && (
              <span
                aria-hidden="true"
                className={`absolute left-[7px] top-5 h-[calc(100%-12px)] w-0.5 rounded-full ${
                  done ? "bg-brand/30" : "bg-hairline"
                }`}
              />
            )}
            <span
              aria-hidden="true"
              className={`mt-1 h-4 w-4 shrink-0 rounded-full border-2 ${
                s.alert
                  ? "border-missing bg-missing"
                  : done
                    ? "border-brand bg-brand"
                    : "border-hairline-strong bg-surface"
              }`}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <span
                  className={`text-[16px] ${
                    s.alert ? "font-semibold text-missing-ink" : done ? "font-semibold text-ink" : "text-ink-2"
                  }`}
                >
                  {s.label}
                </span>
                <span className={`tabular-nums shrink-0 text-[15px] ${done ? "text-ink-2" : "text-ink-3"}`}>
                  {done ? manilaDateTime(s.at) : "Not yet"}
                </span>
              </div>
              {s.detail && <p className="text-[14px] text-ink-3">{s.detail}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function OrderSheet({
  order,
  onClose,
  onOpenReturn,
}: {
  order: OrderLookupResult | null;
  onClose: () => void;
  onOpenReturn: (id: string) => void;
}) {
  const last = useRef<OrderLookupResult | null>(null);
  if (order) last.current = order;
  const o = last.current;
  const [reprinting, setReprinting] = useState(false);

  async function reprint() {
    if (!o) return;
    setReprinting(true);
    try {
      const res = await fetch("/api/waves", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reprint", orderSn: o.orderSn }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) toast(data.error || "Couldn't reprint", "error");
      else toast("Label sent to the printer");
    } catch {
      toast("No connection", "error");
    } finally {
      setReprinting(false);
    }
  }

  return (
    <Sheet open={order !== null} onClose={onClose} title="Order">
      {o && (
        <div className="space-y-6 pt-2">
          <div>
            <p className="tabular-nums break-all text-[19px] font-bold text-ink">{o.orderSn}</p>
            <p className="mt-1 text-[15px] text-ink-3">
              {storeName(o.platform)} · {o.shopName} · {formatPeso(o.totalPhp)}
              {o.isCod ? " · COD" : ""}
            </p>
          </div>

          <ul className="space-y-3">
            {o.lines.map((l, i) => (
              <li key={i} className="flex items-center gap-3">
                <ItemThumb src={l.imageUrl} alt={l.name} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[16px] font-semibold text-ink">
                    {l.quantity > 1 && <span className="tabular-nums">{l.quantity}× </span>}
                    {l.name}
                  </span>
                  {l.variationName && <span className="block truncate text-[15px] text-ink-3">{l.variationName}</span>}
                </span>
              </li>
            ))}
          </ul>

          <Timeline stages={o.stages} />

          <dl className="divide-y divide-hairline border-y border-hairline">
            <div className="flex items-start justify-between gap-4 py-3">
              <dt className="text-[15px] text-ink-3">Courier</dt>
              <dd className="text-[15px] font-semibold text-ink">{o.courier ? shortCourier(o.courier) : "Not assigned"}</dd>
            </div>
            <div className="flex items-start justify-between gap-4 py-3">
              <dt className="text-[15px] text-ink-3">Tracking</dt>
              <dd className="tabular-nums break-all text-right text-[15px] font-semibold text-ink">
                {o.trackingNumbers.length ? o.trackingNumbers.join(", ") : "None yet"}
              </dd>
            </div>
            <div className="flex items-start justify-between gap-4 py-3">
              <dt className="text-[15px] text-ink-3">Shop status</dt>
              <dd className="text-[15px] font-semibold text-ink">{o.status.replace(/_/g, " ").toLowerCase()}</dd>
            </div>
          </dl>

          <div className="space-y-2">
            {o.canReprint && (
              <Button full onClick={reprint} disabled={reprinting}>
                <Printer className="h-5 w-5" />
                {reprinting ? "Sending…" : "Reprint label"}
              </Button>
            )}
            {o.returnParcelIds.map((id, i) => (
              <Button key={id} full variant="secondary" onClick={() => onOpenReturn(id)}>
                Open return{o.returnParcelIds.length > 1 ? ` ${i + 1}` : ""}
              </Button>
            ))}
          </div>
        </div>
      )}
    </Sheet>
  );
}

function OrdersInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [query, setQuery] = useState(() => searchParams.get("q") ?? "");
  const [orders, setOrders] = useState<OrderLookupResult[] | null>(null);
  const [returnsOnly, setReturnsOnly] = useState<ReturnOnlyResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [openOrder, setOpenOrder] = useState<OrderLookupResult | null>(null);
  const [openReturn, setOpenReturn] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const reqId = useRef(0);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (q.length < MIN_QUERY) {
      setOrders(null);
      setReturnsOnly([]);
      setError(false);
      return;
    }
    const id = ++reqId.current;
    const t = setTimeout(async () => {
      setLoading(true);
      setError(false);
      try {
        const res = await fetch(`/api/orders?q=${encodeURIComponent(q)}`, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        if (id !== reqId.current) return;
        setOrders(data.orders ?? []);
        setReturnsOnly(data.returnsOnly ?? []);
        router.replace(`/orders?q=${encodeURIComponent(q)}`, { scroll: false });
      } catch {
        if (id === reqId.current) setError(true);
      } finally {
        if (id === reqId.current) setLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [query, retry, router]);

  const empty = orders !== null && orders.length === 0 && returnsOnly.length === 0;

  return (
    <AppShell title="Find an order">
      <div className="space-y-6">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-3" />
          <input
            ref={inputRef}
            type="search"
            enterKeyHint="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Order #, tracking # or item name"
            aria-label="Search orders"
            className="h-12 w-full rounded-[var(--radius-control)] bg-surface pl-11 pr-11 text-[16px] text-ink shadow-[var(--shadow-card)] placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-brand"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
              aria-label="Clear search"
              className="pressable absolute right-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full text-ink-3"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </label>

        {query.trim().length < MIN_QUERY ? (
          <p className="px-1 text-[15px] text-ink-3">
            Search outbound orders and returns from both shops. Scan-gun input works too.
          </p>
        ) : error ? (
          <div className="space-y-3 text-center">
            <p className="text-[16px] text-ink-2">Couldn&apos;t search right now.</p>
            <Button variant="secondary" onClick={() => setRetry((n) => n + 1)}>
              Try again
            </Button>
          </div>
        ) : loading && orders === null ? (
          <div className="space-y-2" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-[76px] animate-pulse rounded-[var(--radius-card)] bg-surface-track/60" />
            ))}
          </div>
        ) : empty ? (
          <p className="px-1 text-[16px] text-ink-3">No orders match “{query.trim()}”.</p>
        ) : (
          <>
            {orders && orders.length > 0 && (
              <Group>
                <ul>
                  {orders.map((o, i) => (
                    <li key={o.id}>
                      <button
                        type="button"
                        onClick={() => setOpenOrder(o)}
                        className="group pressable-row flex w-full items-center gap-3.5 pl-4 text-left hover:bg-surface-subtle active:bg-surface-muted"
                      >
                        <ItemThumb src={o.lines[0]?.imageUrl ?? null} alt={o.lines[0]?.name ?? "Order"} />
                        <span
                          className={`flex min-h-[76px] min-w-0 flex-1 items-center gap-2 py-3 pr-3 ${
                            i === 0 ? "" : "border-t border-hairline"
                          }`}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[16px] font-semibold text-ink">
                              {o.lines[0]?.name ?? o.orderSn}
                              {o.lines.length > 1 && (
                                <span className="font-normal text-ink-3"> +{o.lines.length - 1} more</span>
                              )}
                            </span>
                            <span className="mt-0.5 block truncate text-[15px] text-ink-3">
                              <span
                                className={
                                  o.stages.some((s) => s.alert) ? "font-semibold text-missing-ink" : "font-semibold text-ink-2"
                                }
                              >
                                {o.headline}
                              </span>{" "}
                              · {storeName(o.platform)} · <span className="tabular-nums">{o.orderSn}</span>
                            </span>
                          </span>
                          <ChevronRight className="chevron-nudge h-5 w-5 shrink-0 text-ink-3" />
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </Group>
            )}

            {returnsOnly.length > 0 && (
              <section className="space-y-2">
                <h2 className="px-1 text-[15px] font-semibold text-ink-3">Older returns</h2>
                <Group>
                  <ul>
                    {returnsOnly.map((r, i) => (
                      <li key={r.id}>
                        <button
                          type="button"
                          onClick={() => setOpenReturn(r.id)}
                          className={`pressable-row flex min-h-14 w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-surface-subtle active:bg-surface-muted ${
                            i === 0 ? "" : "border-t border-hairline"
                          }`}
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-[16px] font-semibold text-ink">{r.itemSummary}</span>
                            <span className="block truncate text-[14px] text-ink-3">
                              {r.category === "FAILED_DELIVERY" ? "Failed delivery" : "Buyer return"} ·{" "}
                              {shortCourier(r.courier)} · <span className="tabular-nums">{r.orderSn}</span>
                            </span>
                          </span>
                          <ChevronRight className="h-5 w-5 shrink-0 text-ink-3" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </Group>
              </section>
            )}
          </>
        )}
      </div>

      <OrderSheet
        order={openOrder}
        onClose={() => setOpenOrder(null)}
        onOpenReturn={(id) => {
          setOpenOrder(null);
          setOpenReturn(id);
        }}
      />
      <ParcelDetailSheet parcelId={openReturn} onClose={() => setOpenReturn(null)} />
    </AppShell>
  );
}

export default function OrdersPage() {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-ground" />}>
      <OrdersInner />
    </Suspense>
  );
}
