import type { Platform, ShopConnection } from "@prisma/client";
import type { TokenSet } from "@/lib/connectors/tokens";
import type { FinanceFigures } from "@/lib/finance/map";
import type { NormalizedOrder } from "@/lib/ledger/normalize";
import type { SyncWindow } from "@/lib/ledger/window";
import type { PushCandidate } from "@/lib/stock/rules";

export interface StockPushResult {
  ok: string[];
  failed: Array<{ id: string; error: string }>;
}

export interface PricePushCandidate {
  listingVariantId: string;
  platform: Platform;
  shopConnectionId: string;
  listingId: string;
  variationId: string;
  pricePhp: number;
  currency?: string;
}

export type PricePushResult = StockPushResult;

export interface ListingDraftInput {
  title: string;
  description: string;
  categoryId: string;
  pricePhp: number;
  stock: number;
  imageUrls: string[];
  variants: Array<{
    label: string;
    pricePhp: number;
    stock: number;
  }>;
}

export interface ListingDraftResult {
  externalListingId: string;
  status: string;
}

export interface ListingTierInput {
  name: string;
  options: string[];
}

export interface ListingVariantInput {
  garmentVariantId: string;
  label: string;
  tierValues: string[];
  skuCode?: string | null;
  pricePhp: number;
  stock: number;
}

export interface CreateListingInput {
  title: string;
  description: string;
  categoryId: string;
  publishMode: "DRAFT" | "LIVE";
  weightKg: number;
  dimensionsCm?: { length: number; width: number; height: number } | null;
  pricePhp: number;
  stock: number;
  imageUrls: string[];
  tiers: ListingTierInput[];
  variants: ListingVariantInput[];
  /** When retrying Shopee after add_item already succeeded, resume init_tier_variation only. */
  existingExternalListingId?: string | null;
}

export interface CreatedListingSku {
  garmentVariantId: string;
  variationId: string;
  variationName: string | null;
  warehouseId?: string | null;
  pricePhp: number;
  stock: number;
}

export interface CreateListingResult {
  externalListingId: string;
  status: string;
  skus: CreatedListingSku[];
  remoteImageUrls: string[];
  /** Set when parent item was created before a later step (e.g. variations) failed. */
  partialError?: string;
}

export interface ChannelCategoryOption {
  id: string;
  name: string;
  path: string;
  isLeaf: boolean;
}

/**
 * Unified marketplace channel boundary (orders, finance, stock push, tokens, Phase 5 listings/prices).
 * Adding a future channel (e.g. Lazada or Shopify) implements this contract and
 * registers it in `src/lib/channels/registry.ts`.
 */
export interface ChannelConnector {
  readonly platform: Platform;
  readonly label: string;
  /** True when `fetchOrdersWindow` yields orders sorted by update time ascending and can resume mid-window. */
  readonly canResumeOrderWindow: boolean;
  isConfigured(): boolean;
  refreshTokens(refreshToken: string, shopId: string, now?: Date): Promise<TokenSet>;
  fetchSingleOrder(shop: ShopConnection, token: string, orderSn: string): Promise<NormalizedOrder | null>;
  fetchOrdersWindow(
    shop: ShopConnection,
    token: string,
    window: SyncWindow,
    checkDeadline: () => void
  ): AsyncGenerator<NormalizedOrder[]>;
  fetchOrderFinance(shop: ShopConnection, token: string, orderSn: string): Promise<FinanceFigures | null>;
  pushListingStock(shop: ShopConnection, token: string, rows: PushCandidate[]): Promise<StockPushResult>;
  pushListingPrices(shop: ShopConnection, token: string, rows: PricePushCandidate[]): Promise<PricePushResult>;
  createDraftListing(shop: ShopConnection, token: string, draft: ListingDraftInput): Promise<ListingDraftResult>;
  createListing(shop: ShopConnection, token: string, input: CreateListingInput): Promise<CreateListingResult>;
  fetchCategories(shop: ShopConnection, token: string): Promise<ChannelCategoryOption[]>;
}
