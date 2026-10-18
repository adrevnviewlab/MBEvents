# MB Events

Luxury event production site with a lead capture frontend and a client planning backend.

## Applications

- `artifacts/mb-events` — Vite/React public site. Forms submit to `/api/leads`.
- `artifacts/mb-backend` — Next.js API, staff dashboard at `/admin`, and client portal at `/planner`.

The public site proxies `/api`, `/admin`, `/planner`, and `/_next` to the backend. Keep both applications on the same public origin so sign-in cookies and form submissions work.

## Local development

Use Node.js 24 and pnpm. Run `pnpm install --frozen-lockfile`, then start each app in a separate terminal:

```text
pnpm --filter @workspace/mb-backend run dev
pnpm --filter @workspace/mb-events run dev
```

Local development uses PostgreSQL. Copy `artifacts/mb-backend/.env.example` to `artifacts/mb-backend/.env.local`, set the password, then start Postgres with `pnpm --filter @workspace/mb-backend db:up` when Docker is installed, or `pnpm --filter @workspace/mb-backend db:local` for the project-local cluster. `pnpm dev` refuses to start when `DATABASE_URL` is missing or begins with `pglite:`. Automated tests set `pglite:memory` themselves and do not use `.env.local`. Production also refuses in-memory storage. Set `MB_ADMIN_EMAIL` and `MB_ADMIN_PASSWORD` on the host. The backend applies the SQL migrations in `artifacts/mb-backend/db/migrations` before dev, start, and the production build. Never commit connection strings or passwords. See `artifacts/mb-backend/docs/backup-recovery.md`.

Optional integrations require their own provider credentials: `RESEND_API_KEY`, `MB_FROM_EMAIL`, and `MB_NOTIFY_EMAIL` enable email alerts; `STRIPE_SECRET_KEY` enables client card payments. Lead capture, the admin dashboard, and the planning portal work without these integrations.

Run `pnpm run build` from the repository root to type-check and build both applications. The integrated smoke test is `node artifacts/mb-backend/scripts/smoke-test.mjs` with `BASE_URL`, `MB_ADMIN_EMAIL`, and `MB_ADMIN_PASSWORD` set in its environment.

## Deployment

Deploy under the Vercel team **adrev** (`adrevnview2`):

| App | Vercel project | Production URL |
|-----|----------------|----------------|
| Public site (Vite) | `mb-events` | https://mb-events-rouge.vercel.app |
| Backend / admin / planner (Next) | `mb-events-api-server` | https://mb-events-api-server.vercel.app |

Backend root directory must be `artifacts/mb-backend`. Set production `DATABASE_URL`, `MB_ADMIN_EMAIL`, `MB_ADMIN_PASSWORD`, and `MB_PUBLIC_ORIGIN` on **mb-events-api-server**. Set `MB_PUBLIC_ORIGIN` to `https://mb-events-rouge.vercel.app` (no trailing slash). The root `vercel.json` rewrites `/api`, `/admin`, `/planner`, `/invite`, `/staff`, and `/_next` to `mb-events-api-server.vercel.app`. Deploy the backend before the frontend.

Pricing shown in the public experience is an estimate until MB Events supplies approved rates. Venue imagery and descriptions should only be presented as verified MB productions when the source can be confirmed.
