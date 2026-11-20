# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Next.js (App Router, TypeScript, Tailwind CSS), Prisma + PostgreSQL (built-in local Postgres via `npx prisma dev` for dev, Neon/Supabase Postgres for Vercel production), Vercel Blob (with local disk fallback in dev), Vercel Schedules (`Asia/Manila`), and Telegram Bot API (free). Zero AI/LLM API keys required for V1.

## Users

1. **Primary User — Store Owner (Kyna Clothing Shop / `kynaph`):**
   - Runs 1 Shopee PH store + 1 TikTok Shop PH store selling fast-moving women's fashion (skirts, shorts, t-shirts) at **400 parcels/day minimum (lowest day)** and up to **2,000 parcels/day on peak sale days**.
   - **Non-tech-savvy and mobile-only:** Does not want to use a computer for daily work. Checks everything on her smartphone between warehouse shifts, live selling, and courier drop-offs.
   - **Core job:** Know in 3 seconds every day (without checking orders 1-by-1) how many parcels were digitally tagged as returns today, how many the courier claims were returned today, how many actually physically arrived at the warehouse today, and which parcels are missing or need dispute action—with **Failed Delivery** strictly separated from **Return / Refund**.
2. **Secondary Users — 6 Warehouse Packers / Receiving Staff:**
   - Use their personal Android/iPhone browsers at the receiving table (`/scan`) when J&T / SPX / Flash Express riders drop off returned sacks.
   - Unlock quickly with a 4-digit PIN + tap their name, scan waybills with the phone camera, confirm the **product photo + color/size** (to catch damaged or swapped-item scams), and snap photo proof—without ever seeing peso or profit numbers.

## Product Purpose

Eliminate the daily blind spot and manual 1-by-1 checking of returns across Shopee PH and TikTok Shop PH by reconciling three exact `Asia/Manila` (UTC+8) timestamps per parcel:
1. **Digitally Tagged Today** (driver tagged failed delivery / RTS, or buyer filed return/refund today).
2. **Courier Claims Returned Today** (courier marked "Delivered back to Seller" today).
3. **Actually Received Today** (staff physically scanned the parcel back in at the warehouse today).

Success means the owner opens **Kyna Ops** on her phone (or checks Telegram) and immediately trusts today's numbers for both **Failed Delivery** and **Return / Refund**, catches missing courier-claimed parcels before losing money, and never has to open a laptop or maintain SKUs.

## Positioning

Unlike BigSeller or Seller Center—which bury return dates under order creation dates, lump Failed Delivery with Buyer Returns, assume desktop spreadsheets and SKU maintenance, and rely blindly on courier status—**Kyna Ops** is a mobile-first, zero-SKU daily return truth engine built specifically for fast-moving Philippine fashion sellers on Shopee and TikTok Shop.

## Operating Context

- **Stores:** 1 Shopee PH (`kynaph`) + 1 TikTok Shop PH.
- **Catalog reality:** Fast-moving fashion items with **no SKUs**; items are identified by **Product Thumbnail Photo + Item Name + Color/Size Variation**.
- **Unit economics:** Flat default **₱82 cost** (*puhunan*) and **₱199 selling price**, with optional manual overrides later.
- **Warehouse hardware:** 1 shared Windows PC, 1 thermal printer, **0 USB barcode scanners** (scanning happens on staff smartphones via PWA camera).
- **Couriers:** SPX Express, J&T Express, Flash Express (Philippines).
- **Timezone:** Strictly `Asia/Manila` (UTC+8) calendar day boundaries.
- **Messaging:** Free Telegram Bot for 8:00 PM daily summaries, instant commands (`/today`, `/failed`, `/returns`, `/missing`, `/overdue`), and urgent missing/damaged alerts.

## Capabilities and Constraints

- **V1 Scope:**
  - Owner mobile-first dashboard with Today/Yesterday/7-Day Manila-time date switching and strict **Failed Delivery** vs. **Return / Refund** separation across all 3 timestamps + automatic **"Courier Marked Returned, Not Scanned Yet"** discrepancy queue.
  - Staff mobile PWA phone-camera barcode scanner (`/scan`) with 4-digit PIN + name picker, product photo/color/size verification, condition buttons, damage photo upload, and strict redaction of all peso/cost fields.
  - Real Shopee Open Platform v2 & TikTok Shop Open API connectors (OAuth + Webhooks + 15-min polling), plus Shopee/TikTok/BigSeller CSV/XLSX upload and a realistic `kynaph` demo simulator for Day-1 use while API approvals complete.
  - 1-click structured Shopee/TikTok dispute appeal generator (template-based, zero AI cost).
  - Free Telegram Bot with 8:00 PM Manila scheduled brief and instant commands.
- **Language & Copy:** **Plain simple English only**—short everyday words, zero technical/ERP jargon.
- **Explicit V1 Non-Goals (Deferred to V2):** Automated silent thermal label printing (Windows Print Agent), full Escrow/Settlement cash-basis accounting, and LLM/AI API integration.

## Brand Commitments

- **Product Name:** `Kyna Ops` (for Kyna Clothing Shop / `kynaph`).
- **Voice:** Calm, clear, plain everyday English built for a busy non-tech-savvy shop owner on her phone.
- **Visual Direction (User-Locked Canon):** Clean Merchant Standard — crisp white cards on a soft mist-slate ground, calm teal (`#0F766E`) primary accent, bold high-contrast tabular numerals, unmistakable crimson Missing Parcel alert banner, big 48px+ mobile thumb targets, bottom tab bar navigation, and zero visual clutter (executed at the craft bar of Shopify Mobile, Square, and modern PH merchant tools).

## Evidence on Hand

- Confirmed store identity: `Kyna Clothing Shop` (`https://shopee.ph/kynaph`), 1 Shopee PH + 1 TikTok Shop PH store, ~400 parcels/day normal (up to 2,000/day peak), 6 staff, ₱82 unit cost / ₱199 selling price.
- Shopee Open Platform & TikTok Shop Partner Center (`Kyna Ops Hub`) In-House Developer applications currently under review.
- Local demo/simulator data must be clearly labeled as demo/sample until live OAuth tokens or real CSV/XLSX exports are connected.

## Product Principles

1. **Phone-First, Zero-Laptop:** Every owner workflow—checking today's returns, investigating missing parcels, copying a dispute appeal, even importing exports—must work effortlessly with one thumb on a smartphone.
2. **Plain English Over ERP Jargon:** Never force a non-tech-savvy owner to decode codes like `TO_RETURN`, `LOGISTICS_DELIVERY_DONE`, or `SKU`. Use clear everyday words like *Failed Delivery*, *Buyer Return*, *Driver Tagged Today*, *Arrived Today*, and *Missing*.
3. **Separate Truths, Never Blend Them:** Always keep *Failed Delivery* distinct from *Buyer Return / Refund*, and always keep *what the courier claims* distinct from *what staff physically scanned*.
4. **Photo First for Zero-SKU Fashion:** Where traditional tools show SKU codes, show the garment photo + color/size variation immediately so staff spot wrong or swapped items in 2 seconds.
5. **Fast, Honest, Zero-Noise:** Every number reflects audited `Asia/Manila` timestamps; discrepancies and missing parcels surface first so the owner acts before dispute windows expire.

## Accessibility & Inclusion

- Designed for a non-tech-savvy mobile user and warehouse staff scanning parcels in bright/mixed warehouse lighting: minimum 44–48px touch targets, high-contrast legible numerals (`tabular-nums`), clear color + icon + text state pairing (never color alone), and short plain-English labels.
