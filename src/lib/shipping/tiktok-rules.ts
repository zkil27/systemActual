import { MIN_ORDER_AGE_MS } from "@/lib/waves/plan";
import type { ShipDecision } from "./shopee-rules";

/**
 * Pure rules for shipping TikTok packages.
 *
 * TikTok flow: Get Package Handover Time Slots → Batch Ship Packages
 * (handover_method PICKUP; a code-0 reply can still list per-package errors) →
 * Get Package Shipping Document (SHIPPING_LABEL, A6), which returns the label
 * URL and the tracking number together.
 */
export { MAX_ATTEMPTS } from "./shopee-rules";
export const RETRY_MS = 60_000;
export const SLOT_RETRY_MS = 5 * 60_000;
export const LABEL_POLL_MS = 30_000;
export const TRACKING_GIVE_UP_MS = 2 * 3600_000;
export const LABEL_SIZE = "A6";

/** Package statuses meaning shipment is already arranged. */
const ARRANGED_PACKAGE = new Set(["PROCESSING", "FULFILLING", "COMPLETED"]);
const ARRANGED_ORDER = new Set(["AWAITING_COLLECTION", "IN_TRANSIT", "DELIVERED", "COMPLETED"]);

/** Same contract as Shopee: decide from a freshly re-fetched order. */
export function tiktokShipDecision(
  order: { status: string; cancelRequested: boolean; platformCreatedAt: Date },
  pkg: { status: string | null },
  shipRequested: boolean,
  now: Date
): ShipDecision {
  const s = order.status.toUpperCase();
  const p = (pkg.status ?? "").toUpperCase();
  if (order.cancelRequested || s === "CANCELLED" || p === "CANCELLED") return { kind: "cancelled" };

  if (ARRANGED_ORDER.has(s) || ARRANGED_PACKAGE.has(p)) {
    return shipRequested
      ? { kind: "arranged" }
      : { kind: "failed", reason: "Shipment was arranged outside Kyna Ops. Print this label from Seller Center." };
  }
  if (s === "AWAITING_SHIPMENT" && (!p || p === "TO_FULFILL")) {
    if (now.getTime() - order.platformCreatedAt.getTime() < MIN_ORDER_AGE_MS) {
      return { kind: "wait", reason: "Order is less than 1 hour old" };
    }
    return { kind: "ship" };
  }
  return { kind: "failed", reason: `Order is ${s.toLowerCase().replace(/_/g, " ")}` };
}

type Raw = Record<string, unknown>;
const arr = (v: unknown): Raw[] => (Array.isArray(v) ? (v as Raw[]) : []);

export type TikTokPickupChoice =
  | { ok: true; slot: { start_time: number; end_time: number } | null }
  | { ok: false; retry: boolean; reason: string };

/** Earliest bookable pickup slot that hasn't ended. No slots + pickup allowed = courier picks the time. */
export function chooseTikTokPickup(data: Raw | null | undefined, now: Date): TikTokPickupChoice {
  if (data?.can_pickup === false) {
    return { ok: false, retry: false, reason: "TikTok doesn't offer pickup for this courier. Arrange drop-off in Seller Center." };
  }
  const all = arr(data?.pickup_slots);
  const nowSec = Math.floor(now.getTime() / 1000);
  const open = all
    // TikTok spells it "avaliable" in the API.
    .filter((s) => s.avaliable !== false && s.available !== false && Number(s.end_time) > nowSec)
    .sort((a, b) => Number(a.start_time) - Number(b.start_time));
  if (open.length) return { ok: true, slot: { start_time: Number(open[0].start_time), end_time: Number(open[0].end_time) } };
  if (all.length) return { ok: false, retry: true, reason: "No pickup time open right now." };
  return { ok: true, slot: null };
}

export type TikTokHandoverChoice =
  | { ok: true; handoverMethod: "PICKUP" | "DROP_OFF"; slot: { start_time: number; end_time: number } | null }
  | { ok: false; retry: boolean; reason: string };

/**
 * Picks earliest pickup slot, or falls back to DROP_OFF when TikTok does not
 * allow pickup for this courier channel.
 */
export function chooseTikTokHandover(data: Raw | null | undefined, now: Date): TikTokHandoverChoice {
  const pickup = chooseTikTokPickup(data, now);
  if (pickup.ok) return { ok: true, handoverMethod: "PICKUP", slot: pickup.slot };
  if (data?.can_pickup === false && data?.can_drop_off === true) {
    return { ok: true, handoverMethod: "DROP_OFF", slot: null };
  }
  return pickup;
}

const errorText = (e: Raw) => String(e.message || `TikTok error ${e.code ?? ""}`.trim());

/**
 * Batch Ship Packages errors. `byPackage`: package id → reason.
 * `unattributed`: errors with no package id. If there are any, nobody in the
 * batch can be assumed shipped OR not shipped: re-check them all.
 */
export function tiktokShipErrors(data: Raw | null | undefined): { byPackage: Map<string, string>; unattributed: string[] } {
  const errors = arr(data?.errors);
  return {
    byPackage: new Map(
      errors
        .filter((e) => (e.detail as Raw | undefined)?.package_id)
        .map((e) => [String((e.detail as Raw).package_id), errorText(e)])
    ),
    unattributed: errors.filter((e) => !(e.detail as Raw | undefined)?.package_id).map(errorText),
  };
}

/** Get Package Shipping Document: label URL (valid 24 h) and tracking number. */
export function tiktokLabel(data: Raw | null | undefined): { url: string | null; trackingNumber: string | null } {
  const url = typeof data?.doc_url === "string" && data.doc_url.startsWith("https://") ? data.doc_url : null;
  const tn = typeof data?.tracking_number === "string" && data.tracking_number.trim() ? data.tracking_number.trim() : null;
  return { url, trackingNumber: tn };
}
