# Launch readiness

This is a readiness review of the working tree. It is not a production deploy, and it is not permission to charge a card. Nothing here was run against a live Stripe account or a production database.

Money in the admin report uses one source per event. If that event has any row in `payments`, revenue is rows with status `paid` minus `payment_adjustments`. This database has no `succeeded` status. Phase 4 keeps a paid row immutable and records refunds and cancellations as adjustments. Planner JSON payments are not added for that event. If the event has no `payments` row, the report reads paid amounts in `planner_events.admin_data.payments` and says so. Line items are not treated as payments. Deposits are collected payments whose label contains "deposit", case-insensitive. There is no deposit percent. Package and lead-source totals use a stored link. A missing link is "not recorded". Average booking value is omitted when no booking has revenue. Profit is revenue minus `event_costs` only when cost rows exist. With no cost rows the report says "cost not recorded" and does not show profit or a margin.

## 1. Completed features

These features are present in the tree. A feature is listed here when its code or schema was read. Section 2 says which paths were executed.

- Public marketing site in `artifacts/mb-events` with occasion pages and a lead form that posts to `/api/leads`.
- Admin office for leads, client planners, staff, venues, partners, automations, and the business report at `/admin/report`.
- Client planner and guest song-request portal.
- CRM stages, assignment, lost reason, merge, and one-time conversion to an event. Conversion does not insert a payment.
- Calendar windows, holds, and overlap checks in SQL and `lib/calendar.ts`.
- Quotes, contracts, the `payments` ledger, `payment_adjustments`, receipts, and a local Stripe webhook handler.
- Invitations schema, including `guests.token_hash` and `guests.checkin_code_hash`.
- Operations tables, staff assignments, and equipment reservations.
- File storage with a server-built key and a 20 MB cap.
- Admin MFA, audit rows, and `GET /api/healthz` integration flags.
- Backup notes in `docs/backup-recovery.md` and `scripts/backup.mjs`.
- Business report API `GET /api/admin/report` and page `/admin/report`, gated by `payments.read` plus `office.access`.

## 2. Tested workflows

Commands were run from `artifacts/mb-backend` on 16 October 2026. `DATABASE_URL` was set in the environment before each Node process started. `DEP0205` from `module.register()` was printed and ignored. Every file under `scripts/*-test.ts` exists; none was skipped.

| Command | Exit |
| --- | --- |
| `pnpm exec tsc --noEmit -p tsconfig.json` | 0 |
| `node --experimental-strip-types --import ./scripts/register-alias.mjs scripts/foundation-test.ts` with `DATABASE_URL=pglite:memory` | 0 (20/20) |
| `node --experimental-strip-types --import ./scripts/register-alias.mjs scripts/crm-test.ts` with `DATABASE_URL=pglite:memory` | 0 (26/26) |
| `node --experimental-strip-types --import ./scripts/register-alias.mjs scripts/calendar-test.ts` with `DATABASE_URL=pglite:memory` | 0 (24/24) |
| `node --experimental-strip-types --import ./scripts/register-alias.mjs scripts/finance-test.ts` with `DATABASE_URL=pglite:memory` | 0 (30/30) |
| `node --experimental-strip-types --import ./scripts/register-alias.mjs scripts/operations-test.ts` with `DATABASE_URL=pglite:memory` | 0 (34/34) |
| `node --experimental-strip-types --import ./scripts/register-alias.mjs scripts/portal-test.ts` with `DATABASE_URL=pglite:memory` | 0 (48/48) |
| `node --experimental-strip-types --import ./scripts/register-alias.mjs scripts/invites-test.ts` with `DATABASE_URL=pglite:memory` | 0 (24/24) |
| `node --experimental-strip-types --import ./scripts/register-alias.mjs scripts/automations-test.ts` with `DATABASE_URL=pglite:memory` | 0 (24/24) |
| `node --experimental-strip-types --import ./scripts/register-alias.mjs scripts/analytics-test.ts` with `DATABASE_URL=pglite:memory` | 0 (25/25) |
| `node scripts/migrate.mjs` with `DATABASE_URL=pglite:.pglite-check`, then the directory was deleted | 0 |
| `GET /api/healthz` on a running server | not run |

No command in that table exited non-zero. No source file was changed to make a test pass.

Verified by those passing tests:

