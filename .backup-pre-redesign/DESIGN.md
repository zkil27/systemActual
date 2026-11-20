# Design System — Kyna Ops

This document describes the visual system built for **Kyna Ops**, a mobile-first daily returns and failed-delivery operations web app for fast-moving Philippine fashion sellers.

## Visual Direction

- **Mode:** Operate (mobile-first `390×844` primary viewport, scaling cleanly to desktop up to `max-w-4xl`).
- **World:** Clean Merchant Standard — crisp white elevated cards on a soft mist-slate ground, deep calm teal primary actions, unmistakable crimson missing-parcel triage banner, and plain everyday English labels with zero ERP jargon.
- **Physical Scene:** Bright indoor warehouse fluorescent light and daytime smartphone usage by a non-tech-savvy owner and 6 warehouse packers.

## Color Tokens

| Token | Value | Role |
| :--- | :--- | :--- |
| `--ground` | `#f4f7f8` | Page canvas |
| `--surface` | `#ffffff` | Cards, sticky header, bottom navigation, drawers |
| `--surface-subtle` | `#f8fafb` | Inset panels, breakdown footers, secondary tiles |
| `--ink` | `#0f172a` | Primary headings, tabular parcel counts |
| `--ink-secondary` | `#475569` | Body labels, stage captions |
| `--ink-muted` | `#64748b` | Timestamps, secondary metadata |
| `--border` | `#e2e8f0` | Hairline 1px card and list separators |
| `--teal` | `#0f766e` | Primary CTA buttons, active tab indicators, focus rings |
| `--teal-hover` | `#115e59` | Primary button hover state |
| `--amber-soft` / `--amber-ink` | `#fef3c7` / `#b45309` | **Failed Delivery** category badge |
| `--cobalt-soft` / `--cobalt-ink` | `#dbeafe` / `#1d4ed8` | **Buyer Return / Refund** category badge |
| `--emerald-soft` / `--emerald-ink` | `#ecfdf5` / `#047857` | **Arrived Today** verified stage & All-Clear banner |
| `--crimson` / `--crimson-soft` | `#dc2626` / `#fef2f2` | **Missing Parcels** triage alert & critical issue badges |

## Typography

- **Primary Font:** `Public Sans` (weights 400, 500, 600, 700, 800) loaded via `next/font/google`.
- **Numerals:** Strict `font-variant-numeric: tabular-nums` on every parcel count, tracking code, PIN pad, and peso estimate.
- **Scale:** Fixed rem scale tuned for mobile legibility:
  - Stage counts: `1.875rem` (`text-3xl`, 800 weight)
  - Page titles: `1.25rem` (`text-xl`, 800 weight)
  - Section headings: `1rem` (`text-base`, 800 weight)
  - Body / inputs: `0.875rem–1rem` (prevents iOS auto-zoom on form fields)
  - Compact badges & captions: `0.75rem` (`text-xs`, 600–800 weight)

## Layout & Navigation

- **Mobile (`< 768px`):** Sticky 56px top bar (`Kyna Ops` + primary action) and fixed 64px 4-tab bottom navigation bar (`Today` | `Missing` | `Scan` | `More`) with safe-area padding (`env(safe-area-inset-bottom)`).
- **Desktop (`>= 768px`):** Bottom bar hides cleanly and inline top-bar navigation expands (`Today`, `Missing`, `Scan`, `Upload`, `Settings`) inside a centered `max-w-4xl` container.
- **Touch Ergonomics:** Minimum 44–48px touch targets on date pills, filter chips, staff PIN keypad buttons (`56px`), and primary confirmation buttons (`56px`).

## Core Signature Patterns

1. **Live Missing Parcels Triage Banner:** Pinned directly below date controls. Solid crimson (`#dc2626`) with large count + `"Check"` CTA when `missing > 0`; transitions to calm emerald (`#ecfdf5`) `"All Clear — 0 Missing"` once every courier-claimed parcel is physically scanned.
2. **Separated 3-Stage Daily Truth Cards:** **Failed Delivery** and **Buyer Return / Refund** always render as distinct peer cards with an identical 3-column stage divider (`Driver Tagged / Buyer Requested` → `Driver Says Back` → `Arrived Today` highlighted in emerald).
3. **Photo-First Zero-SKU Garment Rows:** Every return list item and the `/scan` verification screen lead with a square garment thumbnail (`48px` in lists, `96px` on `/scan`) beside the item name and bold Color/Size pill so zero-SKU fast-fashion items are verified visually in 2 seconds.
4. **Role-Split Staff Scanner (`/scan`):** Isolated numeric PIN keypad + staff name picker; displays zero peso or cost fields anywhere on the screen.

## Browser Surfaces & Motion

- Custom `::selection` (`#ccfbf1` / `#134e4a`), teal `caret-color`, 2px teal `:focus-visible` ring, subtle custom scrollbars, and crisp 150ms state transitions with skeleton loaders (never centered loading spinners).
