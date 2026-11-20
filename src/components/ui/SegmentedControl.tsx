"use client";

interface Option<T extends string> {
  id: T;
  label: string;
}

/**
 * iOS-style segmented control. The white thumb slides under the selected
 * segment; segments share the width equally so the slide is one transform.
 * `value` may be null when none applies (e.g. a custom date is picked).
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  className = "",
}: {
  options: readonly Option<T>[];
  value: T | null;
  onChange: (id: T) => void;
  label: string;
  className?: string;
}) {
  const index = value === null ? -1 : options.findIndex((o) => o.id === value);

  return (
    <div
      role="tablist"
      aria-label={label}
      className={`relative grid h-11 rounded-[var(--radius-control)] bg-slate-200/70 p-[3px] ${className}`}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      <span
        aria-hidden="true"
        data-motion="slide"
        className="absolute inset-y-[3px] left-[3px] rounded-[9px] bg-white shadow-[0_1px_3px_rgb(15_23_42/0.12),0_1px_1px_rgb(15_23_42/0.04)] transition-[transform,opacity] duration-200 ease-[var(--ease-ios)]"
        style={{
          width: `calc((100% - 6px) / ${options.length})`,
          transform: `translateX(${Math.max(index, 0) * 100}%)`,
          opacity: index < 0 ? 0 : 1,
        }}
      />
      {options.map((o) => {
        const active = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.id)}
            className={`relative z-10 rounded-[9px] text-[15px] transition-colors duration-150 ${
              active ? "font-bold text-ink" : "font-semibold text-ink-2 active:text-ink"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
