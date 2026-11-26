-- 1. Normalized Order.state enum (nullable for additive compatibility with live main)
DO $$
BEGIN
  CREATE TYPE "OrderState" AS ENUM (
    'UNPAID',
    'READY_TO_SHIP',
    'ARRANGED',
    'IN_CANCEL',
    'SHIPPED',
    'DELIVERED',
    'COMPLETED',
    'CANCELLED',
    'UNKNOWN'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "state" "OrderState";

UPDATE "Order"
SET "state" = CASE UPPER(TRIM("status"))
  WHEN 'UNPAID' THEN 'UNPAID'::"OrderState"
  WHEN 'ON_HOLD' THEN 'UNPAID'::"OrderState"
  WHEN 'READY_TO_SHIP' THEN 'READY_TO_SHIP'::"OrderState"
  WHEN 'RETRY_SHIP' THEN 'READY_TO_SHIP'::"OrderState"
  WHEN 'AWAITING_SHIPMENT' THEN 'READY_TO_SHIP'::"OrderState"
  WHEN 'PROCESSED' THEN 'ARRANGED'::"OrderState"
  WHEN 'AWAITING_COLLECTION' THEN 'ARRANGED'::"OrderState"
  WHEN 'PARTIALLY_SHIPPING' THEN 'ARRANGED'::"OrderState"
  WHEN 'IN_CANCEL' THEN 'IN_CANCEL'::"OrderState"
  WHEN 'SHIPPED' THEN 'SHIPPED'::"OrderState"
  WHEN 'IN_TRANSIT' THEN 'SHIPPED'::"OrderState"
  WHEN 'TO_RETURN' THEN 'SHIPPED'::"OrderState"
  WHEN 'TO_CONFIRM_RECEIVE' THEN 'DELIVERED'::"OrderState"
  WHEN 'DELIVERED' THEN 'DELIVERED'::"OrderState"
  WHEN 'COMPLETED' THEN 'COMPLETED'::"OrderState"
  WHEN 'CANCELLED' THEN 'CANCELLED'::"OrderState"
  ELSE 'UNKNOWN'::"OrderState"
END
WHERE "state" IS NULL;

CREATE INDEX IF NOT EXISTS "Order_shopConnectionId_state_idx"
  ON "Order" ("shopConnectionId", "state");

-- 2. Cached onShelfCount on GarmentVariant kept exact by a trigger on StockMovement
ALTER TABLE "GarmentVariant"
  ADD COLUMN IF NOT EXISTS "onShelfCount" INTEGER NOT NULL DEFAULT 0;

UPDATE "GarmentVariant" AS gv
SET "onShelfCount" = COALESCE(
  (SELECT SUM(sm."delta")::INTEGER FROM "StockMovement" AS sm WHERE sm."garmentVariantId" = gv."id"),
  0
);

CREATE OR REPLACE FUNCTION sync_garment_variant_on_shelf()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE "GarmentVariant"
    SET "onShelfCount" = "onShelfCount" + NEW."delta"
    WHERE "id" = NEW."garmentVariantId";
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE "GarmentVariant"
    SET "onShelfCount" = "onShelfCount" - OLD."delta"
    WHERE "id" = OLD."garmentVariantId";
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD."garmentVariantId" = NEW."garmentVariantId" THEN
      IF OLD."delta" <> NEW."delta" THEN
        UPDATE "GarmentVariant"
        SET "onShelfCount" = "onShelfCount" + (NEW."delta" - OLD."delta")
        WHERE "id" = NEW."garmentVariantId";
      END IF;
    ELSE
      UPDATE "GarmentVariant"
      SET "onShelfCount" = "onShelfCount" - OLD."delta"
      WHERE "id" = OLD."garmentVariantId";
      UPDATE "GarmentVariant"
      SET "onShelfCount" = "onShelfCount" + NEW."delta"
      WHERE "id" = NEW."garmentVariantId";
    END IF;
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "StockMovement_sync_on_shelf_trg" ON "StockMovement";
CREATE TRIGGER "StockMovement_sync_on_shelf_trg"
AFTER INSERT OR UPDATE OR DELETE ON "StockMovement"
FOR EACH ROW
EXECUTE FUNCTION sync_garment_variant_on_shelf();
