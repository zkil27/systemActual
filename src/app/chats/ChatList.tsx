"use client";

import Link from "next/link";
import { MessageCircle, MessageSquarePlus } from "lucide-react";
import { Button, Group } from "@/components/ui/Button";
import { chatListTime, platformName, shopParam } from "@/lib/chats/format";
import type { ChatListItem, ChatPlatform } from "@/lib/chats/types";
import { BuyerAvatar } from "./BuyerAvatar";

export function ChatList({
  platform,
  items,
  error,
  selectedId,
  sample,
  hasMore,
  loadingMore,
  onLoadMore,
  testing,
  onTestMessage,
}: {
  platform: ChatPlatform;
  items: ChatListItem[] | null;
  error: string | null;
  selectedId: string | null;
  sample: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  testing: boolean;
  onTestMessage: () => void;
}) {
  if (items === null) {
    if (error) {
      return (
        <p role="alert" className="anim-fade-in px-1 py-6 text-[15px] font-semibold text-missing-ink">
          {error}
        </p>
      );
    }
    return <ListSkeleton />;
  }

  const shop = platformName(platform);

  return (
    <div className="space-y-4">
      {error && (
        <p role="alert" className="anim-fade-in px-1 text-[15px] font-semibold text-missing-ink">
          {error}
        </p>
      )}

      {items.length === 0 ? (
        <Group className="flex flex-col items-center gap-3 px-6 py-10 text-center">
          <MessageCircle className="h-9 w-9 text-ink-3/70" strokeWidth={1.6} />
          <p className="text-[17px] font-semibold text-ink">No chats yet</p>
          <p className="max-w-xs text-[15px] text-ink-3">
            {sample ? (
              <>
                Load the sample chats with{" "}
                <Link href="/imports" className="font-semibold text-brand">
                  Refresh sample data
                </Link>
                .
              </>
            ) : (
              `When buyers message your ${shop} shop, their chats show up here.`
            )}
          </p>
        </Group>
      ) : (
        <Group>
          <ul className="divide-y divide-hairline">
            {items.map((c) => {
              const unread = c.unreadCount > 0;
              const active = c.id === selectedId;
              return (
                <li key={c.id}>
                  <Link
                    href={`/chats/${encodeURIComponent(c.id)}?shop=${shopParam(c.platform)}`}
                    scroll={false}
                    aria-current={active ? "page" : undefined}
                    aria-label={`${c.buyerName}${unread ? `, ${c.unreadCount} unread` : ""}: ${c.preview}`}
                    className={`pressable-row flex min-h-[72px] items-center gap-3 px-4 py-3 ${
                      active ? "bg-brand-soft" : "hover:bg-surface-subtle active:bg-surface-muted"
                    }`}
                  >
                    <BuyerAvatar name={c.buyerName} src={c.buyerAvatarUrl} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-3">
                        <p className={`truncate text-[16px] text-ink ${unread ? "font-bold" : "font-semibold"}`}>
                          {c.buyerName}
                        </p>
                        <span
                          className={`tabular-nums shrink-0 text-[13px] ${unread ? "font-bold text-brand" : "text-ink-3"}`}
                        >
                          {chatListTime(c.lastMessageAt)}
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-center justify-between gap-3">
                        <p className={`truncate text-[15px] ${unread ? "text-ink" : "text-ink-3"}`}>{c.preview}</p>
                        {unread && (
                          <span className="tabular-nums min-w-[22px] shrink-0 rounded-full bg-brand-solid px-1.5 py-[3px] text-center text-[12px] font-bold leading-none text-on-brand">
                            {c.unreadCount > 99 ? "99+" : c.unreadCount}
                          </span>
                        )}
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Group>
      )}

      {hasMore && (
        <Button variant="secondary" full onClick={onLoadMore} disabled={loadingMore}>
          {loadingMore ? "Loading…" : "Show older chats"}
        </Button>
      )}

      {sample && items.length > 0 && (
        <Group>
          <button
            type="button"
            onClick={onTestMessage}
            disabled={testing}
            className="pressable-row flex min-h-[52px] w-full items-center justify-between gap-4 px-4 text-left hover:bg-surface-subtle active:bg-surface-muted disabled:opacity-60"
          >
            <span className="min-w-0">
              <span className="block text-[17px] text-ink">{testing ? "Sending…" : "Send a test buyer message"}</span>
              <span className="block text-[13px] text-ink-3">Sample chats only. Nothing goes to {shop}.</span>
            </span>
            <MessageSquarePlus className="h-5 w-5 shrink-0 text-brand" />
          </button>
        </Group>
      )}
    </div>
  );
}

function ListSkeleton() {
  return (
    <Group>
      <div aria-busy="true" aria-label="Loading chats" className="divide-y divide-hairline">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex min-h-[72px] items-center gap-3 px-4 py-3">
            <div className="h-11 w-11 shrink-0 animate-pulse rounded-full bg-surface-muted" />
            <div className="flex-1 space-y-2">
              <div className="h-3.5 w-2/5 animate-pulse rounded-full bg-surface-muted" />
              <div className="h-3 w-4/5 animate-pulse rounded-full bg-surface-muted" />
            </div>
          </div>
        ))}
      </div>
    </Group>
  );
}
