# Kyna Ops roadmap

Shared plan for every agent and developer working in this repo. Read it before
planning or building a feature. When you finish part of a phase, update the
status table and that phase's "Open" list in the same change.

Last updated: 2026-11-27.

## Status

| Phase | Theme | Status |
|---|---|---|
| 1 | Return truth, item by item, plus foundations | Live on `main` (migrations deployed) |
| 2 | Profit per order | Live on `main` (TikTok fee mapping fix on `dev`) |
| 3 | Restock and suppliers | Live on `main` (migrations deployed) |
| 4 | Chats on both shops, safe auto-replies | Live on `main` (Shopee chats coming soon) |
| 5 | Listings and prices in one place | Live on `main` (migrations deployed) |
| Dev tools | Developer section (`/dev`), developer only | Live on `main` (`DEVELOPER_EMAILS` set) |
| Ongoing | Maintainability | Backlog below |

Suggested order: 3, 4, 5. Phase 5 is last because it writes to the live listings.

## Constraints

- **One seller** (Kyna: 1 Shopee PH + 1 TikTok Shop PH, 400 to 2,000 parcels a day, 6 staff). It must be able to take more shops per platform, and maybe Lazada or Shopify, later. It is not a multi-seller SaaS.
- **$0 budget.** Free tiers only. The paid upgrades listed at the end are for the developer to propose to the client later; don't build anything that needs them.
- **Free Postgres is 500 MB.** Every new table needs a retention rule. Keep per-order detail for a limited time and roll it up into small tables kept permanently (see `OrderFinance` → `FinanceMonth`).
- **Vercel Hobby** runs scheduled jobs at most once a day. Background work runs in the worker tick (`src/lib/worker/tick.ts`), triggered by the warehouse PC agent, webhooks, and the optional Supabase `pg_cron` heartbeat (`docs/cutover.md`, step 1b).
- **The tick has a 90 s budget**, and every step must respect its deadline (`hasTime`, `sliceDeadline`).
- **Phone-first**, plain everyday English, owner on a phone, staff on phones at the scan table. Staff never see pesos (`redactParcelForStaff` in `src/lib/auth.ts`, test `src/lib/__tests__/staff-redaction.test.ts`).
- **Release notes** follow `AGENTS.md`.

## How automation stays under the owner's control

Apply this to every phase.

- **Gate by risk.** Run automatically only what's cheap to reverse: syncing, alerts, drafts, stock pushes inside a buffer. Anything that moves money, talks to buyers, or can't be undone goes through preview, then approve. Waves already work this way.
- **Log every change** in `AuditLog` via `recordAudit` (`src/lib/audit.ts`). The actor is the owner, the staff member, or `systemActor("<job>")`. Give actions an undo where you can (scans have a 5-minute undo).
- **Give every automation a visible switch** in Settings. Don't add switches that live only in environment variables.
- **Keep the staff screens light.** Default to the common case, ask only about exceptions, no typing, no item barcodes. The owner fixes mistakes later, not staff.

## Data model rules

For every new table:
- Add `createdAt` and `updatedAt`.
- Use a real foreign key where today the code keeps a bare string id.
- Store money as `Decimal`.
- Add a retention rule.
- Test any derived logic with a pure function.

Migrations must be additive, so the code live on `main` keeps working before it's redeployed. Generate the SQL offline:

```
npx prisma migrate diff --from-schema-datamodel <old schema> --to-schema-datamodel prisma/schema.prisma --script
```

Never run `prisma migrate dev` against the database in `.env`; it's shared with production. To check things against a real database, use a throwaway local one (`npx prisma dev --name <x>`, with `pgbouncer=true` in the URL).

## Phase 1: return truth, item by item (done)

The client's original pain: she couldn't tell whether a return was all there or only marked as returned.

