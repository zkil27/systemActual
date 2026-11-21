# Cutover: moving the shops from BigSeller to Kyna Ops

Do these steps in order. Each one can be stopped or undone until **step 7**. From step 7 on, real orders ship, and a shipped order can't be un-shipped.

- **Read** = Kyna Ops only reads from the shops.
- **Writes** = Kyna Ops changes the shops (stock, shipping).

## 0. Before you start

- [ ] **Shopee developer account approved** for `kynaph`. The "≥ 600 orders in 30 days" eligibility rule was never confirmed, so check it on the Shopee Open Platform console.
- [ ] **TikTok Shop app approved**, with the Order, Fulfillment, Product, Return & Refund and Finance scopes.
- [ ] **Vercel plan.** Hobby is for non-commercial use under Vercel's terms. You chose Hobby, so know that the terms allow Vercel to stop a commercial project.
- [ ] **Environment variables in Vercel** (names are in `.env.example`):
  - `DATABASE_URL`, `DIRECT_URL`
  - `AUTH_SECRET`: 32+ random characters. It must not be the old example value.
  - `APP_BASE_URL`: the real https address. Shopee webhook signatures are checked against it.
  - `SHOPEE_PARTNER_ID`, `SHOPEE_PARTNER_KEY`, `SHOPEE_BASE_URL`
  - `TIKTOK_APP_KEY`, `TIKTOK_APP_SECRET`, `TIKTOK_SERVICE_ID`, `TIKTOK_API_BASE_URL`
  - `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `BLOB_READ_WRITE_TOKEN`
- [ ] **Webhook URLs registered:**
  - Shopee push: `APP_BASE_URL/api/webhooks/shopee`
  - TikTok: `APP_BASE_URL/api/webhooks/tiktok`, for order status, cancellation, return status and package updates
  - Telegram bot webhook
- [ ] **Demo logins replaced.** If the database was seeded, change or delete `owner@kynaph.com` and the 1111–6666 staff PINs.

## 1. Database (Read)

1. **Back up.** Supabase free has no restorable backups:
   `pg_dump "$DIRECT_URL" --format=custom --file=kyna-before-cutover.dump`
2. `npm run db:baseline`. This marks the existing tables as migration `0_init` and changes nothing.
3. `npm run db:deploy` applies the new migrations.
4. `npm run db:clear-returns -- --yes` removes demo, imported and old-sync return rows. The old sync filed every buyer return a second time as a failed delivery.

## 2. Rehearse on test shops (Writes, test shops only)

Use Shopee's sandbox (`SHOPEE_BASE_URL=https://partner.test-stable.shopeemobile.com`) and a TikTok test shop. These parts haven't run end to end anywhere yet, so this step matters:

