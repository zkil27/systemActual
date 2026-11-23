"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowDown, ChevronLeft, ExternalLink, MessageSquarePlus } from "lucide-react";
import { useConfirm } from "@/components/ui/ConfirmSheet";
import { PhotoLightbox } from "@/components/ui/PhotoLightbox";
import { toast, Toaster } from "@/components/ui/Toast";
import { describeFound, findOffPlatformDetails } from "@/lib/chats/contact-check";
import { newClientKey, shrinkPhoto, timeoutSignal } from "@/lib/chats/client";
import { platformName, shopParam, withDaySeparators } from "@/lib/chats/format";
import type { ChatMessageView, ChatThread } from "@/lib/chats/types";
import { BuyerAvatar } from "./BuyerAvatar";
import { Composer } from "./Composer";
import { MessageBubble, type DisplayMessage } from "./MessageBubble";
import { OrderCard } from "./OrderCard";
import { PhotoSendSheet } from "./PhotoSendSheet";

const THREAD_POLL_MS = 4_000;
/** TikTok Seller Center (PH). The chat inbox opens from there. */
const TIKTOK_SELLER_CHAT_URL = "https://seller-ph.tiktok.com/";
/** A check that hangs on a weak signal is dropped, so the next one can run. */
const POLL_TIMEOUT_MS = 10_000;
/** Slightly longer than the sheet's exit animation. */
const SHEET_CLOSE_MS = 320;
/** Within this many px of the bottom counts as "reading the newest message". */
const NEAR_BOTTOM_PX = 96;

type Meta = Omit<ChatThread, "messages">;
type Outgoing = { text: string } | { file: File | null };

/** The phone keyboard shrinks the visual viewport, not the layout one. Keep the composer above it. */
function useVisualViewport(enabled: boolean) {
  const [vv, setVv] = useState<{ height: number; top: number } | null>(null);
  useEffect(() => {
    const v = enabled ? window.visualViewport : null;
    if (!v) return;
    const update = () => setVv({ height: v.height, top: v.offsetTop });
    update();
    v.addEventListener("resize", update);
    v.addEventListener("scroll", update);
    return () => {
      v.removeEventListener("resize", update);
      v.removeEventListener("scroll", update);
    };
  }, [enabled]);
  return vv;
}