What exists:
- **Data:** `ReturnItemCheck`, one row per expected line per scan. It holds good, damaged, wrong and missing counts, plus a price snapshot. `ReturnParcel` has pieces summary fields (`piecesGood`, `piecesMissing` and so on); `null` means an old, parcel-level-only scan. `PhysicalScan` gained `packagingTorn` and `checkMs`.
- **Rules:** `src/lib/returns/item-check.ts`, used by the server, restock, reports and dispute messages. The phone-side copy is `src/lib/ui/item-check-ui.ts`. A one-piece parcel takes its check from the condition staff tap. Parcels with more pieces default every item to Received.
- **Staff screen:** `src/components/scan/ReturnItemCheck.tsx`, used by `src/app/scan/ScanClient.tsx`. It is also reused for the owner's "Fix items".
- **Restock:** `syncReturnRestock` (`src/lib/stock/ledger.ts`) puts back only good pieces.
- **Owner side:**
  - Filters Partial return, Wrong item, and Refunded, not back (`src/lib/returns/rules.ts`).
  - The Return check card (`src/components/returns/ReturnCheckCard.tsx`).
  - "Who did what" in the parcel sheet, item lines in the dispute message, and chips on Today, in the 8 PM brief and in `/returns`.
- **Foundations:**
  - `AuditLog`.
  - The `IntegrationEvent` webhook inbox (`src/lib/integrations/inbox.ts`): stored before handling, duplicates dropped, retried by the tick.
  - The tick lease is now longer than `maxDuration`; tail steps respect the deadline.
  - Print jobs stop after 5 tries.
  - CI in `.github/workflows/ci.yml`.

Open:
- [x] Apply the migrations to Supabase: `npm run db:deploy` (all 33 migrations applied).
- [x] Background heartbeat running: Vercel Schedules (`*/15 * * * *`) fixed with `CRON_SECRET` on Production and verified `ok: true` (`trigger: "schedule"`), alongside the warehouse PC agent (`trigger: "agent"`) and webhooks. Optional Supabase `pg_cron` (`docs/cutover.md`, step 1b) is still available if 5-minute ticks are needed while the PC is off.
- [ ] Confirm the return item price fields with `npm run capture:live`: TikTok `return_line_items[].refund_amount.refund_total` confirmed live; Shopee `item_price` still pending once Shopee switches from sandbox to live.
- [ ] Look at the new screens on a phone while signed in: `/scan` with a 3-piece return, and the parcel sheet (`/login` and `/scan` PIN screen verified clean on 390×844).
- [ ] Wrong extra items (something not expected at all) are only captured in the note and photo.

## Phase 2: profit per order (done)

What exists:
- **Data:**
  - `OrderFinance` and `OrderFinanceLine`: one per completed order, kept 120 days, not tied to `Order` (orders are deleted after 90 days).
  - `FinanceMonth` and `ItemProfitMonth`: rolled up every 30 minutes and kept permanently.
  - `Order.financeCheckedAt` and `financeSavedAt`.
- **Mapping:** `src/lib/finance/map.ts`.
  - The net payout is the trusted headline (Shopee `escrow_amount`, TikTok `settlement_amount`).
  - Named fees are matched by field name. Whatever else the shop kept goes in `otherPhp`, so the totals always add up.
  - Profit = payout − cost of the pieces the buyer kept. Pieces that came back good, found through the Phase 1 item check, aren't a cost.
- **Sync:** `src/lib/finance/sync.ts`, read-only. It asks for 40 orders per shop per tick, 3 at a time, and stops when the shop says it's throttling. Unsettled orders are asked again after 6 hours; it gives up after 45 days.
- **Report:** `src/lib/finance/report.ts`. The last 3 months are summed live; older months come from the rollups.
- **Screens:**
  - `src/app/profit/page.tsx`, linked under Money on Today and in the sidebar.
  - `GET /api/profit`, and `?format=csv` for the bookkeeper.
  - Telegram `/profit` (`src/lib/finance/telegram.ts`).

