-- Additive scale indexes for hot-path finance, dashboard, search, and prune queries.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Finance sync (saveFinance) and order lookup by orderSn
CREATE INDEX IF NOT EXISTS "WalletTransaction_platform_orderSn_idx"
  ON "WalletTransaction" ("platform", "orderSn");

-- 30-day courier and item return-rate analytics on Today dashboard
CREATE INDEX IF NOT EXISTS "Order_shippedAt_idx"
  ON "Order" ("shippedAt");

-- Order lookup and cancelled-label print-job lookups
CREATE INDEX IF NOT EXISTS "PrintJob_packageId_idx"
  ON "PrintJob" ("packageId");

CREATE INDEX IF NOT EXISTS "PrintJob_batchPackageIds_gin_idx"
  ON "PrintJob" USING GIN ("batchPackageIds");

-- Daily prune of 14-day ReturnEvent.rawPayloadJson payloads
CREATE INDEX IF NOT EXISTS "ReturnEvent_unpruned_payload_idx"
  ON "ReturnEvent" ("createdAt")
  WHERE "rawPayloadJson" IS NOT NULL;

-- Item/variation substring search in /api/orders and outbound packer fallback
CREATE INDEX IF NOT EXISTS "OrderLine_name_trgm_idx"
  ON "OrderLine" USING GIN ("name" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "OrderLine_variationName_trgm_idx"
  ON "OrderLine" USING GIN ("variationName" gin_trgm_ops);

-- Prefix lookup (sourceKey startsWith) in syncReturnRestock
CREATE INDEX IF NOT EXISTS "StockMovement_sourceKey_pattern_idx"
  ON "StockMovement" ("sourceKey" text_pattern_ops);
