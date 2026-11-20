"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  FileText,
  Package,
  X,
} from "lucide-react";

interface ParcelEvent {
  id: string;
  source: string;
  rawStatus: string;
  description: string | null;
  eventTimestamp: string;
}

interface ParcelScan {
  id: string;
  scannedBarcode: string;
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
  returnSn: string | null;
  forwardTrackingNumber: string | null;
  rtsTrackingNumber: string | null;
  courier: string;
  category: "FAILED_DELIVERY" | "RETURN_REFUND";
  digitalStatus: string;
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
  disputeDeadlineAt: string | null;
  disputeDraft: string | null;
  isMissingDiscrepancy: boolean;
  events: ParcelEvent[];
  scans: ParcelScan[];
}

function fmtManila(iso: string | null): string {
  if (!iso) return "Not yet";
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
}

function conditionText(cond: string | null): string {
  switch (cond) {
    case "GOOD_RESTOCKABLE":
      return "Good (Ready to Restock)";
    case "DAMAGED_PACKAGING":
      return "Torn Pouch (Item Clean)";
    case "DAMAGED_ITEM":
      return "Damaged Item";
    case "WRONG_OR_SWAPPED_ITEM":
      return "Wrong / Swapped Item";
    case "MISSING_PIECE":
      return "Missing Piece";
    default:
      return "Not scanned yet";
  }
}

