# 03 · API

Base URL `https://sms-api.genomicslab.in`. JSON everywhere, `snake_case` fields, ISO-8601 timestamps in UTC,
dates as `YYYY-MM-DD` in the BU's local calendar. OpenAPI document at `/openapi/v1.json`, Swagger UI at
`/docs` (non-production only).

Two families of routes:

- `/api/v1/*` for the web and mobile apps, authenticated with a user JWT.
- `/export/v1/*` and `/ingest/v1/*` for Matter, Infinity and any future system, authenticated with an API key.

## Authentication

### Users (JWT)
```
POST /api/v1/auth/login          { email, password, device? {platform, name, push_token?} }
                                 → { access_token, refresh_token, expires_in, user, business_units[] }
POST /api/v1/auth/refresh        { refresh_token } → rotated pair; old refresh token revoked
POST /api/v1/auth/logout         revokes this device's refresh token
POST /api/v1/auth/logout-all     bumps session_version, revokes every token
GET  /api/v1/auth/me             profile, role, BU memberships, capabilities[]
```
`Authorization: Bearer <access_token>`. Access token carries `sub`, `role`, `sv` (session version), 15 min TTL.
BU scope is resolved server-side from memberships; a `bu_id` the caller cannot see returns 403.

### Integrations (API key)
`X-Api-Key: sms_live_xxxxxxxx…`. Keys map to `api_client.scopes`. Missing scope returns 403 with the scope
name in the body. Optional IP allow-list.

## Conventions

- Lists are paginated: `?limit=100&cursor=<opaque>` → `{ items: [], next_cursor }`. Max limit 500. Every
  list supports `updated_since=<timestamp>` for incremental sync.
- Errors: `{ error: { code, message, details? } }` with codes such as `validation`, `forbidden`, `not_found`,
  `period_locked` (HTTP 423), `already_submitted` (409).
- Writes accept `Idempotency-Key` header; a repeated key within 24 h returns the original response.
- All quantities in base units. Responses include `pack_size` so clients can display packs.

## App API (`/api/v1`)

### Business units and assets
```
GET    /bus                                 BUs visible to caller
POST   /bus                                 admin+
PATCH  /bus/{buId}
GET    /bus/{buId}/instruments
POST   /bus/{buId}/instruments              { instrument_model_id, serial_no, label, installed_on }
                                            → also returns proposed_items[] from the model's reagent list
PATCH  /bus/{buId}/instruments/{id}
GET    /bus/{buId}/items                    bu_item rows with item + instrument + current level (v_current_stock)
POST   /bus/{buId}/items                    { item_id, instrument_id?, min_level, max_level, reorder_qty }
POST   /bus/{buId}/items/bulk               [{...}] used after adding an instrument
PATCH  /bus/{buId}/items/{buItemId}
GET    /bus/{buId}/members                  bu_manager+
POST   /bus/{buId}/members                  { user_id }
```

### Catalogue (admin+)
```
GET/POST      /catalogue/items              ?kind=&instrument_model_id=&q=
GET/PATCH     /catalogue/items/{id}
GET/POST      /catalogue/instrument-models
GET/PATCH     /catalogue/instrument-models/{id}
GET           /catalogue/instrument-models/{id}/items     the model's reagent list
GET/POST      /catalogue/suppliers
```

### Counts
```
GET    /bus/{buId}/counts?from=&to=&session=&status=
GET    /bus/{buId}/counts/today                    both sessions for today (or empty shells with status)
POST   /bus/{buId}/counts                          { count_date, session } → draft with prefilled lines
GET    /counts/{countId}                           header + lines (grouped client-side by instrument)
PUT    /counts/{countId}/lines                     [{ bu_item_id, lot_id?, qty | packs+loose, note? }]  (draft only)
POST   /counts/{countId}/submit                    validates: every active bu_item present, variance notes where required
POST   /counts/{countId}/reopen                    bu_manager+, { reason } → status draft, audited
```
Prefill rule: for each active `bu_item` (and each active lot when `tracks_lot`), `expected_qty` = expected
opening per `02-database.md` rule 1. The response flags `requires_note` when
`|qty − expected| / expected > bu.variance_tolerance_pct`.

### Lots and movements
```
GET    /bus/{buId}/lots?item=&status=&expiring_within_days=
POST   /bus/{buId}/lots                            receipt: { bu_item_id, lot_no, expiry_date, supplier_id, received_qty, unit_cost? }
                                                   → creates lot + receipt movement in one transaction
PATCH  /lots/{lotId}                               status, expiry correction (audited)
GET    /bus/{buId}/movements?from=&to=&type=&bu_item_id=
POST   /bus/{buId}/movements                       { bu_item_id, lot_id?, movement_type, qty, occurred_on, note }
POST   /bus/{buId}/transfers                       { from_bu_item_id, to_bu_id, to_bu_item_id?, lot_id?, qty, note }
                                                   → transfer_out + transfer_in pair, bu_manager+
GET    /bus/{buId}/levels                          v_current_stock rows, ?low_only=true
GET    /bus/{buId}/alerts                          low stock, lots expiring ≤30 d, missed counts (last 7 d)
```

