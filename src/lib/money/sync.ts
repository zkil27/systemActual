import { Platform, Prisma, type ShopConnection } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { shopeeGet } from "@/lib/connectors/shopee";
import { tiktokRequest } from "@/lib/connectors/tiktok";
import { nextSyncWindow } from "@/lib/ledger/window";
import { mapShopeeWalletTransaction, mapTikTokStatement, type MoneyRow } from "./map";

/** Money doesn't need minute-by-minute freshness. */
export const MONEY_EVERY_MS = 15 * 60_000;
/** TikTok statements are re-read for this long so one that turns PAID is picked up. */
const TIKTOK_STATEMENT_LOOKBACK_MS = 14 * 24 * 3600_000;

const sec = (d: Date) => Math.floor(d.getTime() / 1000);

export function isMoneySyncDue(walletCheckedAt: Date | null, now: number): boolean {
  return !walletCheckedAt || now - walletCheckedAt.getTime() >= MONEY_EVERY_MS;
}

async function saveRows(conn: ShopConnection, rows: MoneyRow[]) {
  for (const r of rows) {
    const data = {
      kind: r.kind,
      rawType: r.rawType,
      amountPhp: new Prisma.Decimal(r.amountPhp.toFixed(2)),
      occurredAt: r.occurredAt,
      orderSn: r.orderSn,
    };
    await prisma.walletTransaction.upsert({
      where: { platform_externalId: { platform: conn.platform, externalId: r.externalId } },
      create: { shopConnectionId: conn.id, platform: conn.platform, externalId: r.externalId, ...data },
      update: data,
    });
  }
}

async function syncShopeeWalletWindow(
  conn: ShopConnection,
  token: string,
  from: Date,
  to: Date,
  deadline: number
): Promise<number> {
  let saved = 0;
  for (let pageNo = 0; ; pageNo++) {
    if (Date.now() >= deadline) return saved;
    const resp = await shopeeGet("/api/v2/payment/get_wallet_transaction_list", conn.shopId, token, {
      page_no: pageNo,
      page_size: 100,
      create_time_from: sec(from),
      create_time_to: sec(to),
    });
    const list: Record<string, unknown>[] = Array.isArray(resp?.transaction_list) ? resp.transaction_list : [];
    const rows = list.map(mapShopeeWalletTransaction).filter((r): r is MoneyRow => r !== null);
    await saveRows(conn, rows);
    saved += rows.length;
    if (!resp?.more || list.length === 0) return saved;
  }
}

async function syncShopeeWallet(conn: ShopConnection, token: string, deadline: number) {
  let cursor = conn.walletSyncedTo;
  let saved = 0;
  for (;;) {
    // Windows are 2 hours, well inside Shopee's 15-day limit for this call.
    const w = nextSyncWindow(cursor, new Date());
    saved += await syncShopeeWalletWindow(conn, token, w.from, w.to, deadline);
    if (Date.now() >= deadline) return saved;
    cursor = w.to;
    await prisma.shopConnection.update({ where: { id: conn.id }, data: { walletSyncedTo: cursor } });
    if (w.last) return saved;
  }
}

async function syncTikTokStatementsWindow(
  conn: ShopConnection,
  token: string,
  from: Date,
  to: Date | null,
  deadline: number
): Promise<number> {
  let pageToken = "";
  let saved = 0;
  for (;;) {
    if (Date.now() >= deadline) return saved;
    const data = await tiktokRequest({
      method: "GET",
      path: "/finance/202309/statements",
      accessToken: token,
      shopCipher: conn.shopCipher,
      query: {
        // Live sync omits statement_time_lt because TikTok truncates it to UTC midnight (exclusive),
        // which drops the current UTC day. Historical window sync passes +24h to cover `to`.
        statement_time_ge: String(sec(from)),
        ...(to ? { statement_time_lt: String(sec(new Date(to.getTime() + 24 * 3600_000))) } : {}),
        sort_field: "statement_time",
        sort_order: "DESC",
        page_size: "100",
        ...(pageToken ? { page_token: pageToken } : {}),
      },
    });
    const list: Record<string, unknown>[] = Array.isArray(data?.statements) ? data.statements : [];
    const rows = list.map(mapTikTokStatement).filter((r): r is MoneyRow => r !== null);
    await saveRows(conn, rows);
    saved += rows.length;
    if (!data?.next_page_token || list.length === 0) return saved;
    pageToken = String(data.next_page_token);
  }
}

async function syncTikTokStatements(conn: ShopConnection, token: string, deadline: number) {
  const from = new Date(Date.now() - TIKTOK_STATEMENT_LOOKBACK_MS);
  return syncTikTokStatementsWindow(conn, token, from, null, deadline);
}

/** Pulls credited money for a specific `[from, to)` window without moving incremental cursors. */
export async function syncMoneyWindow(
  conn: ShopConnection,
  token: string,
  from: Date,
  to: Date,
  deadline: number
): Promise<{ saved: number }> {
  const saved =
    conn.platform === Platform.SHOPEE
      ? await syncShopeeWalletWindow(conn, token, from, to, deadline)
      : await syncTikTokStatementsWindow(conn, token, from, to, deadline);
  return { saved };
}

/** Pulls credited money for one shop, at most every 15 minutes. */
export async function syncMoney(conn: ShopConnection, token: string, deadline: number) {
  if (!isMoneySyncDue(conn.walletCheckedAt, Date.now())) return { saved: 0, skipped: true };
  const saved =
    conn.platform === Platform.SHOPEE
      ? await syncShopeeWallet(conn, token, deadline)
      : await syncTikTokStatements(conn, token, deadline);
  if (Date.now() < deadline) {
    await prisma.shopConnection.update({ where: { id: conn.id }, data: { walletCheckedAt: new Date() } });
  }
  return { saved, skipped: false };
}
