# 07 · Roadmap

Each phase ends with a deployable increment on the staging stack and a commit on `main`.

## Phase 1 · Foundation (web + API)
- API skeleton: auth (login/refresh/logout), roles, BU scope, health, OpenAPI.
- Schema `001_schema.sql` applied via `db/apply.ps1`; seed script with one BU, two instrument models, ~20 items.
- Admin: BUs, users, catalogue items, instrument models, instruments.
- BU items: assign from instrument models, thresholds.
- Count sheet: create draft, prefill from previous closing, packs + loose entry, submit, variance notes.
- Today dashboard, levels page.
- Web PWA installable, deployed to Hostinger; API on the Noble host behind Caddy.
- Accept: a tech logs opening and closing for a BU from a phone browser in under two minutes.

## Phase 2 · Ledger and mobile
- Lots and receipts, wastage, adjustments, transfers; `v_current_stock`; low-stock and expiry alerts.
- Capacitor Android + iOS builds, device registration, FCM push.
- Reminders: config UI, device-local scheduling, missed-count escalation job.
- Accept: a missed closing count produces a push to the tech, then to the manager.

## Phase 3 · Periods and super admin analytics
- Nightly `SnapshotBuilder` for week and month; lock/unlock with audit.
- Consumption reports (super_admin only): per BU, per instrument, per item, trend, export CSV.
- Period snapshot views for managers (opening/closing only).
- Accept: monthly closing figures for every BU item are frozen and match manual calculation.

## Phase 4 · Integration
- API keys with scopes, `/export/v1/*` with `updated_since` cursors, webhook subscriptions and retrying dispatcher.
- Matter and Infinity connectors configured; contract documented in `docs/contracts/`.
- Accept: Infinity pulls yesterday's counts and consumption for all BUs via one call per resource.

## Phase 5 · Hardening
- Offline drafts on mobile (queue and sync), conflict handling.
- Barcode / QR scan of lot labels on receipt and count.
- Email digest for super_admin (weekly consumption, missed counts).
- Backup job for `sms-db` to the existing backup location; restore runbook.
