/**
 * Return payloads shaped like the documented Shopee v2.returns and TikTok
 * 202309 return_refund responses. Replace with redacted live captures at cutover.
 */
const base = {
  order_sn: "251118AAAA0001",
  create_time: 1795000000,
  update_time: 1795100000,
  due_date: 1795300000,
  refund_amount: 199,
  item: [{ item_id: 9001, model_id: 77, name: "Ribbed Top", amount: 1, images: ["https://cf.shopee.ph/file/ribbed-black"] }],
};

/** Buyer refused at the door; rider raised the request. */
export const shopeeReturnOnTheSpot = {
  ...base,
  return_sn: "RS-ROS-1",
  status: "REQUESTED",
  return_refund_request_type: 2,
  return_solution: 0,
  reason: "CHANGE_MIND",
};

export const shopeeNormalReturn = {
  ...base,
  order_sn: "251110BBBB0002",
  return_sn: "RS-NORMAL-1",
  status: "PROCESSING",
  return_refund_request_type: 0,
  return_solution: 0,
  reason: "WRONG_ITEM",
  text_reason: "Received the wrong colour",
  tracking_number: "SPXRET000111",
};

export const shopeeInTransitReturn = {
  ...base,
  order_sn: "251117CCCC0003",
  return_sn: "RS-TRANSIT-1",
  status: "ACCEPTED",
  return_refund_request_type: 1,
  return_solution: 0,
  reason: "CHANGE_MIND",
};

export const shopeeRefundOnly = {
  ...base,
  order_sn: "251112DDDD0004",
  return_sn: "RS-REFUND-1",
  status: "REFUND_PAID",
  return_refund_request_type: 0,
  return_solution: 1,
  reason: "ITEM_MISSING",
};

export const shopeeReverseDelivered = {
  validation_type: "seller_validation",
  reverse_logistics_status: "LOGISTICS_DELIVERY_DONE",
  reverse_logistics_update_time: 1795200000,
  tracking_number: "SPXRET000222",
};

export const shopeeReverseWarehouse = {
  validation_type: "warehouse_validation",
  reverse_logistics_status: "LOGISTICS_DELIVERY_DONE", // buyer → warehouse leg only
  tracking_number: "SPXRET-TO-WH",
  post_return_logistics_status: "LOGISTICS_PICKUP_DONE", // warehouse → seller still on the way
  rts_tracking_number: "SPXRTS-TO-SELLER",
};

const tiktokLine = {
  product_id: "1729582718312380123",
  sku_id: "2729382476852921560",
  product_name: "Ribbed Top",
  sku_name: "Black, M",
  product_image: { url: "https://p16.tiktokcdn.com/ribbed-black" },
};

export const tiktokReturnAndRefund = {
  return_id: "4035-RET-1",
  order_id: "577086512123755123",
  return_type: "RETURN_AND_REFUND",
  return_status: "BUYER_SHIPPED_ITEM",
  return_reason_text: "Size too small",
  return_tracking_number: "JTRET0001",
  return_provider_name: "J&T Express",
  create_time: 1795000000,
  update_time: 1795100000,
  refund_amount: { refund_total: "398.00" },
  return_line_items: [tiktokLine, tiktokLine],
};

export const tiktokRefundOnly = {
  ...tiktokReturnAndRefund,
  return_id: "4035-RET-2",
  return_type: "REFUND",
  return_status: "RETURN_OR_REFUND_REQUEST_COMPLETE",
  return_tracking_number: undefined,
  return_line_items: [tiktokLine],
};