### Reminders and devices
```
GET/POST      /bus/{buId}/reminders
PATCH/DELETE  /reminders/{id}
GET           /me/reminders                        merged config the device schedules locally
POST          /me/devices                          { platform, push_token, device_name, app_version }  (upsert)
DELETE        /me/devices/{id}
GET           /me/notifications?limit=             history / inbox
POST          /me/notifications/test               sends a test push to the calling device
```

### Reports (super_admin only)
```
GET /reports/consumption?group_by=bu|instrument|item&from=&to=&bu_id=&item_id=     totals + daily series
GET /reports/consumption/daily?bu_id=&from=&to=                                   v_daily_consumption rows
GET /reports/snapshots?period_type=week|month&period_start=&bu_id=                with consumed_qty
GET /reports/missed-counts?from=&to=
GET /reports/export.csv?...                                                       same filters, CSV
POST /periods/lock    { bu_id, period_type, period_start }        super_admin
POST /periods/unlock  { bu_id, period_type, period_start, reason }
```
Managers get opening/closing without consumption at:
```
GET /bus/{buId}/snapshots?period_type=&period_start=      fields: opening_qty, received_qty, closing_qty, count_days, missing_days
```

### Admin
```
GET/POST      /admin/users              PATCH /admin/users/{id}   POST /admin/users/{id}/reset-password
GET/POST      /admin/api-keys           super_admin; POST returns the plaintext key once
POST          /admin/api-keys/{id}/revoke
GET           /admin/audit?entity_type=&entity_id=&bu_id=&actor=&from=&to=
GET           /admin/jobs               recent job_run rows
GET           /health   /health/db
```

## Integration API (`/export/v1`, `/ingest/v1`)

Designed for Matter and Infinity to pull incrementally. Every resource supports `updated_since` + cursor.
Responses embed the natural keys (`bu_code`, `item_code`, `instrument_serial`) alongside UUIDs so the
receiver can map without extra calls.

| Endpoint | Scope | Returns |
| --- | --- | --- |
| `GET /export/v1/business-units` | `catalogue:read` | BUs with instruments |
| `GET /export/v1/items` | `catalogue:read` | catalogue items, instrument model |
| `GET /export/v1/bu-items` | `catalogue:read` | bu_item rows with thresholds |
| `GET /export/v1/counts?bu=&from=&to=&updated_since=` | `export:counts` | count headers with lines (qty, expected, variance, lot) |
| `GET /export/v1/movements?bu=&from=&to=&updated_since=` | `export:movements` | ledger rows |
| `GET /export/v1/lots?bu=&status=` | `export:movements` | lots with remaining qty |
| `GET /export/v1/levels?bu=` | `export:levels` | v_current_stock |
| `GET /export/v1/snapshots?period_type=&period_start=&bu=` | `export:snapshots` | opening/received/wastage/closing (no consumed) |
| `GET /export/v1/consumption/daily?bu=&from=&to=` | `export:consumption` | v_daily_consumption |
| `GET /export/v1/consumption/periods?period_type=&period_start=` | `export:consumption` | snapshots including consumed_qty |
| `POST /ingest/v1/movements` | `ingest:movements` | bulk receipts/adjustments from an external GRN; idempotent on `(reference_type, reference_id)` |

Example count export item:
```json
{
  "id": "5f0c…",
  "bu": { "id": "…", "code": "DEL-CENTRAL" },
  "count_date": "2026-09-21",
  "session": "closing",
  "status": "submitted",
  "submitted_at": "2026-09-21T15:42:10Z",
  "submitted_by": { "id": "…", "name": "R. Sharma" },
  "lines": [
    {
      "bu_item_id": "…",
      "item": { "code": "RG-XN-CELLPACK", "name": "CELLPACK DCL", "base_uom": "mL", "pack_size": 20000 },
      "instrument": { "serial_no": "A1234", "model": "Sysmex XN-550" },
      "lot": { "lot_no": "L2409A", "expiry_date": "2027-03-31" },
      "qty": 34000, "expected_qty": 36000, "variance": -2000, "note": null
    }
  ],
  "updated_at": "2026-09-21T15:42:10Z"
}
```

### Webhooks
```
GET/POST  /export/v1/webhooks            scope webhooks:manage; { url, events[] } → { id, secret }
DELETE    /export/v1/webhooks/{id}
```
Events: `count.submitted`, `count.reopened`, `movement.created`, `lot.created`, `snapshot.locked`,
`period.unlocked`. Body `{ event, event_id, occurred_at, data }`, header `X-SMS-Signature: sha256=<hmac>`.
Retries at 1, 5, 15, 60 min then hourly up to 8 attempts; receivers must be idempotent on `event_id`.

## Rate limits
Per user 600 req/min; per API key 1200 req/min; login 10/min per IP. Returned in `X-RateLimit-*` headers.
