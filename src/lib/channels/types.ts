import type { Platform, ShopConnection } from "@prisma/client";
import type { TokenSet } from "@/lib/connectors/tokens";
import type { FinanceFigures } from "@/lib/finance/map";
import type { NormalizedOrder } from "@/lib/ledger/normalize";
import type { PushCandidate } from "@/lib/stock/rules";

export interface StockPushResult {
  ok: string[];
  failed: Array<{ id: string; error: string }>;
}

/**
 * Unified marketplace channel boundary (orders, finance, stock push, tokens).
 * Adding a future channel (e.g. Lazada or Shopify) implements this contract and
 * registers it in `src/lib/channels/registry.ts`.
 */
export interface ChannelConnector {
  readonly platform: Platform;
  readonly label: string;
  isConfigured(): boolean;
  refreshTokens(refreshToken: string, shopId: string, now?: Date): Promise<TokenSet>;
  fetchSingleOrder(shop: ShopConnection, token: string, orderSn: string): Promise<NormalizedOrder | null>;
  fetchOrderFinance(shop: ShopConnection, token: string, orderSn: string): Promise<FinanceFigures | null>;
  pushListingStock(shop: ShopConnection, token: string, rows: PushCandidate[]): Promise<StockPushResult>;
}
