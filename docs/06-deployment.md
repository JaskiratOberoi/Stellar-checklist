# 06 · Deployment

## Staging (live since 2026-09-23)

`https://sms-staging.genomicslab.in` → host cloudflared tunnel → `127.0.0.1:3140` → compose project
`sms-staging` (`deploy/docker-compose.staging.yml`): its own Postgres volume, the API, and nginx serving the
built web app while proxying `/api`, `/export`, `/ingest`, `/health` and `/openapi` to the API (same origin,
so no CORS). It is a **sandbox**: seeded dev catalogue, dev users (`manager@sms.local / Manager123!`,
`tech@sms.local / Tech123!`, `viewer@sms.local / Viewer123!`), super admin `admin@sms.local` with the
password in `deploy/.env.staging` (git-ignored, generated). Nothing here touches Noble.

Redeploy after a change:

```bash
docker compose -f deploy/docker-compose.staging.yml --env-file deploy/.env.staging up -d --build
```

Reset the sandbox database: `docker compose -f deploy/docker-compose.staging.yml --env-file deploy/.env.staging down -v`
then `up -d`. The tunnel ingress lives in `C:\Users\Qugen Pathlabs\.cloudflared\config.yml`; restarting the
`Cloudflared` Windows service needs an elevated prompt.

## Topology

| Piece | Where | How |
| --- | --- | --- |
| `sms-api` + `sms-db` + `caddy` | Noble host, Docker Compose (`deploy/docker-compose.yml`) | `docker compose up -d --build` from the repo root. Never `docker restart` after a code change; rebuild. |
| Web PWA | Hostinger, static hosting | GitHub push triggers Hostinger's Git deploy of the built `web/dist` (same mechanism as the Datt site). Users install it from the browser on Android and iOS. |

The API gets a public hostname (proposed `sms-api.genomicslab.in`) via Caddy in the compose stack. Caddy
terminates TLS with Let's Encrypt. The port-forward on the router is the same shape as the Infinity
staging exposure; only one new port (443 to Caddy, or a distinct external port mapped to it) is needed.

## Docker Compose (see `deploy/docker-compose.yml`)

Services:

- `sms-db`: `postgres:16-alpine`, volume `sms_pgdata`, only reachable on the compose network.
- `sms-api`: built from `api/Dockerfile`, env from `deploy/.env` (never committed), depends on `sms-db`,
  applies pending `db/sql/*.sql` scripts on start (recorded in `sms_migration`).
- `caddy`: `caddy:2`, `deploy/Caddyfile`, ports 80/443, volumes for certs.

Optional: reuse the existing Postgres 17 container from the Stellar replica by creating a separate
database on it. Kept separate here so SMS backups, upgrades and disk usage are independent of the LIS mirror.

## Environment (`deploy/.env.example`)

```
SMS_DB_CONNECTION=Host=sms-db;Database=sms;Username=sms;Password=...
SMS_JWT_SIGNING_KEY=<64 random bytes base64>
SMS_JWT_ISSUER=sms-api
SMS_CORS_ORIGINS=https://sms.genomicslab.in
SMS_PUBLIC_URL=https://sms-api.genomicslab.in
SMS_TIMEZONE_DEFAULT=Asia/Kolkata
```

## Frontend on Hostinger

1. `web/.env.production` sets `VITE_API_URL=https://sms-api.genomicslab.in`.
2. GitHub Actions workflow `web-deploy.yml`: `npm ci && npm run build`, commit `web/dist` to a `hostinger`
   branch (or use Hostinger's build step if the plan supports Node).
3. Hostinger Git deploy watches that branch and publishes to `sms.genomicslab.in`.
4. `web/public/.htaccess` rewrites all routes to `index.html` (SPA routing) and sets long cache headers
   for hashed assets, no-cache for `index.html` and `sw.js`.

## Installing on phones

- Android (Chrome): the PWA install prompt appears after the manifest loads; "Install app" from the menu also works.
- iOS (Safari): Share → Add to Home Screen. The app then runs full-screen with its own icon.
- Store builds and push notifications are parked; see `07-roadmap.md` Phase 5.

## Backups

- Nightly `pg_dump -Fc` of `sms` from a `sms-backup` sidecar (or a Windows scheduled task running
  `docker exec sms-db pg_dump`) to the existing backup drive, 30-day retention.
- Restore: `pg_restore -d sms --clean` into a fresh container; smoke test with `GET /health/db`.

## Observability

- `/health` (liveness) and `/health/db` (readiness) endpoints; Caddy access logs to a rotating file.
- Structured JSON logs from the API (Serilog console sink), `docker compose logs -f sms-api`.
- Job runs recorded in `job_run` table (name, started, finished, status, message) so missed nightly
  snapshots are visible in the admin UI.
