# Kyna Ops roadmap

Shared plan for every agent and developer working in this repo. Read it before
planning or building a feature. When you finish part of a phase, update the
status table and that phase's "Open" list in the same change.

Last updated: 2026-11-26.

## Status

| Phase | Theme | Status |
|---|---|---|
| 1 | Return truth, item by item, plus foundations | Done on `dev` (not on `main` yet) |
| 2 | Profit per order | Done on `dev` (not on `main` yet) |
| 3 | Restock and suppliers | Done on dev (not on main yet) |
| 4 | Chats on both shops, safe auto-replies | Done on dev (Shopee chats coming soon) |
| 5 | Listings and prices in one place | Planned |
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
- [ ] Apply the migrations to Supabase: `npm run db:deploy`.
- [ ] Set up the free heartbeat (`docs/cutover.md`, step 1b) and confirm it runs.
- [ ] Confirm the return item price fields (Shopee `item_price`, TikTok per-line `refund_amount.refund_total`) with `npm run capture:live`. Until then the value is a pro-rata split, labelled "estimate".
- [ ] Look at the new screens on a phone: `/scan` with a 3-piece return, and the parcel sheet.
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
- [ ] Run `npm run capture:live` and check `shopee-escrow.json` and `tiktok-order-statement.json`. If a fee lands in "other", add its field name to the regexes in `map.ts`.
- [ ] Compare 3 payouts per shop with Seller Center (`docs/cutover.md`, first-week checklist).
- [ ] Not in per-order profit yet: refunds taken back after a payout, and the courier fee on failed deliveries. Both are in Money adjustments. A later step could link them to the order.
- [ ] Confirm whether the shops' data carries the 1% withholding tax (`withholding_tax*` fields). If not, the screen shows an estimate labelled as such.

## Phase 3: restock and suppliers (done on dev)

Problem: "Add a delivery" at Stock-in is a free-text note (`StockReason.SUPPLIER_IN`). Nothing records what was ordered, from whom, what's still due, or when to reorder.

What exists:
- **Database schema and migration:** `Supplier`, `PurchaseOrder`, `PurchaseOrderLine`, `PurchaseOrderStatus`, and `StockMovement.purchaseOrderLineId` (`prisma/schema.prisma`, `prisma/migrations/20261126040000_suppliers_and_restock/migration.sql`).
- **Owner Restock & suppliers screen (`src/app/restock/page.tsx`, `src/app/api/restock/route.ts`):** supplier list with lead times, purchase order creation and status tracking (`DRAFT`, `ORDERED`, `PARTIAL`, `RECEIVED`, `CANCELLED`), owner receiving, cost-change confirmation prompts before updating `Garment.unitCostPhp`, and lead-time-aware "Reorder soon" suggestions subtracting open PO quantities.
- **Light staff receiving (`src/app/stock-in/StockInClient.tsx`, `src/components/stock-in/ReceivePoPanel.tsx`, `src/app/api/stock-in/route.ts`):** staff pick open supplier deliveries (with all peso costs stripped via `redactPurchaseOrderForStaff`) and tap only short or damaged exceptions, writing idempotent `SUPPLIER_IN` movements and triggering immediate shop stock pushes.
- **Telegram:** 8 PM daily brief includes a "Reorder soon" / overdue PO line (`src/lib/reports/brief.ts`, `daily-brief.ts`), and `src/lib/reports/alerts.ts` sends `OVERDUE SUPPLIER ORDERS` alerts keyed `po:overdue:<id>`.

