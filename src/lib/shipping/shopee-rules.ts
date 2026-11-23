import { MIN_ORDER_AGE_MS } from "@/lib/waves/plan";

/**
 * Pure rules for shipping Shopee packages. Everything that decides "ship this
 * now?" lives here so it can be tested without a shop.
 *
 * Shopee flow: get_mass_shipping_parameter → mass_ship_order (≤50 packages,
 * one logistics channel) → get_mass_tracking_number (may be empty for a
 * while) → create_shipping_document → get_shipping_document_result (READY) →
 * download_shipping_document (when the PC prints it).
 */
export const SHIP_BATCH = 50;
export const MAX_ATTEMPTS = 5;
export const RETRY_MS = 60_000;
export const SLOT_RETRY_MS = 5 * 60_000;
export const TRACKING_GIVE_UP_MS = 2 * 3600_000;
export const DOC_POLL_MS = 20_000;
export const DOC_TYPE = "THERMAL_AIR_WAYBILL";

/** Package statuses meaning shipment is already arranged. Confirm with live data. */
const ARRANGED_PACKAGE = new Set(["LOGISTICS_REQUEST_CREATED", "LOGISTICS_PICKUP_DONE", "LOGISTICS_DELIVERY_DONE"]);
const ARRANGED_ORDER = new Set(["PROCESSED", "SHIPPED", "TO_CONFIRM_RECEIVE", "COMPLETED"]);
const READY_ORDER = new Set(["READY_TO_SHIP", "RETRY_SHIP"]);

export type ShipDecision =
  | { kind: "ship" }
  | { kind: "arranged" }
  | { kind: "cancelled" }
  | { kind: "wait"; reason: string }
  | { kind: "failed"; reason: string };

/**
 * Decide from a FRESH copy of the order (re-fetched seconds ago).
 * `shipRequested` = we asked Shopee to arrange it before (maybe it worked).
 */
export function shopeeShipDecision(
  order: { status: string; cancelRequested: boolean; platformCreatedAt: Date },
  pkg: { status: string | null },
  shipRequested: boolean,
  now: Date,
  opts?: { includeNewOrders?: boolean }
): ShipDecision {
  const s = order.status.toUpperCase();
  const p = (pkg.status ?? "").toUpperCase();
  if (order.cancelRequested || s === "CANCELLED" || s === "IN_CANCEL") return { kind: "cancelled" };

  if (ARRANGED_ORDER.has(s) || ARRANGED_PACKAGE.has(p)) {
    // We asked and it's now arranged: that was us (the reply was lost). Carry on to the label.
    // We never asked: someone else arranged it (BigSeller, Seller Center). Don't print a second label.
    return shipRequested
      ? { kind: "arranged" }
      : { kind: "failed", reason: "Shipment was arranged outside Kyna Ops. Print this label from Seller Center." };
  }
  if (READY_ORDER.has(s)) {
    if (!opts?.includeNewOrders && now.getTime() - order.platformCreatedAt.getTime() < MIN_ORDER_AGE_MS) {
      return { kind: "wait", reason: "Order is less than 1 hour old" };
    }
    return { kind: "ship" };
  }
  return { kind: "failed", reason: `Order is ${s.toLowerCase().replace(/_/g, " ")}` };
}

type Raw = Record<string, unknown>;
const arr = (v: unknown): Raw[] => (Array.isArray(v) ? (v as Raw[]) : []);

export type PickupChoice =
  | { ok: true; pickup: { address_id: number; pickup_time_id?: string }; dropoff?: never }
  | { ok: true; dropoff: Record<string, unknown>; pickup?: never }
  | { ok: false; retry: boolean; reason: string };

/**
 * Pickup address and earliest slot from get_mass_shipping_parameter, with
 * automatic fallback to drop-off when the courier channel requires drop-off
 * and needs no manual branch picker.
 */
