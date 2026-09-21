# Stock Management System (SMS)

Reagent + materials stock management for every business unit (BU) of the lab network.
One app, three surfaces: web (hosted on Hostinger), Android and iOS (Capacitor builds of the same code).
Backend runs in Docker on the Noble host and exposes a versioned API for Matter and Infinity.

## What it does

- Every BU logs **daily opening and closing stock** for each reagent and material it tracks.
- Reagents are **instrument-specific**: each BU owns instruments, each instrument model owns a reagent list.
- Receipts, wastage, transfers and adjustments are recorded as a **movement ledger**.
- **Weekly and monthly opening/closing snapshots** are frozen per item per BU.
- **Consumption is derived server-side** (opening + receipts - closing - wastage) and is visible
  to the `super_admin` role only. No other role can see consumption, per BU or overall.
- **Reminders** push notifications to phones (opening count due, closing count due, weekly review,
  monthly close) with escalation to the BU manager when a count is missed.
- **Integration API** (API keys + webhooks) streams counts, movements, snapshots and consumption
  to Matter and Infinity.

## Repository layout (planned)

```
api/        ASP.NET Core 9 minimal API + background jobs      (Docker, this host)
web/        React 18 + Vite + TypeScript PWA                  (Hostinger static hosting)
mobile/     Capacitor 6 shell wrapping web/dist               (Play Store / App Store)
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
| [docs/06-deployment.md](docs/06-deployment.md) | Docker on the Noble host, Hostinger frontend, store builds, push setup |
| [docs/07-roadmap.md](docs/07-roadmap.md) | Build phases and acceptance criteria |
| [db/sql/001_schema.sql](db/sql/001_schema.sql) | Initial PostgreSQL schema |

## Status

Planning complete (2026-09-21). No application code yet. Phase 1 build starts from `docs/07-roadmap.md`.
