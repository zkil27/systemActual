import type { EventHandler } from "./inbox";
import { processPendingChatReplies } from "@/lib/ai/auto-reply";
import { syncSingleOrder } from "@/lib/ledger/sync";
import { notifyCancelledPrintedOrder } from "@/lib/shipping/outbound";
import { syncAllTikTokChats } from "@/lib/chats/tiktok-sync";

/**
 * What one Shopee/TikTok push does: refresh the changed order (or TikTok
 * chats), and warn if a cancelled order's label was already printed.
 * Throws when the order refresh fails, so the inbox retries it.
 */
export const handleMarketplaceEvent: EventHandler = async (platform, f) => {
  if (f.isChat) {
    await syncAllTikTokChats(Date.now() + 50_000, 5_000);
    await processPendingChatReplies(Date.now() + 40_000).catch((err) =>
      console.error("[inbox] chat auto-reply", err)
    );
    return;
  }
  if (f.isCancel && f.orderSn) {
    await notifyCancelledPrintedOrder(platform, f.orderSn).catch((err) =>
      console.error("[inbox] cancel-pull alert", f.orderSn, err)
    );
  }
  if (f.orderSn) {
    await syncSingleOrder(platform, f.orderSn, f.shopExternalId ?? undefined);
  }
};
