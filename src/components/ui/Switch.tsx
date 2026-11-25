"use client";

import { haptic } from "@/lib/ui/motion";

/** iOS-style switch with tactile thumb elongation while pressed. */
export function Switch({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => {
        haptic("select");
        onChange(!checked);
      }}
      className={`group relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? "bg-brand-solid" : "bg-surface-track"
      }`}
    >
      <span
        data-motion="slide"
        className={`absolute left-0.5 top-0.5 h-[27px] w-[27px] rounded-full bg-white shadow-[0_2px_4px_rgb(74_18_40/0.22)] transition-[transform,width] duration-200 ease-[var(--ease-ios)] ${
          !disabled ? "group-active:w-[31px]" : ""
        } ${
          checked
            ? !disabled
              ? "translate-x-5 group-active:translate-x-4"
              : "translate-x-5"
            : "translate-x-0"
        }`}
      />
    </button>
  );
}
