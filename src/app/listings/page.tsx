"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, ChevronRight } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { StockHubNav } from "@/components/StockHubNav";
import { Group } from "@/components/ui/Button";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { toast } from "@/components/ui/Toast";
import { AddItemSheet } from "@/components/listings/AddItemSheet";
import { CopyListingSheet } from "@/components/listings/CopyListingSheet";
import { ListingsPanel } from "@/components/listings/ListingsPanel";
import { PriceEditSheet } from "@/components/listings/PriceEditSheet";
import { PriceHistoryPanel } from "@/components/listings/PriceHistoryPanel";
import { RetryPublishSheet, type ItemPublishSummary } from "@/components/listings/RetryPublishSheet";
import type {
  PriceChangeHistoryDto,
  ShopSummaryDto,
  UnifiedListingItemDto,
} from "@/lib/listings/service";
import { useLiveRefresh } from "@/lib/ui/use-live-refresh";

type Tab = "listings" | "history";

export default function ListingsPage() {
  const [tab, setTab] = useState<Tab>("listings");
  const [items, setItems] = useState<UnifiedListingItemDto[]>([]);
  const [shops, setShops] = useState<ShopSummaryDto[]>([]);
  const [history, setHistory] = useState<PriceChangeHistoryDto[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const [loading, setLoading] = useState(true);
  const [priceItem, setPriceItem] = useState<UnifiedListingItemDto | null>(null);
  const [copyItem, setCopyItem] = useState<UnifiedListingItemDto | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [retryState, setRetryState] = useState<{
    itemTitle: string;
    publish: ItemPublishSummary;
  } | null>(null);

  const load = useCallback(async () => {
    try {
      const [res, appRes] = await Promise.all([
        fetch("/api/listings", { cache: "no-store" }),
        fetch("/api/approvals?countOnly=1", { cache: "no-store" }).catch(() => null),
      ]);
      if (!res.ok) {
        if (res.status === 401) toast("Owner sign-in required.", "error");
        return;
      }
      const data = await res.json();
      setItems(data.items ?? []);
      setShops(data.shops ?? []);
      setHistory(data.history ?? []);
      if (appRes?.ok) {
        const appData = await appRes.json().catch(() => null);
        if (appData && typeof appData.pendingCount === "number") {
          setPendingApprovals(appData.pendingCount);
        }
      }
    } catch {
      toast("Couldn't load listings.", "error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useLiveRefresh({ onRefresh: load });

  return (
    <AppShell
      title="Listings & prices"
      onRefresh={load}
      approvalsCount={pendingApprovals}
      headerRight={
        <Link
          href="/approvals"
          aria-label="Approvals"
          title="Approvals"
          className="pressable hidden h-11 w-11 items-center justify-center rounded-full text-brand hover:bg-ink/[0.05] lg:flex"
        >
          <CheckCircle2 className="h-[22px] w-[22px]" />
        </Link>
      }
    >
      <div className="space-y-4">
        <StockHubNav active="listings" />

        <SegmentedControl
          label="Listings sections"
          value={tab}
          onChange={setTab}
          options={[
            { id: "listings" as const, label: `Listings (${items.length})` },
            { id: "history" as const, label: `Price history (${history.length})` },
          ]}
        />

        {pendingApprovals > 0 && (
          <Link
            href="/approvals"
            className="pressable-row flex min-h-12 items-center justify-between gap-3 rounded-[var(--radius-control)] bg-surface px-4 py-2.5 shadow-[var(--shadow-card)] lg:hidden"
          >
            <span className="flex items-center gap-2.5 text-[15px] font-semibold text-ink">
              <CheckCircle2 className="h-5 w-5 text-brand" />
              Approvals
            </span>
            <span className="flex items-center gap-1.5">
              <span className="tabular-nums rounded-full bg-brand-solid px-2 py-0.5 text-[12px] font-bold text-on-brand">
                {pendingApprovals} waiting
              </span>
              <ChevronRight className="h-4 w-4 text-ink-3" />
            </span>
          </Link>
        )}

        {loading ? (
          <Group className="p-6 text-center text-[14px] text-ink-3">
            Loading listings...
          </Group>
        ) : tab === "listings" ? (
          <ListingsPanel
            items={items}
            shops={shops}
            onAddItem={() => setAddOpen(true)}
            onEditPrice={setPriceItem}
            onCopyListing={setCopyItem}
            onRetryPublish={(item, publish) =>
              setRetryState({ itemTitle: item.garmentName, publish })
            }
          />
        ) : (
          <PriceHistoryPanel history={history} onChanged={load} />
        )}
      </div>

      <AddItemSheet
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onCreated={load}
      />

      <RetryPublishSheet
        open={Boolean(retryState)}
        onClose={() => setRetryState(null)}
        itemTitle={retryState?.itemTitle ?? ""}
        publish={retryState?.publish ?? null}
        onRetried={load}
      />

      <PriceEditSheet
        open={Boolean(priceItem)}
        onClose={() => setPriceItem(null)}
        item={priceItem}
        shops={shops}
        onProposed={load}
      />

      <CopyListingSheet
        open={Boolean(copyItem)}
        onClose={() => setCopyItem(null)}
        item={copyItem}
        shops={shops}
        onProposed={load}
      />
    </AppShell>
  );
}
