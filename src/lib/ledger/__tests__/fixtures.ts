/**
 * Order payloads shaped like the documented API responses. Replace or extend
 * with redacted captures from the live shops during cutover (Task 14).
 */

/** v2.order.get_order_detail → order_list[0] */
export const shopeeCodOrder = {
  order_sn: "251121ABCD1234",
  order_status: "READY_TO_SHIP",
  create_time: 1795000000,
  update_time: 1795003600,
  cod: true,
  payment_method: "Cash on Delivery",
  total_amount: 398,
  shipping_carrier: "SPX Express",
  item_list: [
    {
      item_id: 9001,
      item_name: "Ribbed Top",
      model_id: 77,
      model_name: "Black,M",
      model_quantity_purchased: 1,
      model_original_price: 249,
      model_discounted_price: 199,
      image_info: { image_url: "https://cf.shopee.ph/file/ribbed-black" },
    },
    // same model listed twice (bundle deal) must merge into one line of qty 2
    {
      item_id: 9001,
      item_name: "Ribbed Top",
      model_id: 77,
      model_name: "Black,M",
      model_quantity_purchased: 1,
      model_original_price: 249,
      model_discounted_price: 199,
      image_info: { image_url: "https://cf.shopee.ph/file/ribbed-black" },
    },
  ],
  package_list: [
    { package_number: "OFG1001", logistics_status: "LOGISTICS_READY", shipping_carrier: "SPX Express", logistics_channel_id: 48002 },
  ],
};

export const shopeeCancelledAfterPickup = {
  order_sn: "251119ZZZZ9999",
  order_status: "CANCELLED",
  create_time: 1794800000,
  update_time: 1795100000,
  cod: true,
  total_amount: 199,
  cancel_by: "system",
  cancel_reason: "Failed Delivery",
  pickup_done_time: 1794850000,
  item_list: [
    { item_id: 9002, item_name: "Wide Leg Pants", model_id: 0, model_name: "", model_quantity_purchased: 1, model_discounted_price: 199 },
  ],
  package_list: [{ package_number: "OFG2002", logistics_status: "LOGISTICS_DELIVERY_FAILED" }],
};

/** /order/202309/orders/search → data.orders[0]; each line item is one unit. */
export const tiktokTwoUnitOrder = {
  id: "577086512123755123",
  status: "AWAITING_SHIPMENT",
  create_time: 1795000100,
  update_time: 1795000200,
  is_cod: true,
  payment: { total_amount: "398.00", currency: "PHP" },
  shipping_provider: "J&T Express",
  shipping_provider_id: "6617675021119438849",
  packages: [{ id: "1152321127278713123" }],
  line_items: [
    {
      id: "li-1",
      product_id: "1729582718312380123",
      sku_id: "2729382476852921560",
      product_name: "Ribbed Top",
      sku_name: "Black, M",
      sku_image: "https://p16.tiktokcdn.com/ribbed-black",
      sale_price: "199.00",
      package_id: "1152321127278713123",
      package_status: "TO_FULFILL",
      shipping_provider_name: "J&T Express",
    },
    {
      id: "li-2",
      product_id: "1729582718312380123",
      sku_id: "2729382476852921560",
      product_name: "Ribbed Top",
      sku_name: "Black, M",
      sku_image: "https://p16.tiktokcdn.com/ribbed-black",
      sale_price: "199.00",
      package_id: "1152321127278713123",
      package_status: "TO_FULFILL",
      shipping_provider_name: "J&T Express",
    },
  ],
};

export const tiktokCancelledAfterShip = {
  id: "577086512123700000",
  status: "CANCELLED",
  create_time: 1794800000,
  update_time: 1795100000,
  is_cod: true,
  cancellation_initiator: "SYSTEM",
  cancel_reason: "Package delivery failed",
  payment: { total_amount: "199.00" },
  line_items: [
    {
      id: "li-9",
      product_id: "1729582718312380999",
      sku_id: "2729382476852921999",
      product_name: "Wide Leg Pants",
      sku_name: "Beige, L",
      sale_price: "199.00",
      package_id: "1152321127278799999",
      package_status: "CANCELLED",
      tracking_number: "JT0012345678",
      rts_time: 1794850000,
    },
  ],
};
