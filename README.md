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

For an isolated local database, set `DATABASE_URL=pglite:memory` in the backend terminal. For a persistent deployment, provide a PostgreSQL connection through `DATABASE_URL` and set `MB_ADMIN_EMAIL` and `MB_ADMIN_PASSWORD`. The backend applies the SQL migrations in `artifacts/mb-backend/db/migrations` during its production build. Never commit connection strings or passwords.

Optional integrations require their own provider credentials: `RESEND_API_KEY`, `MB_FROM_EMAIL`, and `MB_NOTIFY_EMAIL` enable email alerts; `STRIPE_SECRET_KEY` enables client card payments. Lead capture, the admin dashboard, and the planning portal work without these integrations.

Run `pnpm run build` from the repository root to type-check and build both applications. The integrated smoke test is `node artifacts/mb-backend/scripts/smoke-test.mjs` with `BASE_URL`, `MB_ADMIN_EMAIL`, and `MB_ADMIN_PASSWORD` set in its environment.

## Deployment

Deploy the backend project from `artifacts/mb-backend` as Next.js and the frontend project from the repository root as Vite. Set production `DATABASE_URL`, `MB_ADMIN_EMAIL`, `MB_ADMIN_PASSWORD`, and `MB_PUBLIC_ORIGIN` on the backend project. Set `MB_PUBLIC_ORIGIN` to the frontend's public HTTPS origin, without a trailing slash. The root `vercel.json` routes backend paths to `mbny-core.vercel.app` and serves the public site from `mbny.vercel.app`; update those destinations if project domains change. Deploy the backend before the frontend.

Pricing shown in the public experience is an estimate until MB Events supplies approved rates. Venue imagery and descriptions should only be presented as verified MB productions when the source can be confirmed.
