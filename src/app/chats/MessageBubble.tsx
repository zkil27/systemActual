"use client";

import { AlertCircle, Loader2 } from "lucide-react";
import { ItemThumb } from "@/components/ui/ItemThumb";
import { formatPeso } from "@/lib/ui/format";
import { chatClock } from "@/lib/chats/format";
import type { ChatMessageView } from "@/lib/chats/types";

/** A message on screen: one from the server, or a reply still on its way. */
export type DisplayMessage = ChatMessageView & { local?: boolean };

function describe(m: DisplayMessage): string {
  if (m.kind === "IMAGE") return "Photo";
  if (m.kind === "ORDER_CARD") return `${m.card?.logistics ? "Delivery card" : "Order card"}: ${m.card?.itemName ?? "order"}`;
  if (m.kind === "PRODUCT_CARD") return `Product: ${m.card?.itemName ?? "item"}`;
  if (m.kind === "OTHER") return "Message that can't be shown here";
  return m.text ?? "";
}

export function MessageBubble({
  message: m,
  onOpenPhoto,
  onRetry,
  onMediaLoad,
}: {
  message: DisplayMessage;
  onOpenPhoto: (url: string) => void;
  onRetry: (m: DisplayMessage) => void;
  /** A photo finished loading and changed the bubble's height. */
  onMediaLoad?: () => void;
}) {
  const time = chatClock(m.sentAt);

  // Platform notices ("Chat assigned to an agent"): a quiet centred line, not a bubble.
  if (m.sender === "SYSTEM") {
    if (!m.text) return null;
    return (
      <p
        role="note"
        aria-label={`TikTok notice, ${time}: ${m.text}`}
        className="mx-auto max-w-[min(420px,86%)] px-3 text-center text-[13px] leading-snug text-ink-3 [overflow-wrap:anywhere]"
      >
        {m.text}
      </p>
    );
  }

  const bot = m.sender === "ROBOT" || m.autoBy === "duoke";
  const botName = m.autoBy === "duoke" ? "Duoke auto-reply" : "TikTok auto-reply";
  // The shop's side: the owner's replies and the TikTok auto-reply.
  const mine = m.sender === "SELLER" || bot;
  const who = bot ? botName : m.sender === "SELLER" ? "You" : "Buyer";
  const label = `${who}, ${time}: ${describe(m)}`;

  const shape = bot
    ? "rounded-[20px] rounded-br-[6px] bg-surface-muted text-ink-2"
    : mine
      ? "rounded-[20px] rounded-br-[6px] bg-brand-solid text-on-brand"
      : "rounded-[20px] rounded-bl-[6px] bg-surface text-ink shadow-[var(--shadow-card)]";

  let body: React.ReactNode;
  if (m.kind === "IMAGE" && m.imageUrl) {
    body = (
      <button
        type="button"
        onClick={() => onOpenPhoto(m.imageUrl as string)}
        aria-label={`Open photo from ${mine ? "you" : "buyer"}, ${time}`}
        className="pressable relative block overflow-hidden rounded-[18px] bg-surface-muted"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={m.imageUrl}
          alt=""
          decoding="async"
          onLoad={onMediaLoad}
          className={`block max-h-72 w-[min(240px,60vw)] object-cover ${m.status === "SENDING" ? "opacity-60" : ""}`}
        />
        {m.status === "SENDING" && (
          <span className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="anim-spin h-7 w-7 text-white drop-shadow" aria-hidden="true" />
          </span>
        )}
      </button>
    );
  } else if ((m.kind === "ORDER_CARD" || m.kind === "PRODUCT_CARD") && m.card) {
    body = (
      <div className={`flex w-[min(280px,72vw)] items-center gap-3 p-2.5 ${shape}`}>
        <ItemThumb src={m.card.imageUrl} alt={m.card.itemName} size="sm" />
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold">{m.card.itemName}</p>
          {m.card.variation && (
            <p className={`truncate text-[13px] opacity-80 ${m.card.logistics ? "tabular-nums" : ""}`}>{m.card.variation}</p>
          )}
          <p className="tabular-nums truncate text-[13px] opacity-80">
            {m.kind === "ORDER_CARD"
              ? `Order ${m.card.orderSn ?? ""}`.trim()
              : m.card.pricePhp !== null
                ? `Product · ${formatPeso(m.card.pricePhp)}`
                : "Product"}
          </p>
        </div>
      </div>
    );
  } else if (m.kind === "ORDER_CARD" || m.kind === "PRODUCT_CARD") {
    // A card we couldn't fill in.
    body = (
      <p className={`max-w-[min(320px,78vw)] px-3.5 py-2 text-[15px] ${shape}`}>
        {m.kind === "ORDER_CARD" ? "Order card" : "Product card"}
      </p>
    );
  } else if (m.kind === "OTHER") {
    body = (
      <p className={`max-w-[min(320px,78vw)] px-3.5 py-2 text-[15px] italic opacity-80 ${shape}`}>
        {bot ? "Auto-reply card. Open the shop app to see it." : "This kind of message can't be shown here. Open the shop app to see it."}
      </p>
    );
  } else {
    body = (
      <p
        className={`max-w-[min(420px,78vw)] whitespace-pre-wrap px-3.5 py-2 text-[16px] leading-[1.4] [overflow-wrap:anywhere] ${shape}`}
      >
        {m.text}
      </p>
    );
  }

  return (
    <div role="group" aria-label={label} className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
      {bot && (
        <span aria-hidden="true" className="mb-1 px-1 text-[12px] font-semibold text-ink-3">
          {botName}
        </span>
      )}
      {body}
      {m.status === "FAILED" ? (
        <button
          type="button"
          onClick={() => onRetry(m)}
          className="pressable mt-0.5 inline-flex min-h-11 items-center gap-1.5 px-1 text-[13px] font-bold text-missing-ink"
        >
          <AlertCircle className="h-4 w-4" aria-hidden="true" />
          Not sent · Tap to retry
        </button>
      ) : (
        <span aria-hidden="true" className="tabular-nums mt-1 px-1 text-[12px] text-ink-3">
          {m.status === "SENDING" ? "Sending…" : time}
        </span>
      )}
    </div>
  );
}
