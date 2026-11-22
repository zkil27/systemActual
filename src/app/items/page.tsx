"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight, Link2, Search, Sparkles, Star } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Button, Group } from "@/components/ui/Button";
import { ItemThumb } from "@/components/ui/ItemThumb";
import { ScrollChips } from "@/components/ui/ScrollChips";
import { Sheet } from "@/components/ui/Sheet";
import { toast } from "@/components/ui/Toast";
import { useLiveRefresh } from "@/lib/ui/use-live-refresh";
import type { CatalogGarment, CatalogVariant } from "@/lib/catalog/garments";

type Platform = "SHOPEE" | "TIKTOK";
type ItemFilter = "all" | "low" | "unlinked" | "check";

interface ShopInfo {
  id: string;
  platform: Platform;
  shopName: string;
  connected: boolean;
  stockImportStatus: string | null;
  stockImportedAt: string | null;
}

interface BumpStatus {
  connected: boolean;
  shopName: string | null;
  enabled: boolean;
  slotsTotal: number;
  pinnedItemIds: string[];
  boosted: Array<{
    itemId: string;
    name: string;
    imageUrl: string | null;
    cooldownSecond: number;
    endsAt: string;
  }>;
  lastBumpedAt: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
}

function formatCooldown(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m left`;
  return `${Math.max(1, m)}m left`;
}

const SHOP_LABEL: Record<Platform, string> = { SHOPEE: "Shopee", TIKTOK: "TikTok" };

async function post(body: Record<string, unknown>) {
  const res = await fetch("/api/catalog", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong");
  return data;
}

function ShopTags({ platforms }: { platforms: Platform[] }) {
  return (
    <span className="flex gap-1.5">
      {(["SHOPEE", "TIKTOK"] as const).map((p) => (
        <span
          key={p}
          className={`rounded-md px-1.5 py-0.5 text-[12px] font-bold ${
            platforms.includes(p) ? "bg-slate-100 text-ink-2" : "bg-transparent text-slate-300 line-through"
          }`}
        >
          {SHOP_LABEL[p]}
        </span>
      ))}
    </span>
  );
}

function variantNeedsCheck(v: CatalogVariant) {
  return v.startingStock === null && (v.stock.conflict || v.stock.suggested === null);
}

function StockRow({
  variant,
  others,
  onSaved,
}: {
  variant: CatalogVariant;
  others: CatalogVariant[];
  onSaved: () => void;
}) {
  const [value, setValue] = useState(variant.startingStock !== null ? String(variant.startingStock) : "");
  const [saving, setSaving] = useState(false);
  const shops = (Object.keys(variant.stock.byPlatform) as Platform[]).map(
    (p) => `${SHOP_LABEL[p]} ${variant.stock.byPlatform[p]}`
  );

  async function save() {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0) return toast("Enter a whole number", "error");
    setSaving(true);
    try {
      await post({ action: "set_starting_stock", variantId: variant.id, count: n });
      toast("Saved");
      onSaved();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }

  async function mergeInto(intoId: string) {
    try {
      await post({ action: "merge_variants", intoId, fromId: variant.id });
      toast("Linked");
      onSaved();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  const singleShop = new Set(variant.listings.map((l) => l.platform)).size === 1;
  const partners = others.filter(
    (o) => o.id !== variant.id && !o.listings.some((l) => variant.listings.some((m) => m.platform === l.platform))
  );

  return (
    <li className="space-y-2 py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0">
          <span className="block truncate text-[16px] font-semibold text-ink">{variant.label}</span>
          {variant.onShelf !== null ? (
            <span className="block text-[13px] text-ink-3 tabular-nums">
              {variant.onShelf} on shelf · {variant.committed} on orders · shops show {variant.available}
              {variant.listings.some((l) => l.pushError) ? (
                <span className="font-semibold text-missing-ink"> · not updated</span>
              ) : null}
            </span>
          ) : (
            <span className="block text-[13px] text-ink-3 tabular-nums">
              {shops.length ? shops.join(" · ") : "No stock from shops yet"}
              {variant.committed > 0 ? ` · ${variant.committed} on unshipped orders` : ""}
            </span>
          )}
          {variant.stock.conflict && variant.startingStock === null && (
            <span className="block text-[13px] font-semibold text-amber-800">Shops disagree. Count and check.</span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <label className="sr-only" htmlFor={`stock-${variant.id}`}>
            Pieces on the shelf for {variant.label}
          </label>
          <input
            id={`stock-${variant.id}`}
            inputMode="numeric"
            value={value}
            placeholder={variant.stock.suggested !== null ? String(variant.stock.suggested) : "0"}
            onChange={(e) => setValue(e.target.value.replace(/[^0-9]/g, ""))}
            className="h-11 w-20 rounded-[var(--radius-control)] bg-slate-100 px-3 text-right text-[16px] font-semibold tabular-nums text-ink focus:shadow-[0_0_0_2px_var(--color-brand)] focus:outline-none"
          />
          <Button variant="secondary" onClick={save} disabled={saving || value === ""} className="h-11 px-3">
            Save
          </Button>
        </span>
      </div>
      {singleShop && partners.length > 0 && (
        <label className="flex items-center gap-2 text-[14px] text-ink-3">
          Same as
          <select
            defaultValue=""
            onChange={(e) => e.target.value && mergeInto(e.target.value)}
            className="h-10 min-w-0 flex-1 rounded-[var(--radius-control)] bg-slate-100 px-2 text-[15px] text-ink"
          >
            <option value="">Pick the other shop&apos;s colour/size</option>
            {partners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label} ({p.listings.map((l) => SHOP_LABEL[l.platform]).join(", ")})
              </option>
            ))}
          </select>
        </label>
      )}
    </li>
  );
}

export default function ItemsPage() {
  const [garments, setGarments] = useState<CatalogGarment[] | null>(null);
  const [shops, setShops] = useState<ShopInfo[]>([]);
  const [bump, setBump] = useState<BumpStatus | null>(null);
  const [filter, setFilter] = useState<ItemFilter>("all");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [linkFrom, setLinkFrom] = useState<CatalogGarment | null>(null);
  const [linkTo, setLinkTo] = useState<CatalogGarment | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/catalog");
    if (!res.ok) return;
    const data = await res.json();
    setGarments(data.garments);
    setShops(data.shops);
    setBump(data.bump ?? null);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const importing = shops.some((s) => s.stockImportStatus === "RUNNING");
  useLiveRefresh({ enabled: !importing, onRefresh: load });
  useEffect(() => {
    if (!importing) return;
    const tick = () => {
      if (!document.hidden) void load();
    };
    const onVisibility = () => {
      if (!document.hidden) void load();
    };
    const t = setInterval(tick, 5000);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [importing, load]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (garments ?? []).filter((g) => {
      if (q && !g.name.toLowerCase().includes(q)) return false;
      if (filter === "low") return g.variants.some((v) => v.available !== null && v.available <= 5);
      if (filter === "unlinked") return g.platforms.length === 1;
      if (filter === "check") return g.variants.some(variantNeedsCheck);
      return true;
    });
  }, [garments, query, filter]);

  const open = garments?.find((g) => g.id === openId) ?? null;
  const unconfirmed = (garments ?? []).flatMap((g) => g.variants).filter((v) => v.startingStock === null && v.stock.suggested !== null);
  const needsCheck = (garments ?? []).flatMap((g) => g.variants).filter(variantNeedsCheck).length;
  const hasUnlinked = (garments ?? []).some((g) => g.platforms.length === 1);
  const bothConnected = shops.filter((s) => s.connected).length >= 2;

  async function run(body: Record<string, unknown>, done: string) {
    setBusy(true);
    try {
      const data = await post(body);
      if (data.error) toast(data.error, "error");
      else if (done) {
        toast(
          done
            .replace("{n}", String(data.confirmed ?? data.paired ?? data.linkedGarments ?? data.bumped ?? ""))
            .replace("{s}", String(data.confirmedStock ?? ""))
        );
      }
      await load();
      return data;
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  const otherPlatform = (g: CatalogGarment): Platform | null =>
    g.platforms.length === 1 ? (g.platforms[0] === "SHOPEE" ? "TIKTOK" : "SHOPEE") : null;

  const shopeeListingIdFor = (g: CatalogGarment) =>
    g.listings.find((l) => l.platform === "SHOPEE")?.listingId ?? null;
  const pinnedSet = new Set(bump?.pinnedItemIds ?? []);

  return (
    <AppShell title="Items & stock" onRefresh={load}>
      <div className="space-y-6">
        <Group className="p-4">
          {importing ? (
            <p className="text-[16px] font-semibold text-ink">Getting stock from your shops… This page updates by itself.</p>
          ) : (
            <div className="space-y-3">
              <p className="text-[15px] text-ink-2">
                {shops.some((s) => s.stockImportedAt)
                  ? "Stock syncs from your shops and links matching Shopee & TikTok items automatically."
                  : "Read every listing and its stock from Shopee and TikTok. Nothing is changed on the shops."}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  full={!bothConnected || !hasUnlinked}
                  variant={shops.some((s) => s.stockImportedAt) ? "secondary" : "primary"}
                  disabled={busy || !shops.some((s) => s.connected)}
                  onClick={() => run({ action: "start_import" }, "Started")}
                  className={bothConnected && hasUnlinked ? "flex-1" : undefined}
                >
                  {shops.some((s) => s.stockImportedAt) ? "Read stock again" : "Get stock from shops"}
                </Button>
                {bothConnected && hasUnlinked && (
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => run({ action: "auto_link" }, "Linked {n} items")}
                    className="flex-1"
                  >
                    <Sparkles className="mr-1.5 h-4 w-4" />
                    Auto-link twins
                  </Button>
                )}
              </div>
            </div>
          )}
        </Group>

        {bump?.connected && (
          <Group className="space-y-3 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-[17px] font-bold text-ink">Shopee Auto-Bump</h2>
                <p className="text-[13px] text-ink-3 tabular-nums">
                  {bump.boosted.length}/{bump.slotsTotal} slots active · rotates every 4 hours
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={bump.enabled}
                aria-label="Shopee Auto-Bump"
                disabled={busy}
                onClick={() => run({ action: "toggle_bump", enabled: !bump.enabled }, bump.enabled ? "Auto-bump off" : "Auto-bump on")}
                className={`relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors duration-200 ${
                  bump.enabled ? "bg-brand" : "bg-slate-300"
                }`}
              >
                <span
                  data-motion="slide"
                  className={`absolute left-0.5 top-0.5 h-[27px] w-[27px] rounded-full bg-white shadow-[0_2px_4px_rgb(15_23_42/0.2)] transition-transform duration-200 ease-[var(--ease-ios)] ${
                    bump.enabled ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>

            {bump.boosted.length > 0 && (
              <ul className="divide-y divide-hairline rounded-[var(--radius-control)] bg-slate-50 px-3">
                {bump.boosted.map((b) => (
                  <li key={b.itemId} className="flex items-center justify-between gap-3 py-2">
                    <span className="min-w-0 truncate text-[14px] font-medium text-ink">{b.name}</span>
                    <span className="shrink-0 text-[13px] font-semibold text-brand tabular-nums">
                      {formatCooldown(b.cooldownSecond)}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {bump.lastError && <p className="text-[13px] font-semibold text-missing-ink">{bump.lastError}</p>}

            <div className="flex items-center justify-between gap-3">
              <span className="text-[13px] text-ink-3">
                Tap ★ on any Shopee item below to prioritize it.
              </span>
              <Button
                variant="secondary"
                disabled={busy || bump.boosted.length >= bump.slotsTotal}
                onClick={() => run({ action: "bump_now" }, "Bumped {n} items")}
                className="h-10 shrink-0 px-3"
              >
                {bump.boosted.length >= bump.slotsTotal ? "Slots full" : "Bump now"}
              </Button>
            </div>
          </Group>
        )}

        {linkFrom && (
          <div className="flex items-center justify-between gap-3 rounded-[var(--radius-card)] bg-brand-soft px-4 py-3">
            <span className="text-[15px] font-semibold text-ink">
              Tap the {SHOP_LABEL[otherPlatform(linkFrom) ?? "TIKTOK"]} listing for &ldquo;{linkFrom.name}&rdquo;
            </span>
            <button type="button" onClick={() => setLinkFrom(null)} className="pressable text-[15px] font-bold text-brand">
              Cancel
            </button>
          </div>
        )}

        <div className="space-y-2.5">
          <ScrollChips label="Filters" rowClassName="gap-1.5 px-5 py-0.5">
            {(
              [
                { id: "all", label: "All" },
                { id: "low", label: "Low stock (≤5)" },
                { id: "unlinked", label: "One shop only" },
                { id: "check", label: `To check${needsCheck ? ` (${needsCheck})` : ""}` },
              ] as const
            ).map((f) => {
              const active = filter === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setFilter(f.id)}
                  className={`h-9 shrink-0 rounded-full px-3.5 text-[13px] font-semibold transition-colors ${
                    active ? "bg-ink text-white" : "bg-white text-ink-2 shadow-[var(--shadow-card)]"
                  }`}
                >
                  {f.label}
                </button>
              );
            })}
          </ScrollChips>

          <label className="relative block">
            <span className="sr-only">Search items</span>
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-3" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search items"
              className="h-12 w-full rounded-[var(--radius-control)] bg-white pl-11 pr-4 text-[16px] text-ink shadow-[var(--shadow-card)] focus:shadow-[0_0_0_2px_var(--color-brand)] focus:outline-none"
            />
          </label>
        </div>

        {garments === null ? (
          <div className="h-40 animate-pulse rounded-[var(--radius-card)] bg-slate-200/60" aria-busy="true" />
        ) : shown.length === 0 ? (
          <p className="px-1 text-[16px] text-ink-3">
            {garments.length === 0 ? "No items yet. Get stock from your shops to list them." : "No items match."}
          </p>
        ) : (
          <Group>
            <ul className="divide-y divide-hairline">
              {shown.map((g) => {
                const linkTarget = linkFrom && linkFrom.id !== g.id && otherPlatform(linkFrom) === g.platforms[0] && g.platforms.length === 1;
                const checks = g.variants.filter(variantNeedsCheck).length;
                const shopeeItemId = shopeeListingIdFor(g);
                const isPinned = shopeeItemId ? pinnedSet.has(shopeeItemId) : false;
                return (
                  <li
                    key={g.id}
                    className="flex items-center gap-2 px-4 py-3 [content-visibility:auto] [contain-intrinsic-size:auto_76px]"
                  >
                    <button
                      type="button"
                      onClick={() => (linkTarget ? setLinkTo(g) : setOpenId(g.id))}
                      className="pressable flex min-w-0 flex-1 items-center gap-3 text-left"
                    >
                      <ItemThumb src={g.imageUrl} alt={g.name} size="md" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[16px] font-semibold text-ink">{g.name}</span>
                        <span className="mt-1 flex items-center gap-2 text-[13px] text-ink-3">
                          <ShopTags platforms={g.platforms} />
                          {g.variants.length} sizes/colours
                          {checks > 0 && <span className="font-semibold text-amber-800">· {checks} to check</span>}
                        </span>
                      </span>
                      {linkTarget ? (
                        <span className="rounded-full bg-brand px-3 py-1.5 text-[14px] font-bold text-white">Link here</span>
                      ) : (
                        <ChevronRight className="h-5 w-5 shrink-0 text-ink-3" />
                      )}
                    </button>
                    {!linkFrom && shopeeItemId && bump?.connected && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => run({ action: "pin_bump", itemId: shopeeItemId }, isPinned ? "Unpinned from bump" : "Pinned for auto-bump")}
                        aria-label={isPinned ? `Unpin ${g.name} from auto-bump` : `Pin ${g.name} for auto-bump`}
                        className={`pressable flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-amber-50 ${
                          isPinned ? "text-amber-500" : "text-slate-300 hover:text-amber-500"
                        }`}
                      >
                        <Star className="h-5 w-5" fill={isPinned ? "currentColor" : "none"} />
                      </button>
                    )}
                    {!linkFrom && otherPlatform(g) && bothConnected && (
                      <button
                        type="button"
                        onClick={() => setLinkFrom(g)}
                        aria-label={`Link ${g.name} to the other shop`}
                        className="pressable flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-brand hover:bg-brand-soft"
                      >
                        <Link2 className="h-5 w-5" />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </Group>
        )}

        {unconfirmed.length > 0 && (
          <div className="space-y-2">
            {needsCheck > 0 && (
              <p className="px-1 text-[14px] text-amber-800">
                {needsCheck} sizes/colours have shops that disagree or no stock. Their lower number will be used.
              </p>
            )}
            <Button full size="lg" disabled={busy} onClick={() => run({ action: "confirm_all_starting_stock" }, "Saved {n} stock counts")}>
              Use these stock numbers ({unconfirmed.length})
            </Button>
          </div>
        )}
      </div>

      <Sheet open={Boolean(linkFrom && linkTo)} onClose={() => setLinkTo(null)} title="Same item?">
        {linkFrom && linkTo && (
          <div className="space-y-4">
            <p className="text-[16px] text-ink-2">
              &ldquo;{linkFrom.name}&rdquo; on {SHOP_LABEL[linkFrom.platforms[0]]} and &ldquo;{linkTo.name}&rdquo; on{" "}
              {SHOP_LABEL[linkTo.platforms[0]]} will share one stock count. Matching colours/sizes are paired; you can pair
              the rest by hand.
            </p>
            <Button
              full
              disabled={busy}
              onClick={async () => {
                const data = await run(
                  {
                    action: "link_listings",
                    a: { shopConnectionId: linkFrom.listings[0].shopConnectionId, listingId: linkFrom.listings[0].listingId },
                    b: { shopConnectionId: linkTo.listings[0].shopConnectionId, listingId: linkTo.listings[0].listingId },
                  },
                  "Linked {n} sizes/colours"
                );
                if (data) {
                  setLinkFrom(null);
                  setLinkTo(null);
                  setOpenId(linkFrom.id);
                }
              }}
            >
              Link them
            </Button>
          </div>
        )}
      </Sheet>

      <Sheet open={Boolean(open)} onClose={() => setOpenId(null)} title={open?.name ?? "Item"}>
        {open && (
          <div className="space-y-4">
            <ShopTags platforms={open.platforms} />
            <p className="text-[14px] text-ink-3">
              Pieces on the shelf now, including ones packed for unshipped orders. The grey number is our guess from the shops.
            </p>
            <ul className="divide-y divide-hairline">
              {open.variants.map((v) => (
                <StockRow key={v.id} variant={v} others={open.variants} onSaved={load} />
              ))}
            </ul>
            {open.platforms.length > 1 && (
              <Button
                variant="danger"
                full
                disabled={busy}
                onClick={async () => {
                  if (!window.confirm("Unlink this item? Each shop's listing goes back to its own stock count.")) return;
                  await run({ action: "unlink_garment", garmentId: open.id }, "Unlinked");
                  setOpenId(null);
                }}
              >
                Unlink shops
              </Button>
            )}
          </div>
        )}
      </Sheet>
    </AppShell>
  );
}