Open:
- [ ] Run `npm run capture:live` and check `shopee-escrow.json` and `tiktok-order-statement.json`: TikTok audited across 5,932 live `OrderFinance` rows (`shipping_fee_amount` and signed refund commission reversals fixed in `src/lib/finance/map.ts`); `shopee-escrow.json` pending once Shopee is live.
- [ ] Compare 3 payouts per shop with Seller Center (`docs/cutover.md`, first-week checklist).
- [ ] Not in per-order profit yet: refunds taken back after a payout, and the courier fee on failed deliveries. Both are in Money adjustments. A later step could link them to the order.
- [ ] Confirm whether the shops' data carries the 1% withholding tax (`withholding_tax*` fields): confirmed absent on TikTok `202309` statements (0 of 5,932 orders; RR 16-2023 estimate shown as intended); Shopee pending live orders.

## Phase 3: restock and suppliers (done on dev)

Problem: "Add a delivery" at Stock-in is a free-text note (`StockReason.SUPPLIER_IN`). Nothing records what was ordered, from whom, what's still due, or when to reorder.

What exists:
- **Database schema and migration:** `Supplier`, `PurchaseOrder`, `PurchaseOrderLine`, `PurchaseOrderStatus`, and `StockMovement.purchaseOrderLineId` (`prisma/schema.prisma`, `prisma/migrations/20261126040000_suppliers_and_restock/migration.sql`).
- **Owner Restock & suppliers screen (`src/app/restock/page.tsx`, `src/app/api/restock/route.ts`):** supplier list with lead times, purchase order creation and status tracking (`DRAFT`, `ORDERED`, `PARTIAL`, `RECEIVED`, `CANCELLED`), owner receiving, cost-change confirmation prompts before updating `Garment.unitCostPhp`, and lead-time-aware "Reorder soon" suggestions subtracting open PO quantities.
- **Light staff receiving (`src/app/stock-in/StockInClient.tsx`, `src/components/stock-in/ReceivePoPanel.tsx`, `src/app/api/stock-in/route.ts`):** staff pick open supplier deliveries (with all peso costs stripped via `redactPurchaseOrderForStaff`) and tap only short or damaged exceptions, writing idempotent `SUPPLIER_IN` movements and triggering immediate shop stock pushes.
- **Telegram:** 8 PM daily brief includes a "Reorder soon" / overdue PO line (`src/lib/reports/brief.ts`, `daily-brief.ts`), and `src/lib/reports/alerts.ts` sends `OVERDUE SUPPLIER ORDERS` alerts keyed `po:overdue:<id>`.

Open:
- [x] Apply `prisma/migrations/20261126040000_suppliers_and_restock/migration.sql` to Supabase Postgres (applied).
- End-to-end verification of Restock & PO receiving in the UI once signed in.
- Variants still need linking across shops (`ListingVariant` → `GarmentVariant`) so unlinked listings combine into one reorder line.

Data & retention:
- `Supplier`, `PurchaseOrder`, `PurchaseOrderLine`, and nullable `StockMovement.purchaseOrderLineId`.
- Orders are small, so keep them permanently or for 2 years.

## Phase 4: chats on both shops, safe auto-replies (done on dev — Shopee coming soon)

Problem:
- Only TikTok chats are connected (`src/lib/chats/*`). The Shopee tab stays "Coming soon" (`chatsComingSoon` in `src/lib/chats/format.ts`) while the Shopee Open Platform live review is pending (test API only). The sample data (demo shops, sample chats and returns) was removed on 2026-11-26.

