# Database migrations

The schema is now managed with Prisma migrations (`prisma/migrations/`) instead of `prisma db push`.

## One-time switch for an existing database

The existing Supabase database was created with `db push`, so it already matches `0_init`.

1. **Back up first.** Supabase free has no restorable backups, so take a dump:
   `pg_dump "$DIRECT_URL" --format=custom --file=kyna-backup.dump`
2. Mark the baseline as already applied (this changes no tables):
   `npm run db:baseline`
3. Apply the newer migrations:
   `npm run db:deploy`

## Fresh database

`npm run db:deploy`, then optionally `npm run db:seed`.

The seed creates a demo owner (`owner@kynaph.com` / `kyna1234`) and demo staff PINs. It adds no sample shops, chats or returns.
Do not run it against the real database, or change those credentials immediately if you do.

## Day to day

- Change `schema.prisma`, then `npm run db:migrate -- --name <what_changed>` against a local database.
- Deploy with `npm run db:deploy`.

## Clearing demo data before go-live

`npm run db:clear-returns -- --yes` deletes all return parcels, import jobs and demo shops.
It keeps the owner, staff and settings. Back up first.
