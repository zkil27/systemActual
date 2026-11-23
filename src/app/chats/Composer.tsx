"use client";

import { useLayoutEffect, useRef } from "react";
import { ArrowUp, ImagePlus, Loader2 } from "lucide-react";
import { MAX_REPLY_CHARS } from "@/lib/chats/send";

const MAX_TEXTAREA_PX = 132; // about 5 lines

/** Reply box pinned under the messages: photo, text that grows, and Send. */
export function Composer({
  ref,
  value,
  onChange,
  onSend,
  onPickPhoto,
  preparingPhoto,
  safeBottom,
  allowPhotos = true,
}: {
  /** Hide the photo button where photos can't be sent yet. */
  allowPhotos?: boolean;
  ref?: React.Ref<HTMLTextAreaElement>;
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onPickPhoto: (file: File) => void;
  preparingPhoto: boolean;
  /** Pad for the home indicator (phone, full screen). */
  safeBottom: boolean;
}) {
  const inner = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const remaining = MAX_REPLY_CHARS - value.trim().length;
  const canSend = value.trim().length > 0 && remaining >= 0;

  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_PX)}px`;
  }, [value]);

  function setRefs(el: HTMLTextAreaElement | null) {
    inner.current = el;
    if (typeof ref === "function") ref(el);
    else if (ref) (ref as React.RefObject<HTMLTextAreaElement | null>).current = el;
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (canSend) onSend();
      }}
      className={`shrink-0 border-t border-hairline bg-surface px-2 pt-2 ${
        safeBottom ? "pb-[max(8px,env(safe-area-inset-bottom))]" : "pb-2"
      }`}
    >
      {remaining < 100 && (
        <p
          aria-live="polite"
          className={`tabular-nums px-3 pb-1 text-right text-[12px] font-semibold ${remaining < 0 ? "text-missing-ink" : "text-ink-3"}`}
        >
          {remaining < 0 ? `${-remaining} characters too long` : `${remaining} characters left`}
        </p>
      )}
      <div className={`flex items-end gap-1.5 ${allowPhotos ? "" : "pl-1"}`}>
        {allowPhotos && (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={preparingPhoto}
            aria-label="Send a photo"
            title="Send a photo"
            className="pressable flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-brand hover:bg-brand-soft disabled:text-ink-3"
          >
            {preparingPhoto ? <Loader2 className="anim-spin h-6 w-6" /> : <ImagePlus className="h-6 w-6" />}
          </button>
        )}
        <input
          disabled={!allowPhotos}
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/*"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) onPickPhoto(f);
          }}
        />
        <label className="sr-only" htmlFor="chat-reply">
          Reply
        </label>
        <textarea
          id="chat-reply"
          ref={setRefs}
          rows={1}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends on a computer keyboard; on phones Enter is a new line.
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia("(pointer: fine)").matches) {
              e.preventDefault();
              if (canSend && remaining >= 0) onSend();
            }
          }}
          placeholder="Write a reply"
          enterKeyHint="send"
          className="min-h-12 flex-1 resize-none rounded-[24px] bg-surface-muted px-4 py-3 text-[16px] leading-[1.4] text-ink caret-brand outline-none placeholder:text-ink-3 focus-visible:ring-2 focus-visible:ring-brand/40"
        />
        <button
          type="submit"
          disabled={!canSend || remaining < 0}
          aria-label="Send"
          className="pressable flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand-solid text-on-brand hover:bg-brand-solid-hover disabled:bg-surface-muted disabled:text-ink-3"
        >
<ArrowUp className="h-6 w-6" strokeWidth={2.4} />
        </button>
      </div>
    </form>
  );
}
