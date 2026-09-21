# 04 · Roles and permissions

## Roles

| Role | Scope | Purpose |
| --- | --- | --- |
| `super_admin` | All BUs | Owns the system. The only role that can see consumption, lock periods, manage API keys and other admins. |
| `admin` | All BUs | Operations: catalogue, instrument models, suppliers, BUs, users (not super admins). Sees stock levels and counts everywhere, never consumption. |
| `bu_manager` | Member BUs | Runs a BU: instruments, tracked items and thresholds, reminders, receipts, reopen a submitted count, approve variances. |
| `lab_tech` | Member BUs | Daily work: opening/closing counts, receipts, wastage, view levels and lots. |
| `viewer` | Member BUs | Read-only counts, levels, lots. For QA/auditors who verify entries without editing. |
| API client | Scoped by key | Machine access for Matter and Infinity. Scopes listed below. |

A user has exactly one role. `super_admin` and `admin` are implicitly members of every BU; the other roles
get explicit `bu_membership` rows and can belong to several BUs (a floating tech, a regional manager).

BU scope is resolved server-side from the JWT subject on every request. The client never sends a BU it is
not a member of; the API rejects it with 403 regardless.

## Permission matrix

| Capability | super_admin | admin | bu_manager | lab_tech | viewer |
| --- | :-: | :-: | :-: | :-: | :-: |
| View stock levels, lots, counts (own BUs) | ✓ | ✓ | ✓ | ✓ | ✓ |
| Create / edit draft count | ✓ | ✓ | ✓ | ✓ | |
| Submit count | ✓ | ✓ | ✓ | ✓ | |
| Reopen submitted count | ✓ | ✓ | ✓ | | |
| Record receipt / lot | ✓ | ✓ | ✓ | ✓ | |
| Record wastage | ✓ | ✓ | ✓ | ✓ | |
| Record adjustment / transfer | ✓ | ✓ | ✓ | | |
| Manage BU items and thresholds | ✓ | ✓ | ✓ | | |
| Manage BU instruments | ✓ | ✓ | ✓ | | |
| Manage BU reminders | ✓ | ✓ | ✓ | own only | |
| Register own device for push | ✓ | ✓ | ✓ | ✓ | ✓ |
| Catalogue (items, instrument models, suppliers) | ✓ | ✓ | | | |
| Business units | ✓ | ✓ | | | |
| Users and memberships | ✓ | ✓ (below admin) | | | |
| **Consumption reports (any BU)** | ✓ | | | | |
| **Period snapshots with consumption** | ✓ | | | | |
| Period snapshots, opening/closing only | ✓ | ✓ | own BUs | | |
| Lock / unlock period | ✓ | | | | |
| API keys, webhooks | ✓ | | | | |
| Audit log | ✓ | ✓ (read) | | | |

## API key scopes

| Scope | Grants |
| --- | --- |
| `catalogue:read` | Items, instrument models, BUs, instruments |
| `export:counts` | Count headers and lines |
| `export:movements` | Movement ledger, lots |
| `export:levels` | Current stock per bu_item |
| `export:snapshots` | Period opening/closing (no consumption fields) |
| `export:consumption` | Daily and period consumption. Grant only to Matter/Infinity keys that genuinely need it. |
| `ingest:movements` | Push receipts into SMS (for a future purchase-order feed from Infinity) |
| `webhooks:manage` | Create/update the key's own webhook subscriptions |

Keys are shown once, stored as SHA-256, optionally IP-restricted, and every use updates `last_used_at`.
