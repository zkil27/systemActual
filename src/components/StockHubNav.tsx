"use client";

import Link from "next/link";
import { haptic } from "@/lib/ui/motion";

const ITEMS = [
  { id: "items", href: "/items", label: "Stock" },
  { id: "listings", href: "/listings", label: "Prices" },
  { id: "restock", href: "/restock", label: "Restock" },
] as const;

export function StockHubNav({ active }: { active: "items" | "listings" | "restock" }) {
  return (
    <nav
      aria-label="Stock sections"
      className="grid h-11 grid-cols-3 rounded-[var(--radius-control)] bg-surface-track/80 p-[3px] lg:hidden"
    >
      {ITEMS.map((item) => {
        const isCurrent = item.id === active;
        return (
          <Link
            key={item.id}
            href={item.href}
            aria-current={isCurrent ? "page" : undefined}
            onClick={() => {
              if (!isCurrent) haptic("select");
            }}
            className={`pressable flex items-center justify-center rounded-[9px] px-2 text-[15px] transition-colors ${
              isCurrent
                ? "bg-surface font-bold text-ink shadow-[0_1px_3px_rgb(15_23_42/0.12),0_1px_1px_rgb(15_23_42/0.04)] dark:ring-1 dark:ring-white/10"
                : "font-semibold text-ink-2 hover:text-ink active:opacity-60"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
