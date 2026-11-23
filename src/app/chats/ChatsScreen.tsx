"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { MessageCircle } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { toast } from "@/components/ui/Toast";
import { timeoutSignal } from "@/lib/chats/client";
import { defaultShop, parseShopParam, platformName, shopParam } from "@/lib/chats/format";
import type { ChatListItem, ChatPlatform, ChatUnread } from "@/lib/chats/types";
import { ChatList } from "./ChatList";
import { ChatThreadView } from "./ChatThreadView";

const LIST_POLL_MS = 10_000;
const LIST_TIMEOUT_MS = 15_000;

function subscribeWide(cb: () => void) {
  const mq = window.matchMedia("(min-width: 1024px)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

/**
 * Phones get one screen at a time; computers get the list and the chat side by
 * side. Null until the browser tells us, so a chat isn't opened in the wrong layout first.
 */
function useWide(): boolean | null {
  return useSyncExternalStore<boolean | null>(
    subscribeWide,
    () => window.matchMedia("(min-width: 1024px)").matches,
    () => null
  );
}

interface ListState {
  platform: ChatPlatform;
  items: ChatListItem[];
  nextCursor: string | null;
  sample: boolean;
}

export function ChatsScreen() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const wide = useWide();

  const selectedId = pathname.startsWith("/chats/") ? decodeURIComponent(pathname.slice("/chats/".length)) : null;
  const shopFromUrl = parseShopParam(searchParams.get("shop"));
  const [shop, setShop] = useState<ChatPlatform>(shopFromUrl ?? "TIKTOK");
  const pickedDefault = useRef(shopFromUrl !== null);

  const [list, setList] = useState<ListState | null>(null);
  const [unread, setUnread] = useState<ChatUnread | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [testing, setTesting] = useState(false);

  // Follow the URL when it changes (back button, links from a chat).
  const lastUrlShop = useRef(shopFromUrl);
  useEffect(() => {
    if (shopFromUrl === lastUrlShop.current) return;
    lastUrlShop.current = shopFromUrl;
    if (shopFromUrl) {
      pickedDefault.current = true;
      setShop(shopFromUrl);
    }
  }, [shopFromUrl]);

  const load = useCallback(async (platform: ChatPlatform): Promise<void> => {
    try {
      const res = await fetch(`/api/chats?platform=${platform}`, {
        cache: "no-store",
        signal: timeoutSignal(LIST_TIMEOUT_MS),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) {
        setError(data?.error ?? "Couldn't load chats.");
        return;
      }
      setError(null);
      setUnread(data.unread);
      // No shop in the URL yet: open the one with more unread chats.
      if (!pickedDefault.current) {
        pickedDefault.current = true;
        const best = defaultShop(data.unread);
        if (best !== platform) {
          setShop(best);
          return;
        }
      }
      setList((prev) => ({
        platform,
        // Keep older pages the owner already loaded.
        items:
          prev && prev.platform === platform && prev.items.length > data.items.length
            ? mergeFirstPage(prev.items, data.items)
            : data.items,
        nextCursor: prev && prev.platform === platform && prev.items.length > data.items.length ? prev.nextCursor : data.nextCursor,
        sample: data.sample,
      }));
    } catch {
      setError("No connection. Pull down to try again.");
    }
  }, []);

  useEffect(() => {
    void load(shop);
    const tick = () => {
      if (document.visibilityState === "visible") void load(shop);
    };
    const id = setInterval(tick, LIST_POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [shop, load]);

  function changeShop(next: ChatPlatform) {
    if (next === shop) return;
    pickedDefault.current = true;
    setShop(next);
    setList(null);
    const url = selectedId ? `/chats?shop=${shopParam(next)}` : `${pathname}?shop=${shopParam(next)}`;
    router.replace(url, { scroll: false });
  }

  async function loadMore() {
    if (!list?.nextCursor) return;
    setLoadingMore(true);
    try {
      const res = await fetch(`/api/chats?platform=${list.platform}&cursor=${encodeURIComponent(list.nextCursor)}`, {
        cache: "no-store",
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data) {
        setList((prev) =>
          prev && prev.platform === list.platform
            ? {
                ...prev,
                items: [...prev.items, ...data.items.filter((i: ChatListItem) => !prev.items.some((p) => p.id === i.id))],
                nextCursor: data.nextCursor,
              }
            : prev
        );
      } else {
        toast("Couldn't load older chats", "error");
      }
    } finally {
      setLoadingMore(false);
    }
  }

  async function sendTestMessage() {
    setTesting(true);
    try {
      const res = await fetch("/api/demo/chats/incoming", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform: shop, ...(selectedId && wide ? { conversationId: selectedId } : {}) }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        toast("Test message added");
        await load(shop);
      } else {
        toast(data?.error ?? "Couldn't add a test message", "error");
      }
    } finally {
      setTesting(false);
    }
  }

  const refresh = useCallback(() => load(shop), [load, shop]);
  const visible = list && list.platform === shop ? list : null;
  const sample = visible?.sample ?? false;

  const options = (["SHOPEE", "TIKTOK"] as const).map((p) => {
    const n = unread?.[p] ?? 0;
    return { id: p, label: n > 0 ? `${platformName(p)} · ${n > 99 ? "99+" : n}` : platformName(p) };
  });

  const listBlock = (
    <ChatList
      platform={shop}
      items={visible?.items ?? null}
      error={error}
      selectedId={wide ? selectedId : null}
      sample={sample}
      hasMore={Boolean(visible?.nextCursor)}
      loadingMore={loadingMore}
      onLoadMore={loadMore}
      testing={testing}
      onTestMessage={sendTestMessage}
    />
  );

  const samplePill = sample ? (
    <Link
      href="/imports"
      className="pressable rounded-full bg-surface-muted px-2.5 py-1 text-[13px] font-bold text-ink-2 hover:bg-surface-track"
    >
      Sample
    </Link>
  ) : undefined;

  // Screen size not known yet (first paint of a chat link): wait one frame.
  if (wide === null && selectedId) return null;

  // Phone, one chat open: full screen, no tab bar.
  if (!wide && selectedId) {
    return <ChatThreadView key={selectedId} id={selectedId} layout="full" onChanged={refresh} />;
  }

  return (
    <AppShell
      title="Chats"
      width={wide ? "wide" : "default"}
      titleAccessory={samplePill}
      chatUnread={unread?.total}
      onRefresh={wide ? undefined : refresh}
    >
      <div className="space-y-4 lg:space-y-0">
        {!wide && <SegmentedControl label="Shop" options={options} value={shop} onChange={changeShop} />}

        {wide ? (
          <div className="grid h-[calc(100dvh-13rem)] min-h-[480px] grid-cols-[minmax(320px,380px)_1fr] gap-5">
            <div className="flex min-h-0 flex-col gap-3">
              <SegmentedControl label="Shop" options={options} value={shop} onChange={changeShop} />
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-[var(--radius-card)] pb-2">
                {listBlock}
              </div>
            </div>
            <div className="min-h-0 overflow-hidden rounded-[var(--radius-card)] bg-surface shadow-[var(--shadow-card)]">
              {selectedId ? (
                <ChatThreadView key={selectedId} id={selectedId} layout="pane" onChanged={refresh} />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
                  <MessageCircle className="h-9 w-9 text-ink-3/70" strokeWidth={1.6} />
                  <p className="text-[17px] font-semibold text-ink">Pick a chat to read it here</p>
                  <p className="max-w-xs text-[15px] text-ink-3">
                    Replies go to the buyer in the {platformName(shop)} app.
                  </p>
                </div>
              )}
            </div>
          </div>
        ) : (
          listBlock
        )}
      </div>
    </AppShell>
  );
}

/** Replace the first page with fresh data and keep the older pages after it. */
function mergeFirstPage(prev: ChatListItem[], fresh: ChatListItem[]): ChatListItem[] {
  const ids = new Set(fresh.map((i) => i.id));
  return [...fresh, ...prev.filter((i) => !ids.has(i.id))];
}
