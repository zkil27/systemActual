⚠️ DEGRADED: single-context (baseline run inside a multi-task redesign; Assessment A done in-thread, detector run separately)

# Baseline critique: Kyna Ops before the Apple-style redesign

Date: 2026-11-21. Viewport: 390×844.

## Evidence

- Source scan: `impeccable detect src/app src/components` (33 .ts/.tsx/.css files) found no regex findings. Most rules need a rendered page, so this is an undercount.
- Rendered scan: `detect --viewport 390x844` on `/login` and `/scan` (`.impeccable/baseline-detect.json`):
  - `low-contrast` (advisory): password placeholder is #90a1b9 on white, 2.6:1.
  - `straggler` (advisory): the demo-credentials line leaves "kyna1234" alone on its last line.
- Screenshots: `.impeccable/review/before/login/390x844.png` and `.impeccable/review/before/scan/390x844.png`. Owner pages redirect to `/login` without a session, so they weren't captured.

## Heuristic scores (Home + Scan)

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 3 | Missing banner is clear; sync result is an inline banner that shifts the layout |
| 2 | Match system / real world | 3 | Plain labels, but "COD / RTS", "Buyer Claim" and "Est. Cost" add jargon |
| 3 | User control and freedom | 2 | Parcel sheet has no swipe-to-close and no Escape key |
| 4 | Consistency and standards | 2 | Five different status-pill implementations across Home, Returns and Scan |
| 5 | Error prevention | 3 | PIN auto-submits; fine |
| 6 | Recognition over recall | 3 | Photo-first rows work |
| 7 | Flexibility and efficiency | 3 | Date pills plus a custom date input |
| 8 | Aesthetic and minimalist design | 1 | About 40 text elements above and around the fold on Home |
| 9 | Error recovery | 3 | Errors are plain English |
| 10 | Help and documentation | 2 | Help text is inline paragraphs on every screen |
| **Total** | | **25/40** | **Acceptable** |

## Priority issues

1. **[P1] Information overload on Home.** Each category card shows a badge, 3 stage labels, a courier breakdown, an estimated cost and a platform split. The owner has to read everything to find one number. Fix: show only 3 numbers per card and move the breakdown behind a tap. (`distill`, `quieter`)
2. **[P1] Demo credentials are visible in production.** Login shows the owner password, and `/scan` shows every staff PIN. Fix: show them only in development. (`harden`)
3. **[P1] Not a real home-screen app.** No icons; icon requests redirect to `/login`; no `viewport-fit=cover`. Saved shortcuts open with browser bars. (`adapt`)
4. **[P2] No shared vocabulary.** Hex colors are hard-coded per page, and each screen redraws pills, thumbs and buttons. (`extract`, `polish`)
5. **[P2] Motion is missing where state changes.** Numbers jump, the sheet pops in, and a wrong PIN only shows red text. (`animate`)

## Minor observations

- The "K" logo tile in the header is the icon-tile-above-heading pattern.
- The `/scan` unlock screen numbers its steps ("1. Tap your name", "2. Enter your PIN"). The layout already shows the order.
- The password placeholder contrast is 2.6:1.