- Empty analytics data does not invent profit, a margin, or an average booking value. Deposits follow the payment label. Relational payments replace JSON for the same event. Adjustments reduce revenue. Repeat customers follow `customer_id`, not the name.
- Foundation: staff lacks `office.access`, guest song-request permission, schema tables, equipment overbook, RSVP event match, a small contract file round trip, no seeded package prices.
- CRM: lead capture, assignment, lost reason, merge, and a single unconfirmed conversion.
- Calendar: overlapping staff and equipment are rejected, an expired hold does not block, an unexpired hold does, confirm is refused on overlap and accepted when the window is clear, and one of two concurrent reservations wins.
- Portal: a client cannot read or write another event; a guest cannot open the client planner; the guest payload used in that test has no payments, contracts, or messages.
- Operations: staff briefs omit rates, invoices, and internal notes; overlapping assignments and equipment quantities are rejected; incident reports are append-only.
- Finance, local fixtures only: a bad webhook signature is rejected and writes no payment; a signed webhook records one payment; a duplicate webhook does not create a second payment; a refund leaves the original payment. This did not call Stripe.
- Invites: the guest token is stored only as a hash; the public payload and check-in URL omit guest email and phone; a guest cannot list other guests; RSVP rejects an unpublished invite, a wrong token, a plus-one over the cap, and a past deadline; check-in with a valid token works once.
- Automations: scheduling the same automation twice creates one run; a failed run retries and then stops at the attempt cap; a review request does not send when `marketing_opt_in` is null; a referral does not send when `marketing_opt_in` is false.

Not run in this session:

- `GET /api/healthz` against a running server. No server was started.
- A separate upload of 20,000,001 bytes, and a `saveEventFile` call with kind `guest_media`. The foundation test did save and read back a small `contract` file. `lib/files.ts` now allows `guest_media` in the kind set. That save was not executed here.
- Accessibility and mobile layout. No admin or public page was loaded in a browser.
- Performance numbers. No benchmark was run.
- `scripts/smoke-test.mjs`. It needs a running app and was not run.
- Backup and restore against any real database. The script and the doc exist. They were not executed.
- Live Stripe.

## 3. Remaining bugs

The typecheck failure, the calendar crash, and the missing invites and automations runs from the earlier draft were not reproduced. `pnpm exec tsc --noEmit -p tsconfig.json` exited 0. `scripts/calendar-test.ts`, `scripts/invites-test.ts`, and `scripts/automations-test.ts` each exited 0.

`package.json` defines `test:foundation`, `test:crm`, `test:portal`, `test:calendar`, `test:analytics`, `test:finance`, `test:automations`, `test:operations`, and `test:invites`. This session ran the same `node` commands those scripts wrap. It did not invoke them through `pnpm run`.

The planner overview guest count still reads planner JSON. In `components/planner/sections.tsx`, `Overview` counts `data.guests` (RSVP `Yes` party sizes, and invited party sizes). `Guests` renders `InviteManager`, which loads `/api/planner/invites` or `/api/admin/events/:id/invites`. Those are different stores. This was read in the source and left as-is.

The earlier statement that `saveEventFile` rejects `guest_media` does not match the current allow-list in `lib/files.ts` (`contract`, `event_media`, `venue_photo`, `vendor_photo`, `guest_media`). A `guest_media` save was not executed in this session.

## 4. Security concerns

- Owner sign-in compares `MB_ADMIN_PASSWORD` from the environment. `ensureOwnerUser` does not copy that password into `users`. That was read in `lib/admin.ts`, not proven by a login test in this session.
- A search of `*.ts`, `*.tsx`, `*.js`, `*.mjs`, `*.json`, `*.sql`, and `*.env` files on 16 October 2026 found the text `sk_live` only in this report. `pglite:memory` is used by the tests above. A checked-in owner password was not searched again in this session.
- Webhook signature check and `stripe_events` idempotency passed in `finance-test.ts` against local fixtures. The handler returns 503 when `STRIPE_WEBHOOK_SECRET` is missing. Live delivery was not tested.
- Guest song-request tokens in `0004_guest_access_token.sql` are stored for lookup, not described there as a hash. Invite tokens are a separate `token_hash` column. `invites-test.ts` passed "guest token is stored only as a hash".
- Client view code still returns guest portal fields to the signed-in client. Portal tests checked cross-event access and hidden staff notes. They were not a review of every field on that payload.
- `GET /api/healthz` returns boolean integration flags, not secret values. No monitoring vendor is referenced in the application code that was searched. Audit rows go to `admin_audit`, exposed as `audit_logs`.
- File keys are generated on the server as `kind/id`. The foundation test round-tripped a small contract file. The 20 MB cap is still the constant in `lib/files.ts`. An over-cap upload was not repeated this session. That check was not a penetration test.

## 5. Missing integrations

Flags in `lib/config.ts` are false until the matching environment variables are set.