What exists:
- **Settings switches replacing env-only gates (`AiSettings.chatSendEnabled`, `autoSendEnabled`, `approvalQueueEnabled`):** in Settings → Chats assistant (`src/app/settings/assistant/page.tsx`, `src/lib/ai/settings.ts`, `src/lib/chats/source.ts`), with env allowlists (`CHAT_SEND_TIKTOK`, `AI_AUTOSEND_TIKTOK`) preserved for safe single-buyer testing while global switches stay off. All changes log to `AuditLog`.
- **Safe background auto-reply (`src/lib/ai/auto-reply.ts`, hooked into `src/lib/worker/tick.ts`):** only auto-sends TikTok topics set to `Auto` that pass safety rules (`withAutoLabel`), skipping Shopee (`Coming soon`), returns/refunds/complaints, media-only turns, `needsCheck`, `handoff`, `needsOwner`, and 2h human-reply cooldowns; logs to `AiEvent` and `AuditLog` (`systemActor("chat-assistant")`).
- **General Approval Queue (`ActionRequest` + `src/lib/approvals/*`, `src/app/approvals/page.tsx`, `/api/approvals`):** draft or uncertain AI replies queue into `ActionRequest`, send Telegram 1-tap `Approve & send` / `Reject` inline buttons (`src/app/api/telegram/webhook/route.ts`), support `/approvals` on Telegram, and prune non-pending rows after 60 days (`src/lib/worker/prune.ts`).

Open:
- [x] Apply `prisma/migrations/20261126050000_phase4_chat_controls_and_approvals/migration.sql` to Supabase Postgres (applied).
- When Shopee approves live access: implement Shopee Open Platform seller chat sync/send, make `chatsComingSoon` return false for connected live Shopee shops, and drop "Coming soon" on Upload (`src/app/imports/page.tsx`).

Data & retention:
- `AiSettings` controls + `ActionRequest` (`PENDING` expires in 24h; decided/expired rows pruned after 60 days).

## Phase 5: listings and prices in one place (done on dev)

Problem: prices and listings were only edited in each Seller Center separately. Product data was read-only in the app, apart from stock and Shopee Auto-Bump.

What exists:
- **Database schema & migration (`prisma/schema.prisma`, `prisma/migrations/20261126060000_phase5_listings_and_prices/migration.sql`):** added `ChannelProduct` (parent title, description, category, images, price range per shop listing), `PriceChange` & `PriceChangeStatus`, and `ListingVariant` price push tracking (`channelProductId`, `pricePhp`, `pricePushedPhp`, `pricePushedAt`, `pricePushError`).
- **Read-only catalog import enhancement (`src/lib/catalog/import.ts`, `import-map.ts`):** populates `ChannelProduct` metadata and per-variation prices during normal shop imports without modifying existing stock sync contracts.
- **Channel connector write actions (`src/lib/channels/shopee.ts`, `tiktok.ts`):** `pushListingPrices` and `createDraftListing` (`UNLIST` on Shopee, `AS_DRAFT` on TikTok).
- **Listings & prices screen & Approval Queue execution (`src/app/listings/page.tsx`, `src/app/api/listings/route.ts`, `src/lib/listings/*`, `src/lib/approvals/service.ts`):** owner compares Shopee/TikTok prices side by side, proposes a price update or cross-shop draft copy through the `ActionRequest` Approval Queue (in `/approvals` or 1-tap Telegram), pushes strictly when `ShopConnection.writesEnabled` is enabled, logs `PriceChange` + `AuditLog` history, and supports retrying failed/skipped pushes.

Open:
- [x] Apply `prisma/migrations/20261126060000_phase5_listings_and_prices/migration.sql` to Supabase Postgres (applied).
- Optional future enhancement: searchable Shopee/TikTok category & attribute pickers instead of entering a destination category ID manually.

## Developer tools: `/dev` (done on dev)

Problem: Vercel Hobby keeps runtime logs for 1 hour and Supabase Free for 1 day, nothing measured the database against the 500 MB quota, and there was no way to see slow worker steps, failed webhooks or throttling without reading code.

Who sees it: only owner accounts whose email is in `DEVELOPER_EMAILS` (`src/lib/dev/access.ts`, re-checked against the database on every request). Everyone else gets a 404, and the Settings row ("Developer tools") is hidden. Don't list the shop owner's account.

