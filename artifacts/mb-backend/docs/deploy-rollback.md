# Deploy and rollback

This is the runbook for shipping MB Events. It does **not** authorize live card charging, production email/SMS, or DNS changes without separate explicit approval.

## Preconditions

1. `pnpm --filter @workspace/mb-backend run typecheck` and `build` succeed.
2. `pnpm --filter @workspace/mb-events run build` succeeds.
3. `node scripts/integration-check.mjs` exits 0 (no `sk_live_`, database + owner creds present).
4. `NODE_ENV=production` smoke against `next start` passes (closed auth — not `next dev`).
5. Managed Postgres URL is set (not PGlite). Migrations applied via `node scripts/migrate.mjs`.
6. File storage is `MB_FILE_STORAGE=s3` with bucket credentials, or an explicit accepted risk for single-node local disk.
7. Backup taken (`node scripts/backup.mjs`) before the first production migrate.

## Deploy (staging first)

1. Set secrets in the host secret manager (never commit `.env.local`).
2. Point `DATABASE_URL` / `DATABASE_URL_UNPOOLED` at staging Postgres.
3. Run migrate, then start the Next app (`pnpm start` or host equivalent).
4. Start the job worker: `pnpm run jobs:worker` (or host cron every minute: `pnpm run jobs:once`).
5. Deploy the Vite `dist/public` site behind the same origin (or proxy `/api`, `/admin`, `/planner`, `/_next` to the Next app).
6. Verify `GET /api/healthz` — `database=true`, `payments` only if `sk_test_` is intended, `email` only if Resend sandbox/prod was approved.
7. Sign in as owner, open desk, one lead, one planner, report.

## Rollback

1. Keep the previous app artifact (previous Vercel deployment / previous Docker image / previous `dist`).
2. Restore that artifact; do **not** re-run destructive SQL.
3. If a migration already applied and must be undone, restore the pre-migrate `pg_dump` into a new database, switch `DATABASE_URL`, then restart. Prefer forward-fix migrations over DOWN scripts.
4. Restore file bytes from the matching backup moment when `stored_files` keys are missing.
5. Disable Stripe webhook endpoint in the Stripe dashboard if payments misbehave (test mode first).
6. Stop the job worker if it is flooding failures; jobs remain `pending`/`failed` for retry later.

## 0020_event_tables (Phase 8 seating)

Forward migration adds `event_tables` and nullable `guests.table_id`, then backfills from `guests.table_label`. Prefer forward-fix.

If you must undo after apply (staging only):

```sql
ALTER TABLE guests DROP COLUMN IF EXISTS table_id;
DROP TABLE IF EXISTS event_tables;
DELETE FROM _migrations WHERE name = '0020_event_tables.sql';
```

`guests.table_label` is unchanged, so free-text seating text survives. Prefer restoring a pre-migrate `pg_dump` in production rather than hand-running DROP.

## MFA key loss

See `docs/backup-recovery.md`. Rotate `MB_MFA_ENCRYPTION_KEY` only with a coordinated MFA reset.

## What this runbook does not do

- Change DNS or cut over production traffic.
- Enable `sk_live_` or production SMS.
- Send real customer email without sandbox proof and owner approval.
