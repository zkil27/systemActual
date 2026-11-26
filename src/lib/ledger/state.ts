import { OrderState, Platform } from "@prisma/client";

const STATUS_TO_STATE: Record<string, OrderState> = {
  UNPAID: OrderState.UNPAID,
  ON_HOLD: OrderState.UNPAID,
  READY_TO_SHIP: OrderState.READY_TO_SHIP,
  RETRY_SHIP: OrderState.READY_TO_SHIP,
  AWAITING_SHIPMENT: OrderState.READY_TO_SHIP,
  PROCESSED: OrderState.ARRANGED,
  AWAITING_COLLECTION: OrderState.ARRANGED,
  PARTIALLY_SHIPPING: OrderState.ARRANGED,
  IN_CANCEL: OrderState.IN_CANCEL,
  SHIPPED: OrderState.SHIPPED,
  IN_TRANSIT: OrderState.SHIPPED,
  TO_RETURN: OrderState.SHIPPED,
  TO_CONFIRM_RECEIVE: OrderState.DELIVERED,
  DELIVERED: OrderState.DELIVERED,
  COMPLETED: OrderState.COMPLETED,
  CANCELLED: OrderState.CANCELLED,
};

/**
 * Maps a raw marketplace order status string to the normalized `OrderState` enum.
 * `platform` is accepted so future channels (e.g. Lazada/Shopify) can override
 * platform-specific status codes without changing call sites.
 */
export function normalizeOrderState(
  platform: Platform,
  rawStatus: string | null | undefined
): OrderState {
  void platform;
  const key = (rawStatus ?? "").trim().toUpperCase();
  return STATUS_TO_STATE[key] ?? OrderState.UNKNOWN;
}

export const COMMITTED_ORDER_STATES: readonly OrderState[] = [
  OrderState.UNPAID,
  OrderState.READY_TO_SHIP,
  OrderState.ARRANGED,
  OrderState.IN_CANCEL,
];

export const READY_ORDER_STATES: readonly OrderState[] = [OrderState.READY_TO_SHIP];

export const FINAL_ORDER_STATES: readonly OrderState[] = [
  OrderState.COMPLETED,
  OrderState.CANCELLED,
];

export const DELIVERED_ORDER_STATES: readonly OrderState[] = [
  OrderState.DELIVERED,
  OrderState.COMPLETED,
];

export const CANCELLED_ORDER_STATES: readonly OrderState[] = [
  OrderState.CANCELLED,
  OrderState.IN_CANCEL,
];

const COMMITTED_SET = new Set<OrderState>(COMMITTED_ORDER_STATES);
const DELIVERED_SET = new Set<OrderState>(DELIVERED_ORDER_STATES);
const CANCELLED_SET = new Set<OrderState>(CANCELLED_ORDER_STATES);

export function isCommittedOrderState(state: OrderState): boolean {
  return COMMITTED_SET.has(state);
}

export function isDeliveredOrderState(state: OrderState): boolean {
  return DELIVERED_SET.has(state);
}

export function isCancelledOrderState(state: OrderState): boolean {
  return CANCELLED_SET.has(state);
}