export function choosePickup(resp: Raw | null | undefined): PickupChoice {
  const needed = (resp?.info_needed ?? {}) as Raw;
  if (!("pickup" in needed)) {
    if ("dropoff" in needed) {
      const dropoffNeeds = (Array.isArray(needed.dropoff) ? needed.dropoff : []).map(String);
      const branches = arr((resp?.dropoff as Raw | undefined)?.branch_list);
      if (dropoffNeeds.includes("branch_id") && !branches.length) {
        return {
          ok: false,
          retry: false,
          reason: "This courier needs drop-off, not pickup. Arrange it in Seller Center.",
        };
      }
      return {
        ok: true,
        dropoff: branches.length ? { branch_id: Number(branches[0].branch_id) } : {},
      };
    }
    return {
      ok: false,
      retry: false,
      reason: "Shopee didn't offer pickup for this courier.",
    };
  }
  const needs = (Array.isArray(needed.pickup) ? needed.pickup : []).map(String);
  const addresses = arr((resp?.pickup as Raw | undefined)?.address_list);
  const address =
    addresses.find((a) => (Array.isArray(a.address_flag) ? a.address_flag.map(String) : []).includes("pickup_address")) ??
    addresses[0];

  if (!address) {
    return needs.includes("address_id")
      ? { ok: false, retry: false, reason: "No pickup address. Set one in Shopee Seller Center." }
      : { ok: false, retry: false, reason: "Shopee didn't return a pickup address." };
  }

  const slots = arr(address.time_slot_list)
    .filter((t) => t.pickup_time_id !== undefined && t.pickup_time_id !== null && t.pickup_time_id !== "")
    .sort((a, b) => Number(a.date ?? 0) - Number(b.date ?? 0));
  if (needs.includes("pickup_time_id") && !slots.length) {
    return { ok: false, retry: true, reason: "No pickup time offered yet." };
  }
  return {
    ok: true,
    pickup: {
      address_id: Number(address.address_id),
      ...(slots.length ? { pickup_time_id: String(slots[0].pickup_time_id) } : {}),
    },
  };
}

export interface PackageResults {
  ok: Set<string>;
  failed: Map<string, string>;
  /** In neither list: outcome unknown, treat as "maybe done" and re-check. */
  unknown: string[];
}

/** success_list / fail_list of a mass_* call. */
export function splitPackageResults(packageNumbers: string[], resp: Raw | null | undefined): PackageResults {
  const ok = new Set(arr(resp?.success_list).map((s) => String(s.package_number)));
  const failed = new Map(
    arr(resp?.fail_list).map((f) => [String(f.package_number), String(f.fail_reason || f.fail_error || "Rejected by Shopee")])
  );
  return { ok, failed, unknown: packageNumbers.filter((p) => !ok.has(p) && !failed.has(p)) };
}

/** get_mass_tracking_number: package → tracking number (empty means "not yet"). */
export function trackingNumbers(resp: Raw | null | undefined): Map<string, string> {
  return new Map(
    arr(resp?.success_list)
      .filter((s) => typeof s.tracking_number === "string" && s.tracking_number.trim())
      .map((s) => [String(s.package_number), String(s.tracking_number).trim()])
  );
}

/** create_shipping_document: packages Shopee refused. */
export function docCreateFailures(resp: Raw | null | undefined): Map<string, string> {
  return new Map(
    arr(resp?.result_list)
      .filter((r) => r.fail_error)
      .map((r) => [String(r.package_number), String(r.fail_message || r.fail_error)])
  );
}

/** get_shipping_document_result: READY / PROCESSING / FAILED per package. */
export function docStatuses(resp: Raw | null | undefined): Map<string, { status: string; error?: string }> {
  return new Map(
    arr(resp?.result_list).map((r) => [
      String(r.package_number),
      {
        status: r.fail_error ? "FAILED" : String(r.status ?? "PROCESSING").toUpperCase(),
        ...(r.fail_error ? { error: String(r.fail_message || r.fail_error) } : {}),
      },
    ])
  );
}
