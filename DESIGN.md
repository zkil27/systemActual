---
name: Kyna Ops
description: Calm, spacious phone-first returns tracker for a Philippine fashion seller and her warehouse staff.
colors:
  ground: "#f4f7f8"
  surface: "#ffffff"
  surface-subtle: "#f8fafb"
  ink: "#0f172a"
  ink-2: "#475569"
  ink-3: "#556477"
  hairline: "#e2e8f0"
  hairline-strong: "#cbd5e1"
  brand: "#b83b6b"
  brand-hover: "#9e2d59"
  brand-soft: "#fdf2f6"
  missing: "#dc2626"
  missing-ink: "#991b1b"
  missing-soft: "#fef2f2"
  arrived: "#047857"
  arrived-soft: "#ecfdf5"
  failed: "#b45309"
  failed-soft: "#fef3c7"
  refund: "#1d4ed8"
  refund-soft: "#dbeafe"
typography:
  large-title:
    fontFamily: "Public Sans, system-ui, sans-serif"
    fontSize: "34px"
    fontWeight: 800
    lineHeight: 1.1
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Public Sans, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 800
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  stat:
    fontFamily: "Public Sans, system-ui, sans-serif"
    fontSize: "34px"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Public Sans, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.4
  row-title:
    fontFamily: "Public Sans, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.35
  caption:
    fontFamily: "Public Sans, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.35
rounded:
  control: "12px"
  card: "16px"
  sheet: "22px"
  full: "9999px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "20px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "#f4a7c1"
    textColor: "#4a1228"
    rounded: "{rounded.control}"
    height: "48px"
  button-primary-hover:
    backgroundColor: "#ee92b2"
  button-secondary:
    backgroundColor: "#f1f5f9"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    height: "48px"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.card}"
    padding: "20px"
  missing-status:
    backgroundColor: "{colors.missing}"
    textColor: "{colors.surface}"
    rounded: "{rounded.card}"
    padding: "16px 20px"
  segmented-control:
    backgroundColor: "#e2e8f0b3"
    rounded: "{rounded.control}"
    height: "44px"
  sheet:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.sheet}"
  tab-bar:
    backgroundColor: "#ffffffd9"
    height: "60px"
  keypad-key:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.full}"
    size: "72px"
---

# Design System: Kyna Ops

## Overview

Kyna Ops is an Operate surface: a shop owner checks it between live selling and courier drop-offs, and six packers use it at the receiving table. It follows Apple's interface conventions without copying iOS chrome:

- a large page title that shrinks into the top bar on scroll
- one focus per screen
- grouped white content on a soft grey ground
- 20px side margins
- bottom sheets for detail
- motion only where something changed

Each screen answers one question with as few words as possible:

- **Home:** how much money was credited, is anything missing, and what came back today? "Credited" means money in the Shopee wallet or a paid TikTok statement; orders placed are shown muted underneath because they aren't money yet.
- **Returns:** find a parcel.
- **Scan:** check this parcel in.
- **Settings:** change a rule.

Anything secondary sits one tap away in a sheet or a folded row. Nothing was removed. It moved.

The product rules stay fixed:

- Failed delivery and Buyer return are always separate.
- All three stages (Tagged or Requested, Sent back, Arrived) are visible on Home.
- Garment photos lead every row.
- Staff on `/scan` never see peso values.
- Labels are plain English.

## Colors

The palette follows the Clean Merchant Standard in both light mode and an optional dark mode (`Light` / `Dark` / `Auto` under **Settings → Appearance**). Color carries meaning only. It is never decoration.

