"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";

/**
 * Folded row that reveals more on tap. The body only renders while open, so
 * closed sections add no hidden text to the page.
 */
export function Disclosure({
  label,
  children,
  className = "",
  summaryClassName = "",
  onOpenChange,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  summaryClassName?: string;
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={className}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() =>
          setOpen((o) => {
            const next = !o;
            onOpenChange?.(next);
            return next;
          })
        }
        className={`flex w-full items-center justify-between gap-3 text-left ${summaryClassName}`}
      >
        {label}
        <ChevronDown
          className={`h-5 w-5 shrink-0 text-ink-3 transition-transform duration-200 ease-[var(--ease-ios)] ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>
      {open && <div className="anim-disclosure-in">{children}</div>}
    </div>
  );
}
