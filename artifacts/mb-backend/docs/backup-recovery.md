# Database backup and recovery

Deploy/rollback steps live in `docs/deploy-rollback.md`. File durability for production should use `MB_FILE_STORAGE=s3` (see `.env.example`); local disk is acceptable only for single-node development.

The application database is the Postgres database in `DATABASE_URL`. Local development uses that same Postgres, listening on `127.0.0.1:5432`, database name `mbevents`. Start it with Docker (`pnpm db:up`) when Docker is installed. On this machine Docker is not installed, so Postgres runs from the gitignored `.data` cluster. After a reboot, start that cluster with `pnpm db:local` before `pnpm dev`. Credentials stay in gitignored `.env.local`. `pglite:memory` is only for the automated tests. It is disposable and is not backed up. Do not point the dev server at `pglite:memory`.

## What to back up

- The database, including `admin_audit` / `audit_logs`, contracts metadata, and `stored_files` rows.
- The file store. `MB_FILE_STORAGE=local` keeps bytes under `MB_FILE_DIR` (default `.data/files`). `MB_FILE_STORAGE=s3` keeps them in `MB_S3_BUCKET`. A database restore without the matching files loses contract and media bytes.
- Environment variables. They are not in the database. `MB_ADMIN_PASSWORD` and `MB_MFA_ENCRYPTION_KEY` must be stored in the host's secret manager. Losing the MFA key makes stored authenticator secrets unreadable.

## Make a backup

From `artifacts/mb-backend`. `pg_dump` is used from `PATH` when it is installed. Otherwise the script uses the `pg_dump` binary in the gitignored `.data` cluster. `DATABASE_URL` in `.env.local` must be the Postgres URL, not `pglite:`.

```text
DATABASE_URL=postgres://... MB_BACKUP_DIR=./backups node scripts/backup.mjs
```

Prefer `DATABASE_URL_UNPOOLED` when the host offers a direct connection. The script writes a custom-format `pg_dump` and does not print the connection string. `backups/` is gitignored.

On Supabase or another managed Postgres host, also enable the host's point-in-time recovery. Use `pg_dump` as the extra copy you can move off the host.

Take a backup before every production migration.

## Restore

1. Put the application in maintenance. Do not run a second copy against the database you are replacing.
2. Restore into an empty database, not over a live one, until you have checked it:

```text
pg_restore --no-owner --dbname "$DATABASE_URL" mb-events-YYYYMMDDTHHMMSSZ.dump
```

3. Restore file bytes from the same moment as the dump. The `storage_key` values in `stored_files` must exist in the file store.
4. Start the app so `scripts/migrate.mjs` can apply any migrations that are newer than the dump. It refuses to continue if a required table or the `audit_logs` view is missing.
5. Sign in as the owner (`MB_ADMIN_EMAIL`). Open one planner, one lead, and the audit log. Confirm a stored contract file downloads.

## If the MFA key is lost

Set a new `MB_MFA_ENCRYPTION_KEY`, then clear MFA for affected users in the database (`mfa_enabled = false`, `mfa_secret = null`) and have them enroll again. Do not leave the old ciphertext in place with a new key.

## Owner password

The owner password is `MB_ADMIN_PASSWORD`, not a row in `users`. Rotate it in the host environment. That ends owner sessions. Other office accounts reset through the admin staff screen or the emailed reset link when Resend is configured.

## Restart check

`node scripts/persist-check.mjs setup` creates a separate database named `mbevents_persist_check`, applies the existing migrations, and inserts one customer, lead, event, hold, booking, quote, staff assignment, invitation, RSVP, and payment. It refuses to run against `pglite:` and it never writes those rows into `mbevents`.

Stop Postgres, start it again, then run `node scripts/persist-check.mjs verify`. The same rows must still be there. `node scripts/persist-check.mjs drop` drops only `mbevents_persist_check`.

A backup restore for practice goes into an empty database such as `mbevents_restore_check`, not over `mbevents`. Drop that practice database when the check is done.