| Token | Light | Dark | Role |
| :--- | :--- | :--- | :--- |
| `ground` | `#f4f7f8` | `#09090b` | Page canvas, bars at rest |
| `surface` | `#ffffff` | `#121215` | Cards, grouped lists, sheets, keypad keys |
| `surface-subtle` / `surface-muted` / `surface-track` | `#f8fafb` / `#f1f5f9` / `#e2e8f0` | `#18181c` / `#1f1f24` / `#27272d` | Row hovers, input wells, segmented tracks |
| `ink` / `ink-2` / `ink-3` / `ink-inverse` | `#0f172a` / `#475569` / `#556477` / `#ffffff` | `#f4f4f5` / `#d4d4d8` / `#9a9aa4` / `#09090b` | Text: primary, secondary, muted, inverse pills |
| `hairline` / `hairline-strong` | `#e2e8f0` / `#cbd5e1` | `#242429` / `#36363e` | Inset row separators and chip outlines |
| `brand` / `brand-solid` / `on-brand` | `#b83b6b` / `#f4a7c1` / `#4a1228` | `#e8a4bc` / `#e89bb6` / `#3d0f21` | Text/links (`brand`), pastel pink solid fills (`brand-solid`), and rose-berry text (`on-brand`) |
| `missing` / `missing-solid` | `#dc2626` / `#dc2626` | `#e58b90` / `#99333a` | Missing text/dots and crimson Missing status card |
| `arrived` / `arrived-solid` | `#047857` / `#047857` | `#6fc4a0` / `#1e664b` | "Arrived" numbers, scan-saved card, progress fill |
| `failed` / `failed-ink` / `refund` | `#b45309` / `#92400e` / `#1d4ed8` | `#e2b46d` / `#edd09a` / `#8cb4e8` | Failed delivery / overdue / Buyer return accents |

- Status always pairs color with a dot and a word (`StatusText`, `StatusPill`).
- Secondary text on a colored fill uses white or a tint of that hue, never grey.
- Theme selection is stored in `kyna:theme` (`localStorage`), initialized synchronously in `<head>` before first paint to prevent light/dark flash, and transitions surfaces gently over 200ms when switched in Settings.

## Typography

- **Font:** Public Sans (400, 500, 600, 700, 800), self-hosted by Next's font loader.
- **Numerals:** every count, PIN digit, tracking number and peso value uses `tabular-nums`.

Fixed pixel scale, modelled on iOS text styles:

| Style | Size / weight | Use |
| :--- | :--- | :--- |
| Large title | 34 / 800 | One per screen |
| Stat | 34 / 800 | The 3 stage numbers on each category card |
| Status number | 44 / 800 (56 on desktop) | The Missing count |
| Title | 20 / 800 | Section and sheet headings |
| Body | 17 / 400 | Settings rows, Most returned row |
| Row title | 16 / 600 | Parcel rows |
| Caption | 15 / 400 | Second line of a row, helper lines |

Inputs are 16px or larger, which stops iOS from zooming in on focus.

## Layout

- **Phone & tablet (`< 1024px`):**
  - 20px side margins and 32px between sections.
  - A 48px top bar holds icon actions. It's transparent at rest, and turns white at 80% with blur and a hairline once the large title scrolls under it.
  - A 60px translucent tab bar holds Today, Missing, Scan and More, with safe-area padding.
- **Desktop (`>= 1024px`):**
  - A fixed 240px left sidebar replaces the bottom tab bar, grouped into Today, Returns (with the Missing badge) and Scan; Items & stock, Waves & pick lists and Upload a file; and Settings pinned at the bottom.
  - A 64px sticky top bar holds page actions and the compact title once the large title scrolls under it.
  - Content sits at `max-w-3xl` by default (Items, Upload) or `max-w-6xl` (`width="wide"`):
    - **Today:** 12-column grid — Money credited (5) next to Missing (7); Failed delivery and Buyer return side by side (6 / 6); To check up to 8 rows (7) next to an inline top-5 Most returned list (5).
    - **Returns:** Two-pane master–detail — filter bar and parcel list on the left alongside a sticky 420px (`xl`: 460px) parcel panel on the right, with `/`, `↑`, `↓` and `Esc` keyboard shortcuts.
    - **Settings:** Two equal columns — Stores and Printer on the left; Costs, Telegram, Warehouse staff and Sign out on the right.
    - **Waves:** 400px controls column on the left and the latest wave and pick groups on the right.
  - Scan, Stock-in and Login stay phone-width.