Open:
- Apply `prisma/migrations/20261126040000_suppliers_and_restock/migration.sql` to Supabase Postgres when merging/deploying `dev`.
- End-to-end verification in the UI with a real database once deployed/running locally.
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
- Apply `prisma/migrations/20261126050000_phase4_chat_controls_and_approvals/migration.sql` (and Phase 3's migration) to Supabase Postgres.
- When Shopee approves live access: implement Shopee Open Platform seller chat sync/send, make `chatsComingSoon` return false for connected live Shopee shops, and drop "Coming soon" on Upload (`src/app/imports/page.tsx`).

Data & retention:
- `AiSettings` controls + `ActionRequest` (`PENDING` expires in 24h; decided/expired rows pruned after 60 days).

## Phase 5: listings and prices in one place (planned)

Problem: prices and listings are still edited in each Seller Center separately. Product data is read-only in the app, apart from stock and Shopee Auto-Bump.

Scope:
- **One item, both shops:** change the price (and stock) of a `Garment` once, and the app proposes the update to each linked listing. Each change goes through the `ActionRequest` approval queue, then is pushed with per-shop results and a retry.
- **Copy a listing:** copy a Shopee listing to TikTok, or the other way, as a draft. The owner reviews the title, photos, category and variants before it's created. Category and attribute mapping is the hard part.
- **Price history:** who changed what, when, and what each shop accepted.

Data:
- `ChannelProduct`: the parent listing per shop. `ListingVariant` gets a foreign key to it, so the listing name is no longer repeated per variant.
- `PriceChange`: the variant or product, old and new price, the request, and the push result per shop.

Files to start from:
- `src/lib/connectors/shopee.ts` and `tiktok.ts`.
- `src/lib/catalog/import.ts` (it already reads listings).
- `src/lib/stock/push.ts` (the pattern for pushing to both shops with per-listing status).

Risks:
- This writes to the live shops: respect `ShopConnection.writesEnabled`, and preview before anything is sent.
- TikTok product edits can trigger a new review.
- Promotions and vouchers are out of scope.

## Ongoing: maintainability backlog

Ranked by how much each one helps future phases.

1. **Finish migrating onto `ChannelConnector`.** A `ChannelConnector` interface and registry now live in `src/lib/channels/` and power single-order sync, finance sync, stock pushes, and token refresh. Remaining paired files (`sync.ts` batch windows, `returns/sync.ts`, `shipping/shopee-engine.ts` / `tiktok-engine.ts`, `chats/*`) should move onto it before Phase 4 (Shopee chats) and Phase 5.
2. **Use `Order.state` across queries.** `Order.state` (`OrderState` enum + `src/lib/ledger/state.ts`) is now added, backfilled, and populated on every write alongside raw `Order.status`. Gradually migrate remaining raw status lists (`variants.ts`, `orders/lookup.ts`, `stock/rules.ts`, `returns/classify.ts`) onto `Order.state`.
3. **More than one shop per platform.**
   - `startWave()` now scopes `writesEnabled` by `shopConnectionId`.
   - `committedUnitsByListing` still keys on `platform:listing:variation` without `shopConnectionId` (`src/lib/catalog/garments.ts`), `Order` is unique on `[platform, orderSn]`, and `health.ts` assumes one shop per platform.
4. **Backing off when a shop throttles.** Done in `src/lib/connectors/http.ts` (429 `Retry-After` + GET 5xx retry + safe JSON errors).
5. **Splitting big screens.** These are the largest: `src/app/scan/ScanClient.tsx` (about 2,078 lines), `src/app/waves/page.tsx`, `src/app/settings/page.tsx` and `src/app/items/page.tsx` (about 1,000 each), `src/app/page.tsx`. Move new UI into components.
6. **Foreign keys missing (bare string ids):**
   - `OrderLine` → `ListingVariant`.
   - `ReturnParcel.orderSn`.
   - `WalletTransaction.orderSn`.
   - `PrintJob.packageId` and `PrintJob.waveId`.
   - `WaveItem.orderId`.
   - `StockMovement.staffMemberId`.
7. **Tests:** `.github/workflows/ci.yml` now runs `prisma migrate deploy` + `src/lib/__tests__/db.integration.test.ts` against Postgres 16. Route-handler integration tests are still open.

## Known gaps, not yet fixed

- **Revoking owner sessions:** they last 30 days and can't be revoked (`src/middleware.ts`, `src/lib/session-edge.ts`). `session-edge.ts` also duplicates `auth.ts`. (All owner API routes now also check `getOwnerSession()` directly in-route.)
- **Telegram `/pause`, `/aioff` and `/sync`** act straight away, with no confirmation and no undo message.
- **The dispute message template** (`src/lib/reports/dispute-template.ts`) removes its own blank lines: `.filter(Boolean)` also drops `""`.
- **`WorkerLock` doubles as a key-value store** (sync window, stock push time, finance rollup time, Auto-Bump state). Fine for now; move the settings-like values into settings if more appear.
- **`AiEvent`, `AiUsage`, and `ImportJob` pruning** is now handled in `pruneDailyData()` (30d / 90d / 180d), along with `OrderFinance.breakdown` (14d) and orphaned `Order`s (180d). `ReturnParcel` rows still have no retention rule yet.
- **Hosting terms:** Vercel Hobby's terms are for non-commercial use (see below).

## Paid upgrades to propose to the client later

- **Vercel Pro** (about $20 a month): commercial use is allowed, functions can run longer, and scheduled jobs can run every minute.
- **A paid Postgres plan** with point-in-time restore. Today the PC's nightly `pg_dump` is the only backup.
- **An error tracker** (Sentry's free tier first). There's no error tracking now; logs are `console.*` only.
