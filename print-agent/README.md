# Kyna Ops print agent (warehouse PC)

A small program for the warehouse Windows PC. It:

- prints labels and pick lists from Kyna Ops silently, with no print dialog
- runs the app's sync every minute while the PC is on, which is the daytime clock. At night, Shopee and TikTok webhooks keep stock and orders up to date.
- optionally backs up the database once a day

It only makes outgoing HTTPS requests. Nothing on the PC is opened to the internet.

## One-time setup

1. **Install Node.js 20 or newer** (LTS) from nodejs.org.
2. **Install the thermal printer driver** and print a Windows test page so you know the printer works.
3. Copy this `print-agent` folder to the PC, for example to `C:\KynaPrintAgent`.
4. Open PowerShell in that folder and run `npm install`.
5. Run `npm run printers` and copy the exact name of the label printer.
6. Copy `.env.example` to `.env` and fill it in:
   - `KYNA_URL`: your Kyna Ops address.
   - `DEVICE_TOKEN`: on the phone, go to **Settings → Printer → Set up printer PC**. It shows a code once. Send it to yourself on Messenger or Telegram and paste it here.
   - `PRINTER_NAME`: the name from step 5.
   - `PAPER_SIZE`: `4x6` or `A6`, matching your labels.
   - `PRINT_SCALE` (optional): leave as `shrink`. A label bigger than the sticker (TikTok's is 105 × 148 mm, a little wider than 4x6) is then scaled down to fit instead of having its edges cut off. Labels that already fit still print at 100%.
7. Try it: `npm start`. On the phone, tap **Test print**. A test label should come out within a few seconds.
8. Make it start by itself: `powershell -ExecutionPolicy Bypass -File .\install-startup.ps1`

Keep Windows signed in on this PC during work hours, and set it not to sleep while plugged in.

## Day to day

- **Pause printing** on the phone stops after the label being printed. Use it when changing the label roll. Unprinted labels stay in the queue, and **Resume printing** carries on.
- If the PC was off, nothing is lost. Labels wait in the queue and print when it comes back.
- If a label was mid-print during a power cut, it goes back in the queue after 10 minutes. That one label may print twice.
- **New PC code** on the phone replaces the code. Use it if the PC is replaced or the code leaks, then update `DEVICE_TOKEN` here.

## Optional daily backup

The free database plan has no restorable backups. To keep your own:

1. Install the PostgreSQL command-line tools (`pg_dump`). The version must match your Supabase Postgres version or be newer.
2. In `.env`, set `BACKUP_DATABASE_URL` to the Supabase direct or session-pooler connection string (port 5432).
3. Each day, after `BACKUP_HOUR`, the agent saves `kyna-YYYY-MM-DD.dump` in `BACKUP_DIR` and keeps the last 7.

This puts the database password on this PC. Use a Windows account only trusted staff can open.

## Logs

When started from the startup task, the output isn't shown. To watch it live, stop the task in Task Scheduler and run `npm start` in a PowerShell window.