- **Home-screen app:**
  - `display: standalone` manifest with 192, 512 and maskable icons, generated in code.
  - Both `mobile-web-app-capable` and `apple-mobile-web-app-capable` tags, plus `viewport-fit=cover`.
  - `.safe-top` and `.safe-bottom` pad around the notch and home indicator.
  - The status bar style is `default`, which gives dark text over the white header. `black-translucent` would make the clock white against a light UI.
- **Touch targets:** 44px minimum. Rows are 52–76px. The scanner's keypad keys are 72px.

## Elevation & Depth

Shadows always have an offset and a soft blur. There are three levels:

- `--shadow-card`: resting cards and grouped lists.
- `--shadow-float`: hover lift and the toast.
- `--shadow-sheet`: bottom sheets.

The Missing card and the scanner's main button use a tinted shadow in their own hue. Blur is used for bar material only: the top bar once collapsed, and the tab bar.

## Shapes

- Radii: 12px for controls and inputs, 16px for cards, 22px for sheets and the scanner tile. Fully rounded for pills, segmented thumbs, keypad keys and switches.
- Grouped lists use inset separators that start at the text, so the photos read as one column.

## Components

Shared building blocks live in `src/components/ui/`:

- **Button / ButtonLink:** primary, secondary, plain and danger variants, 48px (md) or 56px (lg) tall. All use `.pressable`.
- **Group / SectionHeader:** the white grouped container, and a title with an optional trailing link.
- **SegmentedControl:** equal-width segments. A white thumb slides under the selection, and it fades out when a custom date is picked.
- **Sheet:** a bottom sheet on phones and a centred panel on desktop.
  - Slides up. Closes on a downward swipe of the handle (`shouldDismiss`), a backdrop tap, the close button or Escape.
  - Focus moves into the sheet, stays there on Tab, and goes back to where it was on close. Body scroll is locked while open.
  - It keeps its last content while sliding away.
- **Disclosure:** a folded row whose body renders only while open and slides down softly (`.anim-disclosure-in`).
- **Switch:** an iOS-style toggle whose white thumb elongates slightly while pressed.
- **AnimatedNumber:** counts to each new value over 400ms with ease-out-expo (including `MoneyCard` peso totals and `Waves` counts). Screen readers get the final value.
- **ItemThumb:** the garment photo in sm, md, lg and xl sizes, with a shirt icon as fallback.
- **StatusPill / StatusText:** one status per parcel from `getParcelStatus`. Priority is Missing, then Issue, Arrived, Overdue and On the way.
- **Toast:** a single dark capsule under the top bar that rises in, pops its icon, and eases out after 2.6s (`.anim-toast-out`). It replaces the old inline notice banners.
- **Pull to sync (`PullIndicator` + `usePullToRefresh`):** pull down from the top of any page to sync, the way a phone browser refreshes. Pages opt in with `AppShell onRefresh`.
  - Touch only. It starts only at scroll top, never inside a sheet or a field, and lets sideways drags through to chip rows.
  - It fires past 72px of finger travel with one vibration tick. A white capsule drops from under the top bar: "Pull to sync" → "Release to sync" → "Syncing…" → check.
  - The browser's own pull-to-reload is off (`overscroll-behavior-y: contain` on `html`).
  - On phones the top-bar sync button is replaced by a tappable "Updated 4 min ago · Pull to sync" line under the title. Desktop keeps the button.
- **ScrollChips:** every sideways chip row. The hidden side fades out and a round white chevron button pages the row along. The first row a device ever sees nudges 56px and back, once.

Composite components:

