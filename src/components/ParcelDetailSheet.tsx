"use client";

import { useCallback, useEffect, useState } from "react";
import { AlarmClock, Check, Copy, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Disclosure } from "@/components/ui/Disclosure";
import { ItemThumb } from "@/components/ui/ItemThumb";
import { PhotoLightbox } from "@/components/ui/PhotoLightbox";
import { Sheet } from "@/components/ui/Sheet";
import { StatusPill } from "@/components/ui/StatusPill";
import { toast } from "@/components/ui/Toast";
import { formatPeso, manilaDateTime } from "@/lib/ui/format";
import { categoryLabel, getParcelStatus } from "@/lib/ui/parcel-status";
import { CONDITIONS, conditionLabel } from "@/lib/ui/conditions";
import { deadlineCountdown, DISPUTE_STATUSES, eventSourceLabel, humanizeStatus, type DisputeStatusId } from "@/lib/ui/dispute";
import { ReturnCheckCard, type ItemCheckRow } from "@/components/returns/ReturnCheckCard";

/** Words for the "Who did what" list. Unknown actions show as-is. */
const AUDIT_LABEL: Record<string, string> = {
  "return.scan": "Checked in",
  "return.scan_undone": "Undid a check-in",
  "return.items_corrected": "Fixed items",
  "return.correct_condition": "Fixed condition",
  "return.set_dispute": "Updated dispute",
  "return.resolve": "Closed it",
  "return.reopen": "Reopened",
};

interface AuditEntry {
  id: string;
  at: string;
  actorType: string;
  actorName: string;
  action: string;
}

interface ParcelScan {
  id: string;
  condition: string;
  notes: string | null;
  photoUrls: string[];
  scannedAt: string;
  packagingTorn?: boolean;
  staffMember: { name: string };
  itemChecks?: ItemCheckRow[];
}

interface ParcelEvent {
  id: string;
  source: string;
  rawStatus: string;
  description: string | null;
  eventTimestamp: string;
}

interface ParcelDetailData {
  id: string;
  platform: "SHOPEE" | "TIKTOK";
  orderSn: string;
  returnSn: string | null;
  forwardTrackingNumber: string | null;
  rtsTrackingNumber: string | null;
  courier: string;
  category: "FAILED_DELIVERY" | "RETURN_REFUND";
  digitalStatus: string;
  expectsPhysicalReturn: boolean;
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
  disputeDeadlineAt: string | null;
  disputeStatus: DisputeStatusId;
  disputeFiledAt: string | null;
  disputeRef: string | null;
  reimbursedPhp: number | null;
  resolvedAt: string | null;
  resolvedNote: string | null;
  isMissingDiscrepancy: boolean;
  isOverdueRts: boolean;
  isUrgentDeadline: boolean;
  isRefundedNotBack?: boolean;
  receivedValuePhp?: number | null;
  events: ParcelEvent[];
  scans: ParcelScan[];
}

type ParcelPatch =
  | { action: "set_dispute"; status: DisputeStatusId; ref?: string | null; reimbursedPhp?: number | null }
  | { action: "resolve"; outcome: "FOUND" | "SETTLED"; note?: string | null }
  | { action: "reopen" }
  | { action: "correct_condition"; condition: string }
  | {
      action: "correct_items";
      checks: Array<{ lineKey: string; missing?: number; wrong?: number; damaged?: number }>;
      packagingTorn: boolean;
    };

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
              ? "border-missing bg-surface"
              : "border-hairline-strong bg-surface"
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

const inputClass =
  "h-12 w-full rounded-[var(--radius-control)] bg-surface-subtle px-3.5 text-[16px] text-ink ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-brand";

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

