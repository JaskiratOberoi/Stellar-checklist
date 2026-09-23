# Stock Management System (SMS)

Reagent + materials stock management for every business unit (BU) of the lab network.
One app, installable everywhere: a PWA hosted on Hostinger that installs on desktop, Android and iOS from the
browser. Store builds via Capacitor are a later option and need no rewrite.
Backend runs in Docker on the Noble host and exposes a versioned API for Matter and Infinity.

## What it does

- Every BU logs **daily opening and closing stock** for each reagent and material it tracks.
- Reagents are **instrument-specific**: each BU owns instruments, each instrument model owns a reagent list.
- Receipts, wastage, transfers and adjustments are recorded as a **movement ledger**.
- **Weekly and monthly opening/closing snapshots** are frozen per item per BU.
- **Consumption is derived server-side** (opening + receipts - closing - wastage) and is visible
  to the `super_admin` role only. No other role can see consumption, per BU or overall.
- **Reminders / push notifications are parked** (decision 2026-09-21). The schema keeps the `reminder`,
  `device` and `notification` tables so they can be switched on later; no code targets them yet.
- **Integration API** (API keys + webhooks) streams counts, movements, snapshots and consumption
  to Matter and Infinity.

## Repository layout (planned)

```
api/        ASP.NET Core 9 minimal API + background jobs      (Docker, this host)
web/        React 18 + Vite + TypeScript PWA                  (Hostinger static hosting)
db/sql/     Numbered PostgreSQL scripts, applied in order     (db/apply.ps1)
deploy/     docker-compose + reverse-proxy config
docs/       Architecture, database, API, roles, UX, deployment, roadmap
```

## Documents

| Doc | Contents |
| --- | --- |
| [docs/01-architecture.md](docs/01-architecture.md) | Stack, components, data flow, key design decisions |
| [docs/02-database.md](docs/02-database.md) | ERD, table-by-table spec, derivation rules |
| [docs/03-api.md](docs/03-api.md) | REST surface, auth, integration/export API, webhooks |
| [docs/04-roles-and-permissions.md](docs/04-roles-and-permissions.md) | Roles, scopes, permission matrix |
| [docs/05-ux-and-design.md](docs/05-ux-and-design.md) | Screens, flows, design tokens, mobile behaviour |
| [docs/06-deployment.md](docs/06-deployment.md) | Docker on the Noble host, Hostinger frontend, backups |
| [docs/07-roadmap.md](docs/07-roadmap.md) | Build phases and acceptance criteria |
| [db/sql/001_schema.sql](db/sql/001_schema.sql) | Initial PostgreSQL schema |

## Status (2026-09-21)

Built and working end to end on the dev stack: API (auth, counts, ledger, snapshots, super-admin reports,
admin, export/ingest API) and the web PWA (every screen in `docs/05-ux-and-design.md` except reminders).
Not yet done: webhooks, rate limiting, offline drafts, notifications (parked), production deployment.

## Running it locally

```bash
api/dev.sh up        # dev Postgres + .NET SDK container (no local SDK needed)
api/dev.sh fresh     # reset DB, build, start API on http://localhost:8095 with seed data
api/dev.sh smoke     # 31 end-to-end checks
cd web && npm install && npm run dev   # http://localhost:5174, proxies /api to the dev API
```

Dev sign-ins: `admin@sms.local / ChangeMe123!` (super admin), `admin.ops@sms.local / Admin123!`,
`manager@sms.local / Manager123!` (both units), `tech@sms.local / Tech123!` (Delhi only), `viewer@sms.local / Viewer123!`.

Production: `docker compose -f deploy/docker-compose.yml up -d --build` on the Noble host with `deploy/.env`
filled in; `cd web && npm run build` and publish `web/dist` to Hostinger with `VITE_API_URL` set
(`web/.env.example`). See `docs/06-deployment.md`.