export function ChatThreadView({
  id,
  layout,
  onChanged,
}: {
  id: string;
  /** "full": phone, whole screen. "pane": right side of the computer layout. */
  layout: "full" | "pane";
  /** Something the list shows changed (read, new reply). */
  onChanged: () => void;
}) {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [messages, setMessages] = useState<ChatMessageView[]>([]);
  const [pending, setPending] = useState<DisplayMessage[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [text, setText] = useState("");
  /** Replies go out one after another, in the order they were sent, without blocking the box. */
  const sendQueue = useRef<Promise<void>>(Promise.resolve());
  const [photoDraft, setPhotoDraft] = useState<{ file: File; url: string } | null>(null);
  const [preparingPhoto, setPreparingPhoto] = useState(false);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [newPill, setNewPill] = useState(false);
  const [testing, setTesting] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const scrollMode = useRef<"jump" | "smooth" | null>("jump");
  const outgoing = useRef(new Map<string, Outgoing>());
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesRef = useRef<ChatMessageView[]>([]);
  messagesRef.current = messages;
  const { confirm, sheet: confirmSheet } = useConfirm();
  const vv = useVisualViewport(layout === "full");

  const markRead = useCallback(async () => {
    try {
      const res = await fetch(`/api/chats/${encodeURIComponent(id)}/read`, { method: "POST" });
      if (res.ok) onChanged();
    } catch {
      // Next poll tries again.
    }
  }, [id, onChanged]);

  /** Add or replace server messages, and drop the local copies they stand for. */
  const mergeServer = useCallback((incoming: ChatMessageView[]) => {
    if (incoming.length === 0) return;
    setMessages((prev) => {
      const byId = new Map(prev.map((m) => [m.id, m]));
      for (const m of incoming) byId.set(m.id, m);
      return [...byId.values()].sort((a, b) => a.sentAt.localeCompare(b.sentAt) || a.id.localeCompare(b.id));
    });
    const keys = new Set(incoming.map((m) => m.clientKey).filter(Boolean));
    if (keys.size > 0) {
      setPending((prev) => {
        for (const p of prev) if (p.clientKey && keys.has(p.clientKey) && p.imageUrl?.startsWith("blob:")) URL.revokeObjectURL(p.imageUrl);
        return prev.filter((p) => !p.clientKey || !keys.has(p.clientKey));
      });
    }
  }, []);

  // First load.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/chats/${encodeURIComponent(id)}`, { cache: "no-store" });
        if (!active) return;
        if (res.status === 404) return setState("missing");
        const data = (await res.json().catch(() => null)) as ChatThread | null;
        if (!res.ok || !data) return setState("error");
        const { messages: first, ...rest } = data;
        setMeta(rest);
        scrollMode.current = "jump";
        setMessages(first);
        setState("ready");
        void markRead();
      } catch {
        if (active) setState("error");
      }
    })();
    return () => {
      active = false;
    };
  }, [id, markRead]);

  // New messages every few seconds while the chat is on screen.
  useEffect(() => {
    if (state !== "ready") return;
    let busy = false;
    const poll = async () => {
      if (busy || document.visibilityState !== "visible") return;
      busy = true;
      try {
        const last = messagesRef.current[messagesRef.current.length - 1];
        const res = await fetch(
          `/api/chats/${encodeURIComponent(id)}${last ? `?after=${encodeURIComponent(last.id)}` : ""}`,
          { cache: "no-store", signal: timeoutSignal(POLL_TIMEOUT_MS) }
        );
        if (!res.ok) return;
        const data = (await res.json()) as ChatThread;
        const known = new Set(messagesRef.current.map((m) => m.id));
        const fresh = data.messages.filter((m) => !known.has(m.id));
        if (fresh.length === 0) return;
        scrollMode.current = atBottom.current ? "smooth" : null;
        if (!atBottom.current) setNewPill(true);
        mergeServer(fresh);
        if (fresh.some((m) => m.sender === "BUYER")) void markRead();
      } catch {
        // Offline for a moment: try again next time.
      } finally {
        busy = false;
      }
    };
    const timer = setInterval(poll, THREAD_POLL_MS);
    document.addEventListener("visibilitychange", poll);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [state, id, mergeServer, markRead]);

  const display: DisplayMessage[] = useMemo(() => {
    const keys = new Set(messages.map((m) => m.clientKey).filter(Boolean));
    return [...messages, ...pending.filter((p) => !p.clientKey || !keys.has(p.clientKey))];
  }, [messages, pending]);

  const rows = useMemo(() => withDaySeparators(display), [display]);
  const photos = useMemo(() => display.filter((m) => m.kind === "IMAGE" && m.imageUrl).map((m) => m.imageUrl as string), [display]);

  // Keep the newest message in view when it's the owner's own reply or they were already at the bottom.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const mode = scrollMode.current;
    if (!el || !mode) return;
    scrollMode.current = null;
    el.scrollTo({ top: el.scrollHeight, behavior: mode === "smooth" ? "smooth" : "auto" });
  }, [rows]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    if (atBottom.current && newPill) setNewPill(false);
  }

  /** Photos load after the first jump; stay on the newest message if the owner was there. */
  function keepAtBottom() {
    const el = scrollRef.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }

  function jumpToNewest() {
    setNewPill(false);
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }

  function deliver(clientKey: string, content: Outgoing): Promise<void> {
    const run = sendQueue.current.then(() => post(clientKey, content));
    sendQueue.current = run.catch(() => {});
    return run;
  }

  async function post(clientKey: string, content: Outgoing) {
    try {
      let res: Response;
      if ("text" in content) {
        res = await fetch(`/api/chats/${encodeURIComponent(id)}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientKey, text: content.text }),
        });
      } else {
        const fd = new FormData();
        fd.append("clientKey", clientKey);
        if (content.file) fd.append("photo", content.file);
        res = await fetch(`/api/chats/${encodeURIComponent(id)}/messages`, { method: "POST", body: fd });
      }
      const data = await res.json().catch(() => null);
      if (res.ok && data?.message) {
        const msg = data.message as ChatMessageView;
        scrollMode.current = "smooth";
        mergeServer([msg]);
        if (msg.status === "SENT") {
          outgoing.current.delete(clientKey);
          onChanged();
        } else {
          toast("Not sent. Tap the message to retry.", "error");
        }
      } else {
        markFailed(clientKey);
        toast(data?.error ?? "Not sent. Tap the message to retry.", "error");
      }
    } catch {
      markFailed(clientKey);
      toast("No connection. Tap the message to retry.", "error");
    }
  }

  function markFailed(clientKey: string) {
    setPending((prev) => prev.map((p) => (p.clientKey === clientKey ? { ...p, status: "FAILED" } : p)));
    setMessages((prev) => prev.map((m) => (m.clientKey === clientKey ? { ...m, status: "FAILED" } : m)));
  }

  function addPending(clientKey: string, partial: Pick<DisplayMessage, "kind" | "text" | "imageUrl">) {
    scrollMode.current = "smooth";
    setPending((prev) => [
      ...prev,
      {
        id: `local-${clientKey}`,
        clientKey,
        sender: "SELLER",
        card: null,
        sentAt: new Date().toISOString(),
        status: "SENDING",
        local: true,
        ...partial,
      },
    ]);
  }

  async function sendText() {
    const body = text.trim();
    if (!body) return;
    const found = findOffPlatformDetails(body);
    if (found.length > 0) {
      const ok = await confirm({
        title: "Send anyway?",
        message: (
          <>
            <p>Shopee and TikTok don&apos;t allow sharing contact or payment details in chat.</p>
            <p className="mt-2 text-[15px] text-ink-3">This message has {describeFound(found)}.</p>
          </>
        ),
        cancelLabel: "Edit message",
        confirmLabel: "Send anyway",
      });
      if (!ok) {
        // The sheet hands focus back to the Send button as it closes; take it after that.
        setTimeout(() => textareaRef.current?.focus(), SHEET_CLOSE_MS);
        return;
      }
    }
    const clientKey = newClientKey();
    outgoing.current.set(clientKey, { text: body });
    addPending(clientKey, { kind: "TEXT", text: body, imageUrl: null });
    setText("");
    await deliver(clientKey, { text: body });
  }

  async function pickPhoto(file: File) {
    setPreparingPhoto(true);
    try {
      const small = await shrinkPhoto(file);
      setPhotoDraft({ file: small, url: URL.createObjectURL(small) });
    } finally {
      setPreparingPhoto(false);
    }
  }

  async function sendPhoto() {
    const draft = photoDraft;
    if (!draft) return;
    setPhotoDraft(null);
    const clientKey = newClientKey();
    outgoing.current.set(clientKey, { file: draft.file });
    addPending(clientKey, { kind: "IMAGE", text: null, imageUrl: draft.url });
    await deliver(clientKey, { file: draft.file });
  }

  function cancelPhoto() {
    if (photoDraft) URL.revokeObjectURL(photoDraft.url);
    setPhotoDraft(null);
  }

  function retry(m: DisplayMessage) {
    if (!m.clientKey || m.status !== "FAILED") return;
    const saved = outgoing.current.get(m.clientKey);
    setPending((prev) => prev.map((p) => (p.clientKey === m.clientKey ? { ...p, status: "SENDING" } : p)));
    setMessages((prev) => prev.map((x) => (x.clientKey === m.clientKey ? { ...x, status: "SENDING" } : x)));
    // After a reload only the server copy is left; it already has the text or photo.
    const content: Outgoing = saved ?? (m.kind === "IMAGE" ? { file: null } : { text: m.text ?? "" });
    void deliver(m.clientKey, content);
  }

  async function sendTestMessage() {
    if (!meta) return;
    setTesting(true);
    try {
      const res = await fetch("/api/demo/chats/incoming", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform: meta.platform, conversationId: meta.id }),
      });
      if (!res.ok) toast("Couldn't add a test message", "error");
    } finally {
      setTesting(false);
    }
  }

  const backHref = `/chats?shop=${shopParam(meta?.platform ?? "TIKTOK")}`;
  const full = layout === "full";

  const header = (
    <header
      className={`shrink-0 border-b border-hairline ${full ? "safe-top bg-surface/90 backdrop-blur-xl backdrop-saturate-150" : "bg-surface"}`}
    >
      <div className={`flex h-14 items-center gap-2 ${full ? "px-1.5" : "px-4"}`}>
        {full && (
          <Link
            href={backHref}
            scroll={false}
            aria-label="Back to chats"
            className="pressable flex h-11 items-center gap-0.5 rounded-full pl-1 pr-2 text-[17px] font-semibold text-brand hover:bg-brand-soft"
          >
            <ChevronLeft className="h-7 w-7" strokeWidth={2.2} />
            <span className="sr-only sm:not-sr-only">Chats</span>
          </Link>
        )}
        {meta ? (
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <BuyerAvatar name={meta.buyerName} src={meta.buyerAvatarUrl} size="sm" />
            <div className="min-w-0">
              <h1 className="truncate text-[17px] font-bold leading-tight text-ink">{meta.buyerName}</h1>
              <p className="truncate text-[13px] text-ink-3">
                {platformName(meta.platform)}
                {meta.sample ? " · Sample chat" : ""}
              </p>
            </div>
          </div>
        ) : (
          <div className="flex-1" />
        )}
      </div>
    </header>
  );

  let content: React.ReactNode;
  if (state === "missing" || state === "error") {
    content = (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
        <p className="text-[17px] font-semibold text-ink">
          {state === "missing" ? "This chat isn't here anymore" : "Couldn't load this chat"}
        </p>
        <p className="text-[15px] text-ink-3">
          {state === "missing" ? "Chats are kept for 90 days." : "Check your connection and try again."}
        </p>
        {full && (
          <Link href={backHref} className="text-[16px] font-bold text-brand">
            Back to chats
          </Link>
        )}
      </div>
    );
  } else if (state === "loading" || !meta) {
    content = (
      <div aria-busy="true" aria-label="Loading chat" className="flex flex-1 flex-col justify-end gap-3 px-4 pb-4">
        <div className="h-10 w-3/5 animate-pulse rounded-[20px] bg-surface-muted" />
        <div className="ml-auto h-10 w-2/5 animate-pulse rounded-[20px] bg-brand-soft" />
        <div className="h-10 w-1/2 animate-pulse rounded-[20px] bg-surface-muted" />
      </div>
    );
  } else {
    content = (
      <>
        {meta.order && (
          <div className="shrink-0 px-3 pb-1 pt-3">
            <OrderCard order={meta.order} />
          </div>
        )}
        <div className="relative min-h-0 flex-1">
          <div
            ref={scrollRef}
            onScroll={onScroll}
            className="h-full overflow-y-auto overscroll-contain px-3 pb-3 pt-2"
            aria-live="polite"
            aria-relevant="additions"
          >
            {rows.length === 0 && (
              <p className="px-4 py-10 text-center text-[15px] text-ink-3">No messages yet.</p>
            )}
            <ol className="space-y-2.5">
              {rows.map((r) =>
                r.type === "day" ? (
                  <li key={r.key} className="flex justify-center pb-1 pt-3">
                    <span className="rounded-full bg-surface-muted px-3 py-1 text-[12px] font-semibold text-ink-2">
                      {r.label}
                    </span>
                  </li>
                ) : (
                  <li key={r.key}>
                    <MessageBubble
                      message={r.message}
                      onRetry={retry}
                      onMediaLoad={keepAtBottom}
                      onOpenPhoto={(url) => setLightbox(Math.max(0, photos.indexOf(url)))}
                    />
                  </li>
                )
              )}
            </ol>
            {meta.sample && (
              <div className="flex justify-center pt-5">
                <button
                  type="button"
                  onClick={sendTestMessage}
                  disabled={testing}
                  className="pressable inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-[14px] font-semibold text-brand hover:bg-brand-soft disabled:opacity-60"
                >
                  <MessageSquarePlus className="h-4 w-4" />
                  {testing ? "Sending…" : "Send a test buyer message"}
                </button>
              </div>
            )}
          </div>
          {newPill && (
            <button
              type="button"
              onClick={jumpToNewest}
              className="anim-rise-in pressable absolute bottom-3 left-1/2 inline-flex h-10 -translate-x-1/2 items-center gap-1.5 rounded-full bg-surface px-4 text-[14px] font-bold text-brand shadow-[var(--shadow-float)]"
            >
              <ArrowDown className="h-4 w-4" />
              New message
            </button>
          )}
        </div>
        {meta.canReply ? (
          <Composer
            ref={textareaRef}
            value={text}
            onChange={setText}
            onSend={sendText}
            onPickPhoto={pickPhoto}
            preparingPhoto={preparingPhoto}
            safeBottom={full}
            allowPhotos={meta.canSendPhotos}
          />
        ) : (
          <div
            className={`shrink-0 border-t border-hairline bg-surface px-4 pt-3 ${
              full ? "pb-[max(12px,env(safe-area-inset-bottom))]" : "pb-3"
            }`}
          >
            <p className="text-[15px] text-ink-2">{meta.replyNote}</p>
            {meta.platform === "TIKTOK" && (
              <a
                href={TIKTOK_SELLER_CHAT_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="pressable mt-1 inline-flex min-h-11 items-center gap-1.5 text-[15px] font-bold text-brand"
              >
                Open TikTok Seller Center
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
              </a>
            )}
          </div>
        )}
      </>
    );
  }

  const shell = (
    <div className={`flex h-full min-h-0 flex-col ${full ? "bg-ground" : "bg-ground/60"}`}>
      {header}
      {content}
    </div>
  );

  return (
    <>
      {full ? (
        <div
          className="fixed inset-x-0 top-0 z-40 flex flex-col"
          style={vv ? { height: vv.height, transform: `translateY(${vv.top}px)` } : { height: "100dvh" }}
        >
          <div className="mx-auto flex h-full w-full max-w-3xl flex-col">{shell}</div>
        </div>
      ) : (
        shell
      )}
      <PhotoSendSheet draft={photoDraft} onCancel={cancelPhoto} onSend={sendPhoto} />
      <PhotoLightbox
        photos={photos}
        index={lightbox}
        onClose={() => setLightbox(null)}
        onIndexChange={setLightbox}
        fileBaseName="chat-photo"
      />
      {confirmSheet}
      {full && <Toaster />}
    </>
  );
}