What exists:
- **Overview:** traffic-light cards (`src/lib/dev/overview.ts`) for database size, new error kinds, last tick, webhook inbox, backup age, pending migrations, shop tokens, 429s and maintenance.
- **Database** (`src/lib/dev/db-health.ts`, fixed read-only SQL only):
  - Database size against 500 MB, and data + WAL against the 2 GB disk.
  - Per-table size, rows, dead rows, autovacuum and retention rule. The rules live in `src/lib/dev/retention-map.ts`, and a test fails when a model isn't listed.
  - Cache hit ratios, unused indexes, foreign keys without an index, and connections.
  - Long-running queries, plus the top `pg_stat_statements` with a reset.
  - A check for tables Supabase's Data API (anon/authenticated) can read with RLS off.
- **Errors:** an `AppError` table, grouped by fingerprint (`src/lib/dev/errors.ts`). It's fed by:
  - Next's `onRequestError` (`src/instrumentation.ts`).
  - Worker step failures (`tickError` in `src/lib/dev/tick-recorder.ts`).
  - Browser errors (`<ClientErrorReporter />`, `src/app/error.tsx`, `src/app/global-error.tsx` → `POST /api/client-errors`).
- **Jobs:**
  - A `WorkerRun` per tick, with step timings from `withSpan`.
  - `ApiCallStat` counts per hour, platform, shop and endpoint from `fetchWithRetry`. They're collected in memory (`src/lib/dev/tick-context.ts`) and written once per tick.
  - Failed or stuck webhook events with Retry, shop token expiry with "Refresh token", failed print jobs, and AI usage against daily caps.
- **Controls** (all audited as `dev.*`):
  - Run a tick, the worker pause switch (`AppSettings.workerPaused`), and the maintenance banner (`maintenanceMessage`/`maintenanceUntil`, served on `/api/version`).
  - Test errors, build info, and migrations in this build vs `_prisma_migrations` (`EXPECTED_MIGRATIONS` in `next.config.ts`).
  - Env var names set or missing, and backup details.
- **Owner stays in control:** a paused worker shows as "Paused by the developer" and maintenance shows as a warning in Settings › Health.
- **Retention:** `AppError` is kept 30 days after it was last seen, `WorkerRun` 3 days and `ApiCallStat` 30 days, all in `pruneDailyData()`.

Open:
- [x] Apply `prisma/migrations/20261127010000_developer_tools/migration.sql` to Supabase and set `DEVELOPER_EMAILS` on Vercel (done; Vercel Blob store `kyna-ops-media` also linked so proof/chat photo uploads work on Vercel).
- Errors that a route catches itself and returns as a 500 aren't recorded. Only uncaught ones are. Call `recordError()` in catch blocks that matter.
- API call counts only cover worker ticks, not owner button presses.
- Later (all $0):
  - `index_advisor` suggestions next to slow queries.
  - A GitHub Actions `pg_dump` off-site backup, since today's backup needs the warehouse PC on.
  - Web vitals (75th percentile per route) from staff phones.
  - A staging project on the second free Supabase slot, with seed data.
  - A read-only "view as staff" preview.
  - Vercel usage numbers via its API.
- [x] Check: `vercel.json` uses Vercel Schedules (`*/15 * * * *`), which IS supported on Hobby (15-min cadence/jitter). Fixed missing `CRON_SECRET` on Vercel Production (previously 426/426 runs failed with 401) and verified `worker-tick` succeeds end-to-end.

## Ongoing: maintainability backlog

Ranked by how much each one helps future phases.

