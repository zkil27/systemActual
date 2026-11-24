"use client";

import { Loader2, Sparkles, ThumbsDown, ThumbsUp, X } from "lucide-react";
import type { ChatDraftView } from "@/lib/chats/types";

function SuggestButton({ label, suggesting, onSuggest }: { label: string; suggesting: boolean; onSuggest: () => void }) {
  return (
    <button
      type="button"
      onClick={onSuggest}
      disabled={suggesting}
      aria-busy={suggesting}
      className="pressable inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-[14px] font-bold text-brand hover:bg-brand-soft disabled:opacity-70"
    >
      {suggesting ? (
        <Loader2 className="anim-spin h-4 w-4" aria-hidden="true" />
      ) : (
        <Sparkles className="h-4 w-4" aria-hidden="true" />
      )}
      {suggesting ? "Writing a reply…" : label}
    </button>
  );
}

/** No draft yet: ask the AI for one. It only fills a draft; the owner still sends. */
export function SuggestBar({ suggesting, onSuggest }: { suggesting: boolean; onSuggest: () => void }) {
  return (
    <div className="shrink-0 border-t border-hairline bg-surface px-2 py-1">
      <SuggestButton label="Suggest a reply" suggesting={suggesting} onSuggest={onSuggest} />
    </div>
  );
}

/** The assistant's suggested reply, above the reply box. Nothing is sent until the owner sends it. */
export function DraftCard({
  draft,
  onUse,
  onDismiss,
  onRate,
  onSuggest,
  suggesting = false,
}: {
  draft: ChatDraftView;
  onUse: () => void;
  onDismiss: () => void;
  onRate: (rating: "good" | "bad") => void;
  /** Shown on a saved-answer draft (AI was busy): try the AI again. */
  onSuggest?: () => void;
  suggesting?: boolean;
}) {
  return (
    <div className="anim-rise-in shrink-0 border-t border-hairline bg-brand-soft/60 px-3 pb-2 pt-2.5">
      <div className="flex items-center gap-2 px-1">
        <Sparkles className="h-4 w-4 shrink-0 text-brand" aria-hidden="true" />
        <p className="min-w-0 flex-1 text-[13px] font-semibold leading-snug text-ink-2">
          Suggested reply
          <span className="block font-normal text-ink-3">{draft.basis}</span>
        </p>
        <button
          type="button"
          onClick={() => onRate("good")}
          aria-label="Good suggestion"
          aria-pressed={draft.rating === "good"}
          className={`pressable flex h-11 w-11 items-center justify-center rounded-full hover:bg-surface ${
            draft.rating === "good" ? "text-arrived" : "text-ink-3"
          }`}
        >
          <ThumbsUp className="h-[18px] w-[18px]" />
        </button>
        <button
          type="button"
          onClick={() => onRate("bad")}
          aria-label="Bad suggestion"
          aria-pressed={draft.rating === "bad"}
          className={`pressable flex h-11 w-11 items-center justify-center rounded-full hover:bg-surface ${
            draft.rating === "bad" ? "text-missing-ink" : "text-ink-3"
          }`}
        >
          <ThumbsDown className="h-[18px] w-[18px]" />
        </button>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss suggestion"
          className="pressable flex h-11 w-11 items-center justify-center rounded-full text-ink-3 hover:bg-surface"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
      <button
        type="button"
        onClick={onUse}
        className="pressable mt-1 block w-full rounded-[16px] bg-surface px-3.5 py-2.5 text-left shadow-[var(--shadow-card)] hover:bg-surface-subtle"
      >
        <span className="line-clamp-4 whitespace-pre-wrap text-[15px] leading-[1.4] text-ink [overflow-wrap:anywhere]">
          {draft.text}
        </span>
        <span className="mt-1.5 block text-[13px] font-bold text-brand">Use this reply</span>
      </button>
      {onSuggest && (
        <div className="mt-0.5">
          <SuggestButton label="Ask the AI instead" suggesting={suggesting} onSuggest={onSuggest} />
        </div>
      )}
    </div>
  );
}
