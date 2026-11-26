"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Search, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { haptic } from "@/lib/ui/motion";
import {
  filterPickerOptions,
  stepActiveIndex,
  type PickerOption,
} from "@/lib/ui/option-picker";

export function OptionPickerSheet({
  open,
  onClose,
  title,
  options,
  value,
  onChange,
  searchable,
  searchPlaceholder = "Search...",
  emptyLabel = "No matching options",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  options: PickerOption[];
  value: string;
  onChange: (value: string) => void;
  searchable?: boolean;
  searchPlaceholder?: string;
  emptyLabel?: string;
}) {
  const showSearch = searchable ?? options.length > 8;
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => filterPickerOptions(options, query), [options, query]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    const initialIdx = options.findIndex((o) => o.value === value && !o.disabled);
    setActiveIndex(
      initialIdx >= 0 ? initialIdx : options.findIndex((o) => !o.disabled)
    );
  }, [open, options, value]);

  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => {
      if (
        showSearch &&
        typeof window !== "undefined" &&
        window.matchMedia?.("(hover: hover) and (pointer: fine)").matches
      ) {
        searchInputRef.current?.focus({ preventScroll: true });
      }
      const selectedIdx = options.findIndex((o) => o.value === value);
      if (selectedIdx >= 0) {
        listRef.current
          ?.querySelector<HTMLElement>(`[data-picker-index="${selectedIdx}"]`)
          ?.scrollIntoView({ block: "nearest" });
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [open, showSearch, options, value]);

  function updateQuery(next: string) {
    setQuery(next);
    const nextFiltered = filterPickerOptions(options, next);
    setActiveIndex(nextFiltered.findIndex((o) => !o.disabled));
  }

  function selectOption(nextValue: string) {
    haptic("select");
    onChange(nextValue);
    onClose();
  }

  function scrollIndexIntoView(idx: number) {
    if (idx < 0) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-picker-index="${idx}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = stepActiveIndex(filtered, activeIndex, 1);
      setActiveIndex(next);
      scrollIndexIntoView(next);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const next = stepActiveIndex(filtered, activeIndex, -1);
      setActiveIndex(next);
      scrollIndexIntoView(next);
    } else if (e.key === "Enter") {
      const target = filtered[activeIndex];
      if (target && !target.disabled) {
        e.preventDefault();
        selectOption(target.value);
      }
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      panelClassName={options.length > 8 ? "h-[82dvh] md:h-[min(560px,80vh)]" : ""}
      bodyClassName="!px-0 !pb-4"
      stickyHeader={
        showSearch ? (
          <div>
            <div className="relative">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3"
              />
              <input
                ref={searchInputRef}
                type="text"
                inputMode="search"
                enterKeyHint="search"
                autoComplete="off"
                spellCheck={false}
                value={query}
                onChange={(e) => updateQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                className="h-11 w-full rounded-[var(--radius-control)] bg-surface-muted pl-10 pr-11 text-[16px] text-ink outline-none focus:ring-2 focus:ring-brand"
              />
              {query.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    updateQuery("");
                    searchInputRef.current?.focus({ preventScroll: true });
                  }}
                  aria-label="Clear search"
                  className="pressable absolute right-0 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full text-ink-3 hover:text-ink"
                >
                  <X className="h-4 w-4" strokeWidth={2.4} />
                </button>
              )}
            </div>
            {query.trim().length > 0 && (
              <p
                aria-live="polite"
                className="mt-1.5 text-[12px] font-medium tabular-nums text-ink-3"
              >
                Showing {filtered.length} of {options.length}
              </p>
            )}
          </div>
        ) : undefined
      }
    >
      {filtered.length === 0 ? (
        <div className="space-y-3 px-5 py-10 text-center">
          <p className="text-[15px] font-semibold text-ink-2">{emptyLabel}</p>
          <Button variant="secondary" size="md" onClick={() => updateQuery("")}>
            Clear search
          </Button>
        </div>
      ) : (
        <div
          ref={listRef}
          role="listbox"
          aria-label={title}
          onKeyDown={handleKeyDown}
          className="divide-y divide-hairline"
        >
          {filtered.map((opt, idx) => {
            const isSelected = opt.value === value;
            const isActive = idx === activeIndex;
            const nextOpt = filtered[idx + 1];
            const pinnedDivider = Boolean(opt.pinned && nextOpt && !nextOpt.pinned);

            return (
              <button
                key={opt.value || "__all__"}
                type="button"
                role="option"
                data-picker-index={idx}
                aria-selected={isSelected}
                disabled={opt.disabled}
                onClick={() => selectOption(opt.value)}
                onMouseEnter={() => setActiveIndex(idx)}
                className={`pressable-row flex min-h-[56px] w-full items-center justify-between gap-3 px-5 py-3 text-left disabled:cursor-not-allowed disabled:opacity-45 ${
                  pinnedDivider ? "border-b-2 border-hairline-strong" : ""
                } ${
                  isSelected
                    ? "bg-brand-soft"
                    : isActive
                      ? "bg-surface-subtle"
                      : "bg-surface hover:bg-surface-subtle active:bg-surface-muted"
                }`}
              >
                <span className="min-w-0 flex-1">
                  <span
                    className={`block text-[15px] leading-snug text-ink ${
                      isSelected ? "font-bold" : "font-semibold"
                    }`}
                  >
                    {opt.label}
                  </span>
                  {opt.description && (
                    <span className="mt-0.5 block text-[13px] leading-snug tabular-nums text-ink-3">
                      {opt.description}
                    </span>
                  )}
                </span>

                <span className="flex shrink-0 items-center gap-2.5">
                  {opt.trailing && (
                    <span
                      className={`text-[14px] font-semibold tabular-nums ${
                        isSelected ? "text-brand" : "text-ink-2"
                      }`}
                    >
                      {opt.trailing}
                    </span>
                  )}
                  {isSelected && (
                    <span
                      aria-hidden="true"
                      className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-solid text-on-brand"
                    >
                      <Check className="h-3.5 w-3.5" strokeWidth={3} />
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </Sheet>
  );
}
