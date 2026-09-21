# 06 · Deployment

## Topology

| Piece | Where | How |
| --- | --- | --- |
| `sms-api` + `sms-db` + `caddy` | Noble host, Docker Compose (`deploy/docker-compose.yml`) | `docker compose up -d --build` from the repo root. Never `docker restart` after a code change; rebuild. |
| Web PWA | Hostinger, static hosting | GitHub push triggers Hostinger's Git deploy of the built `web/dist` (same mechanism as the Datt site). |
| Android / iOS | Play Store, App Store | Capacitor builds from `mobile/`, CI produces AAB and IPA; manual store upload. |
| Push | Firebase project `sms-genomicslab` | Service-account JSON mounted into `sms-api` as a secret. |

The API gets a public hostname (proposed `sms-api.genomicslab.in`) via Caddy in the compose stack. Caddy
terminates TLS with Let's Encrypt. The port-forward on the router is the same shape as the Infinity
staging exposure; only one new port (443 to Caddy, or a distinct external port mapped to it) is needed.

## Docker Compose (see `deploy/docker-compose.yml`)

Services:

- `sms-db`: `postgres:16-alpine`, volume `sms_pgdata`, only reachable on the compose network.
- `sms-api`: built from `api/Dockerfile`, env from `deploy/.env` (never committed), depends on `sms-db`,
  runs migrations on start via `db/apply.ps1` equivalent in C# (`Sms.Api --migrate`).
- `caddy`: `caddy:2`, `deploy/Caddyfile`, ports 80/443, volumes for certs.

Optional: reuse the existing Postgres 17 container from the Stellar replica by creating a separate
database on it. Kept separate here so SMS backups, upgrades and disk usage are independent of the LIS mirror.

## Environment (`deploy/.env.example`)

```
SMS_DB_CONNECTION=Host=sms-db;Database=sms;Username=sms;Password=...
SMS_JWT_SIGNING_KEY=<64 random bytes base64>
SMS_JWT_ISSUER=sms-api
SMS_CORS_ORIGINS=https://sms.genomicslab.in,capacitor://localhost,http://localhost
SMS_FCM_SERVICE_ACCOUNT_PATH=/run/secrets/fcm.json
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

## Mobile builds

- `mobile/capacitor.config.ts`: `appId: in.genomicslab.sms`, `webDir: ../web/dist`, `server.url` unset in
  production (bundle is embedded), set to the dev URL for live-reload during development.
- Plugins: `@capacitor/push-notifications`, `@capacitor/local-notifications`, `@capacitor/app`,
  `@capacitor/preferences` (token storage), `@capacitor/barcode-scanner` (phase 5).
- Android: `google-services.json` in `mobile/android/app/`; iOS: APNs key uploaded to Firebase, push
  capability + background modes enabled in Xcode.
- Release: `npm run build` in `web/`, `npx cap sync`, then Gradle `bundleRelease` / Xcode archive.

## Push notification setup

1. Create Firebase project, enable Cloud Messaging, download service-account JSON.
2. Web: generate VAPID key pair in Firebase, put public key in `web/.env.production`, `firebase-messaging-sw.js`
   registered alongside the PWA service worker.
3. Backend `FcmClient` uses the HTTP v1 API with the service account, sends to `device.push_token`.
4. Device tokens are refreshed on every app start and stored in `device`; stale tokens (FCM 404/410) are
   marked `revoked_at`.

## Backups

- Nightly `pg_dump -Fc` of `sms` from a `sms-backup` sidecar (or a Windows scheduled task running
  `docker exec sms-db pg_dump`) to the existing backup drive, 30-day retention.
- Restore: `pg_restore -d sms --clean` into a fresh container; smoke test with `GET /health/db`.

## Observability

- `/health` (liveness) and `/health/db` (readiness) endpoints; Caddy access logs to a rotating file.
- Structured JSON logs from the API (Serilog console sink), `docker compose logs -f sms-api`.
- Job runs recorded in `job_run` table (name, started, finished, status, message) so missed nightly
  snapshots are visible in the admin UI.