- Card payments need `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`. The local webhook test passed. Live Stripe was not called.
- Email needs `RESEND_API_KEY` and `MB_FROM_EMAIL`. Receipts in the finance test were stored and not marked sent without email. The automations test left email unsent when it is not configured.
- SMS needs `MB_SMS_ACCOUNT_SID`, `MB_SMS_AUTH_TOKEN`, and `MB_SMS_FROM`. `invites-test.ts` passed "sms job records that sms is not configured". No live SMS account was called.
- MFA needs `MB_MFA_ENCRYPTION_KEY` of at least 16 characters. The foundation test covered the TOTP vector and the seal round trip with a test key.
- Production Postgres is not configured in this workspace. Migrations were applied only to `pglite:.pglite-check`, and that directory was deleted.
- Object storage is optional. The default file store is local disk.
- No error-monitoring or uptime vendor is wired in the code that was searched.

## 6. Required environment variables

Names only.

- `DATABASE_URL`
- `POSTGRES_URL`
- `DATABASE_URL_UNPOOLED`
- `POSTGRES_URL_NON_POOLING`
- `MB_ADMIN_EMAIL`
- `MB_ADMIN_PASSWORD`
- `MB_PUBLIC_ORIGIN`
- `RESEND_API_KEY`
- `MB_FROM_EMAIL`
- `MB_NOTIFY_EMAIL`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `MB_MFA_ENCRYPTION_KEY`
- `MB_FILE_STORAGE`
- `MB_FILE_DIR`
- `MB_S3_BUCKET`
- `MB_S3_REGION`
- `MB_S3_ENDPOINT`
- `MB_S3_ACCESS_KEY_ID`
- `MB_S3_SECRET_ACCESS_KEY`
- `MB_BACKUP_DIR`
- `MB_SMS_ACCOUNT_SID`
- `MB_SMS_AUTH_TOKEN`
- `MB_SMS_FROM`

`VERCEL_ENV` and `MIGRATE_PREVIEW` change whether `scripts/migrate.mjs` runs. They are not application secrets.

## 7. Estimated monthly operating costs

These are not quotes and not a bill.

- Stripe's commonly cited US card rate is about 2.9% + $0.30 per successful card charge. This repo does not record a negotiated Stripe price.
- `README.md` does not publish a hosting price, so this report does not give a hosting dollar range.
- Postgres, file storage, Resend, and SMS have no prices in the repo. No monthly total is estimated.

## 8. Production deployment checklist

Do not deploy from this review.

Before any later production attempt:

1. `pnpm exec tsc --noEmit -p tsconfig.json` exits 0. It did, in this session.
2. `scripts/calendar-test.ts` finishes and passes. It exited 0 (24/24).
3. An invites test covers token hashes and public RSVP fields, and passes. `scripts/invites-test.ts` exited 0 (24/24).
4. An automation test covers retries, the unique run key, and `marketing_opt_in` not true blocking review and referral sends. `scripts/automations-test.ts` exited 0 (24/24).
5. Take a backup with `scripts/backup.mjs` against the real database. This session did not.
6. Set the environment names in section 6 on the host. Do not commit them.
7. Apply migrations with `scripts/migrate.mjs` on the production database only after that backup. This session applied migrations only to `pglite:.pglite-check`. Preview environments skip migrations unless `MIGRATE_PREVIEW=1`.
8. Confirm `GET /api/healthz` on the running host. It was not requested here.
9. Do not point `DATABASE_URL` at `pglite:memory`.
10. Do not enable card charges until a live webhook is signed, idempotent, and checked with a Stripe test clock or test card outside this review. This session did not do that.
11. Load the admin report, planner, and public lead form on a phone-width and desktop browser. That was not done.

## 9. Remaining client decisions

The software does not decide these. No prices or policies were invented.

- Package, service, and overtime prices. Catalog amounts stay null until MB Events enters them. Tests assert that a missing price is not stored as zero.
- Deposit rules. A deposit in the report is a payment label, not a percent.
- Tax. A stored tax rule can apply to a quote. No default tax rate was added.
- Cancellation. `payment_adjustments.kind` allows `cancellation`. No cancellation policy text was written.
- Which venues are verified MB productions. `venues.mb_production` exists and defaults to false. No venues were seeded.
- Marketing consent copy. `customers.marketing_opt_in` is null until answered. Review and referral sends in `lib/automations.ts` require the flag to be true. The automations test covered a null review request and a false referral. The customer-facing copy was not reviewed in a browser.
- SMS provider account, sender number, and whether SMS is in scope.

## 10. Final launch readiness verdict

The automated suite from this session is green: typecheck exited 0, and all nine existing test files exited 0. Passing those tests does not make this a production launch. The app was not loaded in a browser, a running `/api/healthz` was not requested, a backup was not restored, and live Stripe was not called, so this tree is not launch-ready. Do not deploy, and do not charge a card. The planner overview still counts guests from planner JSON while the Guests tab counts the database invitation list.