1. **Finish migrating onto `ChannelConnector`.** `ChannelConnector` (`src/lib/channels/`) now powers single-order sync, batch order window sync (`fetchOrdersWindow` in `src/lib/ledger/sync.ts`), finance sync, stock/price pushes, draft listings, and token refresh. Remaining paired files (`returns/sync.ts`, `shipping/shopee-engine.ts` / `tiktok-engine.ts`, `chats/*`) can move onto it next.
2. **Use `Order.state` across queries.** Done for `garments.ts`, `stock/ledger.ts`, `stock/rules.ts`, `orders/lookup.ts`, and `returns/classify.ts` (with raw-status fallbacks preserved for pure helpers/tests).
3. **More than one shop per platform.**
   - `startWave()` scopes `writesEnabled` by `shopConnectionId`.
   - `committedUnitsByListing` (`src/lib/catalog/garments.ts`, plus `stock/ledger.ts` and `restock/service.ts`) now keys by `shopConnectionId:listingId:variationId`, and `health.ts` handles multiple shops per platform with distinct ids and shop labels.
   - `Order` unique constraint `[platform, orderSn]` can be widened to `[shopConnectionId, orderSn]` only if two shops on the same platform ever collide on order numbers.
4. **Backing off when a shop throttles.** Done in `src/lib/connectors/http.ts` (429 `Retry-After` + GET 5xx retry + safe JSON errors).
5. **Splitting big screens.** Extracted `AccountSheet`, `StaffSheet`, `HealthPanel`, and `DeveloperRow` out of `src/app/settings/page.tsx` into `src/components/settings/` (~300 lines removed). Largest remaining screens: `src/app/scan/ScanClient.tsx` (~2,078 lines), `src/app/waves/page.tsx`, `src/app/items/page.tsx` (~1,000 each), `src/app/page.tsx`.
6. **Foreign keys missing (bare string ids):**
   - `OrderLine` → `ListingVariant`, `PrintJob.packageId` and `PrintJob.waveId`, `WaveItem.orderId`, `StockMovement.staffMemberId` (note: `ReturnParcel.orderSn` and `WalletTransaction.orderSn` are intentionally decoupled because `Order` rows prune after 90 days while returns and wallet history live longer).
7. **Tests:** `.github/workflows/ci.yml` runs `prisma migrate deploy` + `src/lib/__tests__/db.integration.test.ts` against Postgres 16. Added initial route-handler integration tests in `src/app/api/__tests__/route-handlers.test.ts` (logout, Telegram webhook confirm/undo/cancel, owner token versioning); more endpoints can be added incrementally.

## Known gaps, not yet fixed

- **Revoking owner sessions:** Fixed on `dev` — `OwnerUser.tokenVersion` (additive migration `20261127020000_owner_token_version`, already applied to Supabase) is checked in `getOwnerSession()`, password changes rotate tokens to sign out other devices, **Sign out all devices** was added in Settings › Your account, and `auth.ts` now re-exports JWT helpers from `session-edge.ts` (no duplication).
- **Telegram `/pause`, `/aioff` and `/sync`:** Fixed on `dev` — now show Confirm/Cancel inline buttons before acting, with a 1-tap Undo button for `/pause` and `/aioff`.
- **The dispute message template** (`src/lib/reports/dispute-template.ts`): Fixed on `dev` — preserves intentional blank paragraph lines (`line !== null`).
- **`WorkerLock` doubles as a key-value store** (sync window, stock push time, finance rollup time, Auto-Bump state). Fine for now; move the settings-like values into settings if more appear.
- **Retention rules:** Fixed on `dev` — `ReturnParcel` (closed/received non-disputed 365d), `PriceChange` (365d), and `PurchaseOrder` (received/cancelled 730d) now prune in `pruneDailyData()`, leaving zero tables with `kind: "none"` in `retention-map.ts`.
- **Hosting terms:** Vercel Hobby's terms are for non-commercial use (see below).

## Paid upgrades to propose to the client later

- **Vercel Pro** (about $20 a month): commercial use is allowed, functions can run longer, and scheduled jobs can run every minute.
- **A paid Postgres plan** with point-in-time restore. Today the PC's nightly `pg_dump` is the only backup.
- **An error tracker** (Sentry's free tier first). Developer › Errors (`AppError`) now keeps grouped errors for 30 days for free; Sentry would add alerts, source maps and breadcrumbs.