function ParcelDetailBody({
  parcelId,
  onChanged,
}: {
  parcelId: string | null;
  onChanged?: () => void;
}) {
  // Kept after close so the sheet still has content while it slides away.
  const [parcel, setParcel] = useState<ParcelDetailData | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [draft, setDraft] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [photoIndex, setPhotoIndex] = useState<number | null>(null);
  const [disputeRef, setDisputeRef] = useState("");
  const [reimbursed, setReimbursed] = useState("");
  const [audit, setAudit] = useState<AuditEntry[]>([]);

  // A different parcel starts clean; a reload after an action keeps the content on screen.
  useEffect(() => {
    setParcel(null);
    setPhotoIndex(null);
    setReloadKey(0);
  }, [parcelId]);

  useEffect(() => {
    if (!parcelId) return;
    let active = true;
    if (reloadKey === 0) setLoading(true);
    setLoadError(false);
    setCopied(false);
    fetch(`/api/returns/${parcelId}`, { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((d) => {
        if (!active) return;
        const p: ParcelDetailData | null = d.parcel ?? null;
        setParcel(p);
        setAudit(Array.isArray(d.audit) ? d.audit : []);
        setDraft(p?.disputeDraft ?? null);
        setDisputeRef(p?.disputeRef ?? "");
        setReimbursed(p?.reimbursedPhp != null ? String(p.reimbursedPhp) : "");
      })
      .catch(() => {
        if (active) setLoadError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [parcelId, reloadKey]);

  const patch = useCallback(
    async (body: ParcelPatch, success: string) => {
      if (!parcel) return;
      setSaving(true);
      try {
        const res = await fetch(`/api/returns/${parcel.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast(data.error || "Couldn't save", "error");
          return;
        }
        const delta = Number(data.restockDelta ?? 0);
        toast(
          delta > 0
            ? `${success} · ${delta} back on shelf`
            : delta < 0
              ? `${success} · ${-delta} off shelf`
              : success
        );
        setReloadKey((k) => k + 1);
        onChanged?.();
      } catch {
        toast("No connection", "error");
      } finally {
        setSaving(false);
      }
    },
    [parcel, onChanged]
  );

  async function handleGenerateDraft() {
    if (!parcel) return;
    setDrafting(true);
    try {
      const res = await fetch(`/api/returns/${parcel.id}`, { method: "POST" });
      const data = await res.json();
      if (data.draft) setDraft(data.draft);
    } catch {
      toast("No connection", "error");
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

  if (loadError && !parcel) {
    return (
      <div className="space-y-4 pt-4 text-center">
        <p className="text-[16px] text-ink-2">Couldn&apos;t load this parcel.</p>
        <Button variant="secondary" onClick={() => setReloadKey((k) => k + 1)}>
          Try again
        </Button>
      </div>
    );
  }

  if (loading || !parcel) {
    return (
      <div className="space-y-4 pt-2" aria-busy="true">
        <div className="flex gap-4">
          <div className="h-28 w-28 animate-pulse rounded-[var(--radius-card)] bg-surface-muted" />
          <div className="flex-1 space-y-2 pt-2">
            <div className="h-5 w-3/4 animate-pulse rounded bg-surface-muted" />
            <div className="h-5 w-1/3 animate-pulse rounded bg-surface-muted" />
          </div>
        </div>
        <div className="h-32 animate-pulse rounded-[var(--radius-card)] bg-surface-muted" />
      </div>
    );
  }

  const status = getParcelStatus(parcel);
  const scan = parcel.scans[0];
  const photos = parcel.scans.flatMap((s) => s.photoUrls);
  const store = parcel.platform === "SHOPEE" ? "Shopee" : "TikTok Shop";
  // Missing or problem parcels are the ones worth disputing; lead with the action there.
  const needsDispute = status.tone === "missing" || status.tone === "issue";
  const deadline =
    !parcel.resolvedAt && parcel.disputeStatus === "NONE" ? deadlineCountdown(parcel.disputeDeadlineAt) : null;
  const showDispute =
    needsDispute ||
    parcel.isOverdueRts ||
    Boolean(parcel.disputeDeadlineAt) ||
    parcel.disputeStatus !== "NONE" ||
    Boolean(parcel.resolvedAt);
  const reimbursedSaved = parcel.reimbursedPhp != null ? String(parcel.reimbursedPhp) : "";
  const disputeDirty =
    disputeRef.trim() !== (parcel.disputeRef ?? "") ||
    (parcel.disputeStatus === "WON" && reimbursed !== reimbursedSaved);
  const reimbursedNumber = reimbursed && Number.isFinite(Number(reimbursed)) ? Number(reimbursed) : null;
  const itemRows = scan?.itemChecks ?? [];
  // One-piece parcels keep the simple condition fix; bigger ones are fixed item by item.
  const itemChecked = itemRows.length > 1 || (itemRows.length === 1 && itemRows[0].expectedQty > 1);

  return (
    <div key={parcel.id} className="anim-fade-in space-y-7 pt-2">
      {/* What it is */}
      <div className="flex items-start gap-4">
        <ItemThumb src={parcel.itemImageUrl} alt={parcel.itemSummary} size="xl" />
        <div className="min-w-0 flex-1 pt-1">
          <p className="text-[19px] font-bold leading-snug text-ink">
            {parcel.quantity > 1 && <span className="tabular-nums">{parcel.quantity}× </span>}
            {parcel.itemSummary}
          </p>
          {parcel.variationName && (
            <p className="mt-2 inline-block rounded-lg bg-ink px-2.5 py-1 text-[14px] font-bold text-ink-inverse">
              {parcel.variationName}
            </p>
          )}
          <p className="mt-2 text-[15px] text-ink-3">
            {categoryLabel(parcel.category)} · {store}
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <StatusPill label={status.label} tone={status.tone} />
        {scan && (
          <span className="text-[15px] text-ink-2">
            {conditionLabel(scan.condition)} · {scan.staffMember.name}
          </span>
        )}
      </div>

      <ol aria-label="Parcel timeline">
        <Stage
          label={parcel.category === "FAILED_DELIVERY" ? "Tagged" : "Requested"}
          at={parcel.digitalReturnTaggedAt}
        />
        <Stage label="Returned to seller" at={parcel.courierReturnedToSellerAt} />
        <Stage label="Arrived" at={parcel.physicallyReceivedAt} last alert={parcel.isMissingDiscrepancy} />
      </ol>

      {parcel.isRefundedNotBack && (
        <div className="flex items-start gap-2.5 rounded-[var(--radius-control)] bg-missing-soft px-4 py-3 text-[15px] font-semibold text-missing-ink">
          <AlarmClock className="mt-0.5 h-5 w-5 shrink-0" />
          <span>
            Buyer refund paid, nothing scanned back yet.{" "}
            {parcel.courierReturnedToSellerAt ? "Courier says it was returned." : "No courier update yet."}
          </span>
        </div>
      )}

      {itemChecked && (
        <ReturnCheckCard
          rows={itemRows}
          category={parcel.category}
          refundPhp={parcel.orderTotalPhp}
          receivedValuePhp={parcel.receivedValuePhp ?? null}
          packagingTorn={Boolean(scan?.packagingTorn)}
          saving={saving}
          onFix={(body) => patch({ action: "correct_items", ...body }, "Items fixed")}
        />
      )}

      {scan?.notes && <p className="text-[15px] text-ink-2">“{scan.notes}”</p>}

      {photos.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {photos.map((url, i) => (
            <button
              key={url}
              type="button"
              onClick={() => setPhotoIndex(i)}
              aria-label={`Open proof photo ${i + 1}`}
              className="pressable block overflow-hidden rounded-[var(--radius-control)]"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="Proof photo from the warehouse" className="aspect-square w-full object-cover" />
            </button>
          ))}
        </div>
      )}
      <PhotoLightbox
        photos={photos}
        index={photoIndex}
        onIndexChange={setPhotoIndex}
        onClose={() => setPhotoIndex(null)}
        fileBaseName={`proof-${parcel.orderSn}`}
      />

      {deadline && (
        <div
          className={`flex items-center gap-2.5 rounded-[var(--radius-control)] px-4 py-3 text-[15px] font-semibold ${
            deadline.tone === "urgent"
              ? "bg-missing-soft text-missing-ink"
              : deadline.tone === "past"
                ? "bg-surface-muted text-ink-2"
                : "bg-failed-soft text-failed-ink"
          }`}
        >
          <AlarmClock className="h-5 w-5 shrink-0" />
          <span className="tabular-nums">
            {deadline.label} · {manilaDateTime(parcel.disputeDeadlineAt)}
          </span>
        </div>
      )}

      {parcel.resolvedAt ? (
        <div className="flex items-center justify-between gap-3 rounded-[var(--radius-control)] bg-arrived-soft px-4 py-2">
          <span className="min-w-0 text-[15px] font-semibold text-arrived">
            {parcel.resolvedNote || "Settled"} · {manilaDateTime(parcel.resolvedAt)}
          </span>
          <button
            type="button"
            disabled={saving}
            onClick={() => patch({ action: "reopen" }, "Reopened")}
            className="pressable inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-3 text-[15px] font-semibold text-brand hover:bg-brand/10"
          >
            <RotateCcw className="h-4 w-4" /> Reopen
          </button>
        </div>
      ) : (
        (parcel.isMissingDiscrepancy || parcel.isOverdueRts) && (
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="secondary"
              disabled={saving}
              onClick={() => patch({ action: "resolve", outcome: "FOUND" }, "Marked found")}
            >
              Found it
            </Button>
            <Button
              variant="secondary"
              disabled={saving}
              onClick={() => patch({ action: "resolve", outcome: "SETTLED" }, "Marked settled")}
            >
              Settled
            </Button>
          </div>
        )
      )}

      {/* Dispute message: one tap to copy; the text itself stays folded. */}
      {draft ? (
        <div className="space-y-1">
          <Button onClick={handleCopy} full variant={needsDispute ? "primary" : "secondary"}>
            <span key={copied ? "c" : "n"} className="anim-fade-in inline-flex items-center gap-2">
              {copied ? (
                <>
                  <Check className="anim-pop h-5 w-5" strokeWidth={3} />
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
                className="w-full rounded-[var(--radius-control)] bg-surface-subtle p-3.5 text-[16px] leading-relaxed text-ink ring-1 ring-hairline focus:outline-none"
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

      {showDispute && (
        <section aria-label="Dispute status" className="space-y-3">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-[17px] font-bold text-ink">Dispute</h3>
            {parcel.disputeFiledAt && (
              <span className="text-[14px] text-ink-3">Filed {manilaDateTime(parcel.disputeFiledAt)}</span>
            )}
          </div>
          <div role="radiogroup" aria-label="Dispute status" className="grid grid-cols-4 gap-1.5">
            {DISPUTE_STATUSES.map((d) => {
              const active = parcel.disputeStatus === d.id;
              return (
                <button
                  key={d.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  disabled={saving}
                  onClick={() => {
                    if (active) return;
                    patch(
                      {
                        action: "set_dispute",
                        status: d.id,
                        ref: disputeRef.trim() || null,
                        reimbursedPhp: d.id === "WON" ? reimbursedNumber : null,
                      },
                      d.toast
                    );
                  }}
                  className={`pressable min-h-11 rounded-[var(--radius-control)] px-1 text-[14px] font-bold ${
                    active ? d.activeClass : "bg-surface-muted text-ink-2 hover:bg-surface-track"
                  }`}
                >
                  {d.label}
                </button>
              );
            })}
          </div>
          {parcel.disputeStatus !== "NONE" && (
            <div className="space-y-2.5">
              <label className="block">
                <span className="mb-1 block text-[14px] font-semibold text-ink-3">Case / ticket number</span>
                <input
                  value={disputeRef}
                  onChange={(e) => setDisputeRef(e.target.value)}
                  maxLength={120}
                  placeholder="From Seller Center"
                  className={inputClass}
                />
              </label>
              {parcel.disputeStatus === "WON" && (
                <label className="block">
                  <span className="mb-1 block text-[14px] font-semibold text-ink-3">Money back (₱)</span>
                  <input
                    value={reimbursed}
                    onChange={(e) => setReimbursed(e.target.value.replace(/[^0-9.]/g, ""))}
                    inputMode="decimal"
                    placeholder="0.00"
                    className={`tabular-nums ${inputClass}`}
                  />
                </label>
              )}
              {disputeDirty && (
                <Button
                  full
                  disabled={saving}
                  onClick={() =>
                    patch(
                      {
                        action: "set_dispute",
                        status: parcel.disputeStatus,
                        ref: disputeRef.trim() || null,
                        reimbursedPhp: parcel.disputeStatus === "WON" ? reimbursedNumber : null,
                      },
                      "Saved"
                    )
                  }
                >
                  {saving ? "Saving…" : "Save"}
                </Button>
              )}
            </div>
          )}
        </section>
      )}

      <Disclosure label="Order details" summaryClassName={summaryClass} className="-mt-4">
        <dl className="divide-y divide-hairline border-t border-hairline">
          <DetailRow label="Order" value={parcel.orderSn} />
          {parcel.returnSn && <DetailRow label="Return" value={parcel.returnSn} />}
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

      {parcel.events.length > 0 && (
        <Disclosure label={`History (${parcel.events.length})`} summaryClassName={summaryClass} className="-mt-4">
          <ol className="divide-y divide-hairline border-t border-hairline">
            {parcel.events.map((e) => (
              <li key={e.id} className="flex items-start justify-between gap-4 py-3">
                <span className="min-w-0">
                  <span className="block text-[15px] font-semibold text-ink">
                    {e.description || humanizeStatus(e.rawStatus)}
                  </span>
                  <span className="block text-[13px] text-ink-3">{eventSourceLabel(e.source)}</span>
                </span>
                <span className="tabular-nums shrink-0 text-[14px] text-ink-2">
                  {manilaDateTime(e.eventTimestamp)}
                </span>
              </li>
            ))}
          </ol>
        </Disclosure>
      )}

      {audit.length > 0 && (
        <Disclosure label={`Who did what (${audit.length})`} summaryClassName={summaryClass} className="-mt-4">
          <ol className="divide-y divide-hairline border-t border-hairline">
            {audit.map((a) => (
              <li key={a.id} className="flex items-start justify-between gap-4 py-3">
                <span className="min-w-0">
                  <span className="block text-[15px] font-semibold text-ink">
                    {AUDIT_LABEL[a.action] ?? a.action}
                  </span>
                  <span className="block text-[13px] text-ink-3">
                    {a.actorType === "SYSTEM" ? "The app" : a.actorName}
                  </span>
                </span>
                <span className="tabular-nums shrink-0 text-[14px] text-ink-2">{manilaDateTime(a.at)}</span>
              </li>
            ))}
          </ol>
        </Disclosure>
      )}

      {parcel.physicallyReceivedAt && !itemChecked && (
        <Disclosure label="Fix scanned condition" summaryClassName={summaryClass} className="-mt-4">
          <div className="space-y-1.5 pb-2">
            <p className="pb-1 text-[14px] text-ink-3">
              Staff picked the wrong one? Changing it also fixes the shelf count.
            </p>
            {CONDITIONS.map((c) => {
              const active = parcel.physicalCondition === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  disabled={saving || active}
                  onClick={() => patch({ action: "correct_condition", condition: c.id }, `Changed to “${c.label}”`)}
                  className={`pressable flex min-h-12 w-full items-center justify-between rounded-[var(--radius-control)] px-4 text-left text-[16px] ${
                    active
                      ? "bg-brand-soft font-bold text-brand"
                      : "bg-surface-subtle font-semibold text-ink hover:bg-surface-muted"
                  }`}
                >
                  {c.label}
                  {active && <Check className="h-5 w-5" strokeWidth={2.6} />}
                </button>
              );
            })}
          </div>
        </Disclosure>
      )}
    </div>
  );
}

export function ParcelDetailSheet({
  parcelId,
  onClose,
  onChanged,
}: {
  parcelId: string | null;
  onClose: () => void;
  /** Called after an owner action so the list behind can refresh. */
  onChanged?: () => void;
}) {
  return (
    <Sheet open={parcelId !== null} onClose={onClose} title="Parcel">
      <ParcelDetailBody parcelId={parcelId} onChanged={onChanged} />
    </Sheet>
  );
}

export function ParcelDetailPanel({
  parcelId,
  onClose,
  onChanged,
}: {
  parcelId: string;
  onClose: () => void;
  onChanged?: () => void;
}) {
  return (
    <div>
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 bg-surface px-5 pb-2 pt-4">
        <h2 className="text-[20px] font-extrabold tracking-[-0.01em] text-ink">Parcel</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close details"
          className="pressable -mr-1.5 flex h-11 w-11 items-center justify-center rounded-full text-ink-3 hover:bg-surface-muted"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-muted">
            <X className="h-4 w-4" strokeWidth={2.6} />
          </span>
        </button>
      </div>
      <div className="px-5 pb-6">
        <ParcelDetailBody parcelId={parcelId} onChanged={onChanged} />
      </div>
    </div>
  );
}
