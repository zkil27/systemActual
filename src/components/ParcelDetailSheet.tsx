"use client";

import { useEffect, useState } from "react";
import { Check, Copy, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Disclosure } from "@/components/ui/Disclosure";
import { ItemThumb } from "@/components/ui/ItemThumb";
import { Sheet } from "@/components/ui/Sheet";
import { StatusPill } from "@/components/ui/StatusPill";
import { formatPeso, manilaDateTime } from "@/lib/ui/format";
import { categoryLabel, getParcelStatus } from "@/lib/ui/parcel-status";
import { conditionLabel } from "@/lib/ui/conditions";

interface ParcelScan {
  id: string;
  condition: string;
  notes: string | null;
  photoUrls: string[];
  scannedAt: string;
  staffMember: { name: string };
}

interface ParcelDetailData {
  id: string;
  platform: "SHOPEE" | "TIKTOK";
  orderSn: string;
  forwardTrackingNumber: string | null;
  rtsTrackingNumber: string | null;
  courier: string;
  category: "FAILED_DELIVERY" | "RETURN_REFUND";
  returnReason: string | null;
  itemSummary: string;
  variationName: string | null;
  quantity: number;
  itemImageUrl: string | null;
  orderTotalPhp: number;
  estimatedUnitCostPhp: number;
  digitalReturnTaggedAt: string | null;
  courierReturnedToSellerAt: string | null;
  physicallyReceivedAt: string | null;
  physicalCondition: string | null;
  disputeDraft: string | null;
  isMissingDiscrepancy: boolean;
  scans: ParcelScan[];
}