- **ParcelRow:** photo, name, then one line with status · category · size/colour, and a chevron.
- **CategorySheet:** couriers, the Shopee/TikTok split, item cost at stake, and "See parcels".
- **ParcelDetailSheet / ParcelDetailPanel:** share `ParcelDetailBody` (bottom sheet on phones and Home; sticky right-hand panel on desktop Returns):
  - photo and size pill, then status
  - a 3-stage timeline
  - one dispute action: copy, with the message itself folded
  - folded order details

## Motion

Motion follows Apple's HIG: it has a purpose, it's short, it never blocks input, and it's optional.

| Moment | Motion | Time |
| :--- | :--- | :--- |
| Press any button / card | scale 0.97 (`.pressable`) | 120ms |
| Press a list row | subtle scale 0.99 (`.pressable-row`) | 120ms |
| Hover interactive card (pointer) | 1px lift + float shadow (`.hover-lift`), trailing chevron nudges 2px (`.chevron-nudge`) | 250ms / 120ms |
| Page opens or tab switches | fade + 8px rise on `<main>`, crossfade between `/scan` modes | 250ms |
| Counts load or change | count up (`AnimatedNumber` on Home, Money credited, Waves) | 400ms |
| Missing ↔ All clear | crossfade | 250ms |
| Segmented / tab / filter selection | highlight slides (Home, Returns, Items, Pick list, Waves, Settings theme) | 200ms |
| Switch press & toggle | thumb elongates while pressed, slides across track | 200ms |
| Disclosure / pick group expand | chevron rotates, body fades & slides down (`anim-disclosure-in`) | 200ms |
| Pick list progress bar | GPU-composited `scaleX` transition | 300ms |
| Sheet open / close | slide on `cubic-bezier(0.32,0.72,0,1)` + backdrop fade | 350ms / 280ms |
| Toast arrive / leave | rise in + icon pop, then fade/lift out | 320ms / 180ms |
| Wrong PIN or wrong password | shake + Android vibration | 300ms |
| PIN dot, badge, star pin, theme icon | pop (`anim-pop`) | 260ms |
| Live online printer dot | gentle expanding ring pulse (`anim-pulse-dot`) | 2.2s |
| Scan saved | checkmark draws in on a green card + vibration; the scanner stays usable | 400ms |
| Sync | spin, then a checkmark pop + toast | — |
| Pull to sync | capsule follows the finger, icon turns with travel; settles back | 300ms |
| First chip row ever | scrolls 56px and back, once per device | ~650ms |
| Theme toggle in Settings | surface/ink colors crossfade | 200ms |

- Home attention/top lists, Imports history, Items (first load), and Returns rows (first load) stagger in softly. Filter changes swap in place.
- With `prefers-reduced-motion: reduce`:
  - Slides, scales, hover lifts, chevron nudges, and shakes turn off.
  - The page rise, disclosure drop, list rise, toast exit, and pop become plain fades.
  - Press feedback becomes an opacity dip.
  - Theme transitions snap cleanly; pulse dot stops.
  - Counts show the final value straight away.

## Do's and Don'ts

- **Do** show one number per stage with one word under it. Put the breakdown in the sheet.
- **Do** keep Failed delivery and Buyer return in separate cards, rows and sheets.
- **Do** use `StatusText` in rows and `StatusPill` in sheets, so a status reads the same everywhere.
- **Do** put helper text behind a tap, or cut it.
- **Don't** add eyebrows, icon tiles above headings, or cards inside cards. Inside a sheet, use hairline rows.
- **Do** make anything tappable look tappable: a trailing chevron on rows, cards and "See all" links, and a visible outline (`hairline-strong`) on chips. Anything not tappable shows neither.
- **Do** give every tappable thing at least a 44px hit area, even when it looks smaller (use an `after:` inset).
- **Don't** let a row scroll sideways without `ScrollChips`. A hard edge hides the options.
- **Don't** show peso values anywhere on `/scan`.
- **Don't** show demo credentials outside development. Login and `/scan` check `NODE_ENV === "development"` inline, so production builds drop the strings.
- **Don't** add motion to things people repeat all day without a state change behind it.