export function ParcelDetailSheet({
  parcelId,
  onClose,
}: {
  parcelId: string | null;
  onClose: () => void;
}) {
  const [parcel, setParcel] = useState<ParcelDetailData | null>(null);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!parcelId) {
      setParcel(null);
      setDraft(null);
      return;
    }
    let active = true;
    setLoading(true);
    fetch(`/api/returns/${parcelId}`)
      .then((r) => r.json())
      .then((d) => {
        if (!active) return;
        setParcel(d.parcel ?? null);
        setDraft(d.parcel?.disputeDraft ?? null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [parcelId]);

  if (!parcelId) return null;

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
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/45 md:items-center md:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Parcel details"
        className="flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl md:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3.5">
          <h2 className="text-base font-bold text-slate-900">Parcel Details</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close details"
            className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {loading || !parcel ? (
            <div className="space-y-3">
              <div className="h-16 animate-pulse rounded-xl bg-slate-100" />
              <div className="h-24 animate-pulse rounded-xl bg-slate-100" />
              <div className="h-24 animate-pulse rounded-xl bg-slate-100" />
            </div>
          ) : (
            <div className="space-y-5">
              {/* Garment identity */}
              <div className="flex items-start gap-3.5">
                {parcel.itemImageUrl ? (
                  <img
                    src={parcel.itemImageUrl}
                    alt={parcel.itemSummary}
                    className="h-16 w-16 shrink-0 rounded-xl border border-slate-200 object-cover"
                  />
                ) : (
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
                    <Package className="h-7 w-7" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
                        parcel.category === "FAILED_DELIVERY"
                          ? "bg-amber-100 text-amber-800"
                          : "bg-blue-100 text-blue-800"
                      }`}
                    >
                      {parcel.category === "FAILED_DELIVERY"
                        ? "Failed Delivery"
                        : "Buyer Return / Refund"}
                    </span>
                    <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700">
                      {parcel.platform === "SHOPEE" ? "Shopee" : "TikTok Shop"}
                    </span>
                  </div>
                  <p className="mt-1.5 text-base font-bold text-slate-900">
                    {parcel.quantity}× {parcel.itemSummary}
                  </p>
                  {parcel.variationName && (
                    <p className="text-sm font-medium text-slate-600">{parcel.variationName}</p>
                  )}
                </div>
              </div>

              {/* Missing discrepancy callout */}
              {parcel.isMissingDiscrepancy && (
                <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-3.5 text-red-900">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
                  <div className="text-sm">
                    <p className="font-bold">Missing at Warehouse</p>
                    <p className="mt-0.5 text-red-800">
                      {parcel.courier} marked this parcel returned on{" "}
                      {fmtManila(parcel.courierReturnedToSellerAt)}, but your staff has not
                      scanned it yet.
                    </p>
                  </div>
                </div>
              )}

              {/* 3 Manila-time stages */}
              <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-slate-50/70">
                <div className="flex items-center justify-between px-3.5 py-3 text-sm">
                  <span className="font-medium text-slate-600">
                    1. {parcel.category === "FAILED_DELIVERY" ? "Driver Tagged" : "Buyer Requested"}
                  </span>
                  <span className="tabular-nums font-bold text-slate-900">
                    {fmtManila(parcel.digitalReturnTaggedAt)}
                  </span>
                </div>
                <div className="flex items-center justify-between px-3.5 py-3 text-sm">
                  <span className="font-medium text-slate-600">2. Driver Marked Returned</span>
                  <span className="tabular-nums font-bold text-slate-900">
                    {fmtManila(parcel.courierReturnedToSellerAt)}
                  </span>
                </div>
                <div className="flex items-center justify-between px-3.5 py-3 text-sm">
                  <span className="font-medium text-slate-600">3. Scanned at Warehouse</span>
                  <span
                    className={`tabular-nums inline-flex items-center gap-1.5 font-bold ${
                      parcel.physicallyReceivedAt ? "text-emerald-700" : "text-red-700"
                    }`}
                  >
                    {parcel.physicallyReceivedAt ? (
                      <CheckCircle2 className="h-4 w-4" />
                    ) : (
                      <Clock className="h-4 w-4" />
                    )}
                    {fmtManila(parcel.physicallyReceivedAt)}
                  </span>
                </div>
              </div>

              {/* Order & Tracking Info */}
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-slate-200 pt-4 text-sm">
                <div>
                  <dt className="text-xs font-semibold text-slate-500">Order ID</dt>
                  <dd className="tabular-nums mt-0.5 break-all font-semibold text-slate-900">
                    {parcel.orderSn}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold text-slate-500">Courier</dt>
                  <dd className="mt-0.5 font-semibold text-slate-900">{parcel.courier}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold text-slate-500">Tracking Number</dt>
                  <dd className="tabular-nums mt-0.5 break-all font-semibold text-slate-900">
                    {parcel.rtsTrackingNumber || parcel.forwardTrackingNumber || "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold text-slate-500">Est. Cost / Order Value</dt>
                  <dd className="tabular-nums mt-0.5 font-semibold text-slate-900">
                    ₱{parcel.estimatedUnitCostPhp.toLocaleString("en-PH")} / ₱
                    {parcel.orderTotalPhp.toLocaleString("en-PH")}
                  </dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-xs font-semibold text-slate-500">Reason</dt>
                  <dd className="mt-0.5 font-medium text-slate-800">
                    {parcel.returnReason || "No reason provided"}
                  </dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-xs font-semibold text-slate-500">Warehouse Inspection</dt>
                  <dd className="mt-0.5 font-semibold text-slate-900">
                    {conditionText(parcel.physicalCondition)}
                    {parcel.scans[0]?.staffMember?.name
                      ? ` • Checked by ${parcel.scans[0].staffMember.name}`
                      : ""}
                  </dd>
                  {parcel.scans[0]?.notes && (
                    <p className="mt-1 text-sm text-slate-600">{parcel.scans[0].notes}</p>
                  )}
                </div>
              </dl>

              {/* Proof photos */}
              {parcel.scans.some((s) => s.photoUrls.length > 0) && (
                <div className="border-t border-slate-200 pt-4">
                  <h3 className="text-sm font-bold text-slate-900">Warehouse Proof Photos</h3>
                  <div className="mt-2.5 grid grid-cols-3 gap-2">
                    {parcel.scans.flatMap((s) =>
                      s.photoUrls.map((url) => (
                        <a
                          key={url}
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="block overflow-hidden rounded-lg border border-slate-200"
                        >
                          <img
                            src={url}
                            alt="Warehouse return proof"
                            className="h-24 w-full object-cover"
                          />
                        </a>
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* 1-click Dispute Appeal Generator */}
              <div className="border-t border-slate-200 pt-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-bold text-slate-900">Dispute Message</h3>
                  <button
                    type="button"
                    onClick={handleGenerateDraft}
                    disabled={drafting}
                    className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-[#0f766e] px-3.5 text-sm font-bold text-white transition-colors hover:bg-[#115e59] disabled:opacity-60"
                  >
                    <FileText className="h-4 w-4" />
                    {drafting ? "Preparing..." : draft ? "Refresh Draft" : "Create Dispute Draft"}
                  </button>
                </div>

                {draft && (
                  <div className="mt-3 space-y-2.5">
                    <textarea
                      readOnly
                      rows={8}
                      value={draft}
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-800"
                    />
                    <button
                      type="button"
                      onClick={handleCopy}
                      className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white text-sm font-bold text-slate-900 hover:bg-slate-50"
                    >
                      {copied ? (
                        <>
                          <Check className="h-4 w-4 text-emerald-600" />
                          Copied to Clipboard
                        </>
                      ) : (
                        <>
                          <Copy className="h-4 w-4" />
                          Copy Message for{" "}
                          {parcel.platform === "SHOPEE" ? "Shopee" : "TikTok Shop"}
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