function Stage({
  label,
  at,
  last,
  alert,
}: {
  label: string;
  at: string | null;
  last?: boolean;
  alert?: boolean;
}) {
  const done = Boolean(at);
  return (
    <li className="relative flex gap-3.5 pb-5 last:pb-0">
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
          done
            ? last
              ? "border-arrived bg-arrived"
              : "border-brand bg-brand"
            : alert
              ? "border-missing bg-white"
              : "border-hairline-strong bg-white"
        }`}
      />
      <div className="flex min-w-0 flex-1 items-baseline justify-between gap-3">
        <span className={`text-[16px] ${done ? "font-semibold text-ink" : "text-ink-2"}`}>{label}</span>
        <span
          className={`tabular-nums text-[15px] ${
            done ? "text-ink-2" : alert ? "font-semibold text-missing" : "text-ink-3"
          }`}
        >
          {done ? manilaDateTime(at) : "Not yet"}
        </span>
      </div>
    </li>
  );
}

const summaryClass =
  "pressable h-12 rounded-[var(--radius-control)] text-[16px] font-semibold text-ink";

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <dt className="shrink-0 text-[15px] text-ink-3">{label}</dt>
      <dd className="tabular-nums min-w-0 break-all text-right text-[15px] font-semibold text-ink">
        {value}
      </dd>
    </div>
  );
}

function ParcelDetailBody({ parcelId }: { parcelId: string | null }) {
  // Kept after close so the sheet still has content while it slides away.
  const [parcel, setParcel] = useState<ParcelDetailData | null>(null);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!parcelId) return;
    let active = true;
    setLoading(true);
    setParcel(null);
    setCopied(false);
    fetch(`/api/returns/${parcelId}`)
      .then((r) => r.json())
      .then((d) => {
        if (!active) return;
        setParcel(d.parcel ?? null);
        setDraft(d.parcel?.disputeDraft ?? null);
      })
      .catch(() => {
        if (active) setParcel(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [parcelId]);

  async function handleGenerateDraft() {
    if (!parcel) return;
    setDrafting(true);
    try {
      const res = await fetch(`/api/returns/${parcel.id}`, { method: "POST" });
      const data = await res.json();
      if (data.draft) setDraft(data.draft);
    } finally {
      setDrafting(false);
    }
  }

  async function handleCopy() {
    if (!draft) return;
    await navigator.clipboard.writeText(draft);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  const status = parcel ? getParcelStatus(parcel) : null;
  const scan = parcel?.scans[0];
  const photos = parcel?.scans.flatMap((s) => s.photoUrls) ?? [];
  const store = parcel?.platform === "SHOPEE" ? "Shopee" : "TikTok Shop";
  // Missing or problem parcels are the ones worth disputing; lead with the action there.
  const needsDispute = status?.tone === "missing" || status?.tone === "issue";

  if (loading || !parcel) {
    return (
      <div className="space-y-4 pt-2" aria-busy="true">
        <div className="flex gap-4">
          <div className="h-28 w-28 animate-pulse rounded-[var(--radius-card)] bg-slate-100" />
          <div className="flex-1 space-y-2 pt-2">
            <div className="h-5 w-3/4 animate-pulse rounded bg-slate-100" />
            <div className="h-5 w-1/3 animate-pulse rounded bg-slate-100" />
          </div>
        </div>
        <div className="h-32 animate-pulse rounded-[var(--radius-card)] bg-slate-100" />
      </div>
    );
  }

  return (
    <div className="anim-fade-in space-y-7 pt-2">
      {/* What it is */}
      <div className="flex items-start gap-4">
        <ItemThumb src={parcel.itemImageUrl} alt={parcel.itemSummary} size="xl" />
        <div className="min-w-0 flex-1 pt-1">
          <p className="text-[19px] font-bold leading-snug text-ink">
            {parcel.quantity > 1 && <span className="tabular-nums">{parcel.quantity}× </span>}
            {parcel.itemSummary}
          </p>
          {parcel.variationName && (
            <p className="mt-2 inline-block rounded-lg bg-ink px-2.5 py-1 text-[14px] font-bold text-white">
              {parcel.variationName}
            </p>
          )}
          <p className="mt-2 text-[15px] text-ink-3">
            {categoryLabel(parcel.category)} · {store}
          </p>
        </div>
      </div>

      {status && (
        <div className="flex items-center justify-between gap-3">
          <StatusPill label={status.label} tone={status.tone} />
          {scan && (
            <span className="text-[15px] text-ink-2">
              {conditionLabel(scan.condition)} · {scan.staffMember.name}
            </span>
          )}
        </div>
      )}

      <ol aria-label="Parcel timeline">
        <Stage
          label={parcel.category === "FAILED_DELIVERY" ? "Tagged" : "Requested"}
          at={parcel.digitalReturnTaggedAt}
        />
        <Stage label="Sent back" at={parcel.courierReturnedToSellerAt} />
        <Stage
          label="Arrived"
          at={parcel.physicallyReceivedAt}
          last
          alert={parcel.isMissingDiscrepancy}
        />
      </ol>

      {scan?.notes && <p className="text-[15px] text-ink-2">“{scan.notes}”</p>}

      {photos.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {photos.map((url) => (
            <a
              key={url}
              href={url}
              target="_blank"
              rel="noreferrer"
              className="pressable block overflow-hidden rounded-[var(--radius-control)]"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="Proof photo from the warehouse" className="aspect-square w-full object-cover" />
            </a>
          ))}
        </div>
      )}

      {/* Dispute message: one tap to copy; the text itself stays folded. */}
      {draft ? (
        <div className="space-y-1">
          <Button onClick={handleCopy} full variant={needsDispute ? "primary" : "secondary"}>
            <span key={copied ? "c" : "n"} className="anim-fade-in inline-flex items-center gap-2">
              {copied ? (
                <>
                  <Check className="h-5 w-5" strokeWidth={3} />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="h-5 w-5" />
                  Copy dispute for {store}
                </>
              )}
            </span>
          </Button>
          <Disclosure label="See message" summaryClassName={summaryClass}>
            <div className="space-y-2 pb-2">
              <textarea
                readOnly
                rows={8}
                value={draft}
                aria-label="Dispute message"
                className="w-full rounded-[var(--radius-control)] bg-surface-subtle p-3.5 text-[14px] leading-relaxed text-ink ring-1 ring-hairline focus:outline-none"
              />
              <Button variant="plain" onClick={handleGenerateDraft} disabled={drafting} full>
                {drafting ? "Writing…" : "Write again"}
              </Button>
            </div>
          </Disclosure>
        </div>
      ) : (
        <Button
          onClick={handleGenerateDraft}
          disabled={drafting}
          full
          variant={needsDispute ? "primary" : "secondary"}
        >
          {drafting ? "Writing…" : "Write dispute message"}
        </Button>
      )}

      <Disclosure label="Order details" summaryClassName={summaryClass} className="-mt-4">
        <dl className="divide-y divide-hairline border-t border-hairline">
          <DetailRow label="Order" value={parcel.orderSn} />
          <DetailRow
            label="Tracking"
            value={parcel.rtsTrackingNumber || parcel.forwardTrackingNumber || "None"}
          />
          <DetailRow label="Courier" value={parcel.courier} />
          <DetailRow
            label="Cost / sold for"
            value={`${formatPeso(parcel.estimatedUnitCostPhp)} / ${formatPeso(parcel.orderTotalPhp)}`}
          />
          <DetailRow label="Reason" value={parcel.returnReason || "None given"} />
        </dl>
      </Disclosure>
    </div>
  );
}

export function ParcelDetailSheet({
  parcelId,
  onClose,
}: {
  parcelId: string | null;
  onClose: () => void;
}) {
  return (
    <Sheet open={parcelId !== null} onClose={onClose} title="Parcel">
      <ParcelDetailBody parcelId={parcelId} />
    </Sheet>
  );
}

export function ParcelDetailPanel({
  parcelId,
  onClose,
}: {
  parcelId: string;
  onClose: () => void;
}) {
  return (
    <div>
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 bg-white px-5 pb-2 pt-4">
        <h2 className="text-[20px] font-extrabold tracking-[-0.01em] text-ink">Parcel</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close details"
          className="pressable -mr-1.5 flex h-11 w-11 items-center justify-center rounded-full text-ink-3 hover:bg-slate-100"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100">
            <X className="h-4 w-4" strokeWidth={2.6} />
          </span>
        </button>
      </div>
      <div className="px-5 pb-6">
        <ParcelDetailBody parcelId={parcelId} />
      </div>
    </div>
  );
}
