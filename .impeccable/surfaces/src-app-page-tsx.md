---
version: 1
slug: "src-app-page-tsx"
primary_target: "src/app/page.tsx"
related_targets: ["src/app/returns/page.tsx","src/app/scan/page.tsx"]
---

# Surface Brief: Kyna Ops Mobile-First Workspace

- **Scope & Mode:** `src/app/page.tsx` (Owner Daily Dashboard), `src/app/returns/page.tsx` (Returns Explorer), `src/app/scan/page.tsx` (Staff Mobile PWA Scanner) — **Operate** mode (code-led, mobile-first `390x844` primary viewport scaling cleanly to desktop).
- **Audience & Job:** Non-tech-savvy PH fashion shop owner (`Kyna Clothing Shop`) checking today's exact digital vs. actual returns on her smartphone without touching a computer, plus 6 packers scanning returned parcels on their phones with a 4-digit PIN.
- **Constraints:** Plain simple English only; zero SKUs (show garment photo + color/size instead); strict Failed Delivery vs. Buyer Return/Refund separation; 3 `Asia/Manila` timestamps; minimum 48px thumb targets; zero peso values exposed on `/scan`.

## Direction contract

- **THESIS:** Refuse bloated desktop ERP tables and blended return counts; deliver a calm, thumb-first mobile merchant home screen that separates Failed Delivery from Buyer Return across three honest daily stages and surfaces missing parcels at the very top.
- **OWN-WORLD:** Crisp white (`#FFFFFF`) elevated cards on soft mist-slate (`#F4F7F8`) ground, calm deep teal (`#0F766E`) primary accent, amber (`#D97706`) Failed Delivery tag, cobalt (`#2563EB`) Buyer Return tag, emerald (`#059669`) Physically Arrived confirmation, and crimson (`#DC2626`) Missing Parcel triage bar. Single clean humanist sans (`Plus Jakarta Sans` or `Public Sans` / workhorse sans — use `Public Sans`) with strict `tabular-nums`, hairline borders (`#E2E8F0`), 14px card radii, and fixed 4-tab bottom mobile navigation (`Today`, `Missing`, `Scan`, `More`).
- **STORY:** Within 3 seconds on her phone, the owner sees if any courier-claimed parcels are missing, reads today's exact Failed Delivery vs. Buyer Return counts across *Driver Tagged → Driver Says Back → Arrived Today*, and taps straight into any parcel to view photo proof or copy a ready-made dispute message.
- **FIRST VIEWPORT:** Sticky white mobile top bar (`Kyna Ops` + `Sync` button + `Today / Yesterday / 7 Days` date pills); immediately below, a high-contrast crimson **Missing Parcels** triage banner (turns emerald green `"All Clear — 0 Missing"` when reconciled); two stacked clean white cards (**Failed Delivery** and **Buyer Return / Refund**) each displaying a 3-stage connected pill funnel (`Tagged Today` → `Driver Says Back` → `Arrived Today` in green) plus courier/platform breakdown footer; below the fold starts the photo-led `Needs Attention` garment list; pinned 64px 4-tab bottom navigation bar anchors thumb reach.
- **FORM:** Clean Merchant Standard (user-locked canon against Shopify Mobile, Square, and Shopee Seller craft bar), chosen via canon standing exit on safer re-roll round 3; `seed:2039b49ddaeda650`.
- **FINISH:** unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
