"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { haptic } from "@/lib/ui/motion";

interface Option<T extends string> {
  id: T;
  label: string;
}

/**
 * iOS-style segmented control. The thumb slides under the selected segment.
 * Segments share the width equally, but a segment whose label doesn't fit grows
 * to its label (others shrink), so labels never get cut off. The thumb is
 * measured from the selected button so it follows either layout.
 * `value` may be null when none applies (e.g. a custom date is picked).
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  size = "md",
  shape = "rounded",
  className = "",
}: {
  options: readonly Option<T>[];
  value: T | null;
  onChange: (id: T) => void;
  label: string;
  size?: "md" | "sm";
  shape?: "rounded" | "pill";
  className?: string;
}) {
  const index = value === null ? -1 : options.findIndex((o) => o.id === value);
  const outerRadius = shape === "pill" ? "rounded-full" : "rounded-[var(--radius-control)]";
  const innerRadius = shape === "pill" ? "rounded-full" : "rounded-[9px]";
  const height = size === "sm" ? "h-9" : "h-11";
  const textSize = size === "sm" ? "text-[13px]" : "text-[15px]";
  const padX = size === "sm" ? "px-1.5" : "px-2";

  const listRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [thumb, setThumb] = useState<{ x: number; w: number } | null>(null);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const measure = () => {
      const btn = buttonRefs.current[Math.max(index, 0)];
      if (btn) setThumb({ x: btn.offsetLeft, w: btn.offsetWidth });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(list);
    // Buttons can resize without the list resizing (e.g. web font loads).
    for (const btn of buttonRefs.current) if (btn) ro.observe(btn);
    return () => ro.disconnect();
  }, [index, options.length]);

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={label}
      className={`relative grid ${height} ${outerRadius} bg-surface-track/80 p-[3px] ${className}`}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(max-content, 1fr))` }}
    >
      <span
        aria-hidden="true"
        data-motion="slide"
        className={`absolute inset-y-[3px] left-0 ${innerRadius} bg-surface shadow-[0_1px_3px_rgb(15_23_42/0.12),0_1px_1px_rgb(15_23_42/0.04)] transition-[transform,width,opacity] duration-200 ease-[var(--ease-ios)] dark:ring-1 dark:ring-white/10`}
        style={
          thumb
            ? { width: thumb.w, transform: `translateX(${thumb.x}px)`, opacity: index < 0 ? 0 : 1 }
            : {
                // Before the first measure (server render): assume equal segments.
                width: `calc((100% - 6px) / ${options.length})`,
                transform: `translateX(calc(3px + ${Math.max(index, 0) * 100}%))`,
                opacity: index < 0 ? 0 : 1,
              }
        }
      />
      {options.map((o, i) => {
        const active = o.id === value;
        return (
          <button
            key={o.id}
            ref={(el) => {
              buttonRefs.current[i] = el;
            }}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => {
              if (o.id !== value) haptic("select");
              onChange(o.id);
            }}
            className={`relative z-10 grid place-items-center whitespace-nowrap ${innerRadius} ${padX} ${textSize} transition-[color,opacity] duration-150 ${
              active ? "font-bold text-ink" : "font-semibold text-ink-2 hover:text-ink active:text-ink active:opacity-60"
            }`}
          >
            {/* Invisible bold copy reserves the bold width, so selecting doesn't shift the layout. */}
            <span aria-hidden="true" className="invisible col-start-1 row-start-1 font-bold">
              {o.label}
            </span>
            <span className="col-start-1 row-start-1">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
