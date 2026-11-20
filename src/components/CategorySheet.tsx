"use client";

import { useRef } from "react";
import { ButtonLink } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import type { CategoryDailyTruth } from "@/lib/analytics/daily-returns";
import { formatPeso, shortCourier } from "@/lib/ui/format";

export type CategoryKey = "failed" | "refund";

export const CATEGORY_META: Record<
  CategoryKey,
  { title: string; firstStage: string; dot: string; filter: string }
> = {
  failed: { title: "Failed delivery", firstStage: "Tagged", dot: "bg-amber-500", filter: "failed" },
  refund: { title: "Buyer return", firstStage: "Requested", dot: "bg-blue-600", filter: "refund" },
};

function Row({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-4 py-3">
      <span className="text-[16px] text-ink">{label}</span>
      <span className={`tabular-nums text-[16px] font-semibold ${tone ?? "text-ink-2"}`}>
        {value}
      </span>
    </div>
  );
}

/** A labelled run of rows separated by hairlines. No card: the sheet is the surface. */
function RowGroup({ label, children }: { label?: string; children: React.ReactNode }) {
  return (
    <div>
      {label && <p className="mb-1 text-[14px] font-semibold text-ink-3">{label}</p>}
      <div className="divide-y divide-hairline border-t border-hairline">{children}</div>
    </div>
  );
}

/** The detail that used to crowd the Home cards, one tap away. */
export function CategorySheet({
  category,
  stats,
  onClose,
}: {
  category: CategoryKey | null;
  stats: CategoryDailyTruth | null;
  onClose: () => void;
}) {
  // Keep the last content so the sheet isn't blank while it slides away.
  const last = useRef<{ category: CategoryKey; stats: CategoryDailyTruth } | null>(null);
  if (category && stats) last.current = { category, stats };
  const shown = last.current;
  const meta = CATEGORY_META[shown?.category ?? "failed"];

  return (
    <Sheet open={category !== null} onClose={onClose} title={meta.title}>
      {shown && (
        <div className="space-y-6 pt-2">
          <RowGroup label="By courier">
            {shown.stats.byCourier.length === 0 ? (
              <p className="py-4 text-[16px] text-ink-3">No parcels in this range</p>
            ) : (
              shown.stats.byCourier.map((c) => (
                <Row
                  key={c.courier}
                  label={shortCourier(c.courier)}
                  value={
                    <>
                      {c.tagged}
                      {c.missing > 0 && <span className="ml-2 text-missing">· {c.missing} missing</span>}
                    </>
                  }
                />
              ))
            )}
          </RowGroup>

          {shown.category === "refund" && (
            <RowGroup label="By store">
              <Row label="Shopee" value={shown.stats.shopeeTaggedCount} />
              <Row label="TikTok Shop" value={shown.stats.tiktokTaggedCount} />
            </RowGroup>
          )}

          <RowGroup>
            <Row
              label="Item cost at stake"
              value={formatPeso(shown.stats.taggedEstCostPhp)}
              tone="text-ink"
            />
            {shown.stats.arrivedIssueCount > 0 && (
              <Row
                label="Arrived with an issue"
                value={shown.stats.arrivedIssueCount}
                tone="text-amber-800"
              />
            )}
          </RowGroup>

          <ButtonLink href={`/returns?filter=${meta.filter}`} full>
            See parcels
          </ButtonLink>
        </div>
      )}
    </Sheet>
  );
}
