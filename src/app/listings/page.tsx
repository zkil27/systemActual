"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Group } from "@/components/ui/Button";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { toast } from "@/components/ui/Toast";
import { CopyListingSheet } from "@/components/listings/CopyListingSheet";
import { ListingsPanel } from "@/components/listings/ListingsPanel";
import { PriceEditSheet } from "@/components/listings/PriceEditSheet";
import { PriceHistoryPanel } from "@/components/listings/PriceHistoryPanel";
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
  const [loading, setLoading] = useState(true);
  const [priceItem, setPriceItem] = useState<UnifiedListingItemDto | null>(null);
  const [copyItem, setCopyItem] = useState<UnifiedListingItemDto | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/listings", { cache: "no-store" });
      if (!res.ok) {
        if (res.status === 401) toast("Owner sign-in required.", "error");
        return;
      }
      const data = await res.json();
      setItems(data.items ?? []);
      setShops(data.shops ?? []);
      setHistory(data.history ?? []);
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
      headerRight={
        <Link
          href="/approvals"
          aria-label="Approvals"
          title="Approvals"
          className="pressable flex h-11 w-11 items-center justify-center rounded-full text-brand hover:bg-ink/[0.05]"
        >
          <CheckCircle2 className="h-[22px] w-[22px]" />
        </Link>
      }
    >
      <div className="space-y-4">
        <SegmentedControl
          label="Listings sections"
          value={tab}
          onChange={setTab}
          options={[
            { id: "listings" as const, label: `Listings (${items.length})` },
            { id: "history" as const, label: `Price history (${history.length})` },
          ]}
        />

        {loading ? (
          <Group className="p-6 text-center text-[14px] text-ink-3">
            Loading listings...
          </Group>
        ) : tab === "listings" ? (
          <ListingsPanel
            items={items}
            shops={shops}
            onEditPrice={setPriceItem}
            onCopyListing={setCopyItem}
          />
        ) : (
          <PriceHistoryPanel history={history} onChanged={load} />
        )}
      </div>

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