- [ ] Connect both test shops in Settings. "Connected" appears, with a renewal time.
- [ ] Set up the printer PC (`print-agent/README.md`). **Test print** works.
- [ ] Place test orders. They appear after a sync.
- [ ] Turn on both write switches, wait an hour, and **Preview a test wave (5 parcels)**, then **Ship**.
  - [ ] The pick list prints first, then the labels, in order.
  - [ ] Each parcel reaches "printed", and the Telegram "wave done" message arrives.
  - [ ] Cancel one test order after previewing but before shipping. It ends as "cancelled, left out".
  - [ ] Stop the app mid-wave (redeploy, or pull the PC's network). It resumes, and nothing ships twice.
- [ ] **Stock:** a test order on one shop lowers the stock on the other.
- [ ] **Reprint** and **Retry** work.
- [ ] **Automatic waves:** set a time 5 minutes away. It starts once, and doesn't start again on the next sync.

## 3. Connect the live shops with writes OFF (Read)

1. Switch the env vars to the live shop URLs and keys and redeploy. In Settings, connect Shopee and TikTok. **Leave both "Update … from Kyna Ops" switches off.**
2. Let it sync for a day. Compare the Home screen with Seller Center:
   - [ ] Failed deliveries and buyer returns are in the right buckets. Return on the Spot counts as a failed delivery.
   - [ ] Money credited matches the Shopee wallet and paid TikTok statements for the day.
   - [ ] Missing and overdue lists make sense.
3. **Check the status values against real data.** Run `npm run capture:live` (read-only; it removes buyer details), then `npm test`. The test prints every status value it saw. Compare them with the lists below and fix any that differ, in the file named:

| What | File | Values to confirm |
|---|---|---|
| Shopee return type and refund-only | `src/lib/returns/classify.ts` | `return_refund_request_type` 0/1/2, `return_solution` 1 |
| Shopee return statuses | `src/lib/returns/classify.ts` | `SHOPEE_RETURN_STATUS` |
| Shopee "returned to you" | `src/lib/returns/classify.ts` | `SHOPEE_REVERSE_DELIVERED` |
| TikTok "seller has the parcel" | `src/lib/returns/classify.ts` | `TIKTOK_SELLER_HAS_PARCEL` |
| Courier wording for failed delivery and returned to seller | `src/lib/returns/classify.ts` | the `*_PATTERNS` lists (check a few real tracking histories) |
| Shopee "lost parcel" | `src/lib/returns/classify.ts` | `SHOPEE_LOST` |
| Not yet arranged (wave eligibility) | `src/lib/waves/plan.ts` | `READY_ORDER_STATUSES`, `READY_PACKAGE_STATUSES` |
| Already arranged (no double label) | `src/lib/shipping/shopee-rules.ts`, `tiktok-rules.ts` | `ARRANGED_ORDER`, `ARRANGED_PACKAGE` |
| Orders not yet picked up (stock committed) | `src/lib/catalog/variants.ts` | `COMMITTED_ORDER_STATUSES` |
| Wallet transaction types | `src/lib/money/map.ts` | `SHOPEE_TYPES` (codes vs names) |

   Also confirm, once, during step 4: Shopee `get_item_list` paging, and TikTok product search (`/product/202502/products/search`) and SKU stock fields.

4. Copy any useful redacted captures into the fixture tests. Don't commit anything that still contains personal data. `src/lib/__fixtures__/live/` is git-ignored for that reason.

## 4. Items and starting stock (Read)

Do this at a quiet hour. Stock changes while it runs.

1. **Items & stock → Get stock from shops.** It only reads, and the screen updates by itself.
2. **Link** each Shopee listing to its TikTok twin, and pair any sizes and colours that didn't match by name.
3. Check the flagged items (the shops disagree) by counting the shelf, then save the counts. **Use these stock numbers** saves the rest with the lower suggestion.
4. Staff can now use **New stock** on the scanner for supplier deliveries.

## 5. Turn BigSeller off

Same hour as step 6, so stock is never left unsynced:

1. In BigSeller, turn off stock sync and any automatic shipping, printing or "auto mark as shipped" rules for both shops.
2. Ship or print anything BigSeller already arranged. Kyna Ops leaves those alone and flags them as "arranged outside Kyna Ops".
3. **Remove BigSeller's authorization** in both Seller Centers, so it can't ship or change stock:
   - Shopee: the partner/app authorization page in Seller Center.
   - TikTok: App & Service → your authorized apps.

   The menu names change, so search the Seller Center help for "authorized apps".

## 6. Turn on stock (Writes)

1. **Settings → Update Shopee from Kyna Ops: on**, then the same for TikTok. Set **Keep back from shops** if you want a buffer, for example 1–2 pieces on items that sell fast.
2. Watch **Items & stock** for 15 minutes. Numbers should show "shops show N", with no "not updated". Spot-check a few listings in each Seller Center.

## 7. First live wave (Writes, can't be undone)

1. **Waves → Preview a test wave (5 parcels) → Ship 5 parcels.** Check that the labels print correctly, the couriers show pickup booked, and the 5 parcels are packed and handed over normally.
2. Next wave time: **Preview wave → Ship** for the full wave.
3. When a full day goes smoothly: **Ship waves automatically** at your times.

## Rollback (any time)

In this order:

1. **Waves:** turn automatic waves off.
2. **Settings:** turn both "Update … from Kyna Ops" switches off. This stops new shipments and stock updates at once. Parcels already arranged still get their labels.
3. **Printer → Pause printing** if needed.
4. Re-authorize BigSeller in both Seller Centers and turn its stock sync back on. In BigSeller, do a stock push from your current counts.
5. For any parcel shown as needing attention, print its label from Seller Center.

The returns, money and Telegram features keep working read-only, so you can roll back shipping and keep the rest.

## First week: check daily

- [ ] Waves: the "need attention" list is empty or explained.
- [ ] Items & stock: no "not updated" warnings.
- [ ] Printer: online during work hours, with no failed prints.
- [ ] The 8 PM Telegram brief arrives. It needs a sync after 8 PM, so on a night with no orders it comes with the first sync the next morning.
- [ ] A few orders compared end to end with Seller Center: status, tracking number, money credited.

## Known limits

- Orders split into several parcels are left out of waves. Pack and ship those from Seller Center.
- Shopee labels download one per print, so that's 2,000 calls on a 2,000-parcel day. If Shopee limits this, labels can be downloaded in batches instead.
- TikTok buyer returns show "courier returned" only when TikTok marks the return complete or rejected on receipt. That can lag the real delivery.
- Shipping, scheduling and retry logic are tested as rules. Their database paths are tested only by the step 2 rehearsal.
