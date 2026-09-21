-- 001_schema.sql · Stock Management System (SMS) · PostgreSQL 16
-- Initial schema. Applied by db/apply.ps1 (records itself in sms_migration).

CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()

CREATE TABLE IF NOT EXISTS sms_migration (
  script      text PRIMARY KEY,
  applied_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
CREATE TYPE user_role        AS ENUM ('super_admin','admin','bu_manager','lab_tech','viewer');
CREATE TYPE bu_type          AS ENUM ('lab','collection_centre','warehouse','other');
CREATE TYPE instrument_status AS ENUM ('active','down','retired');
CREATE TYPE item_kind        AS ENUM ('reagent','calibrator','control','consumable','material');
CREATE TYPE storage_condition AS ENUM ('room','fridge_2_8','freezer_minus20','freezer_minus80');
CREATE TYPE lot_status       AS ENUM ('active','exhausted','expired','quarantined');
CREATE TYPE count_session    AS ENUM ('opening','closing');
CREATE TYPE count_status     AS ENUM ('draft','submitted','locked');
CREATE TYPE movement_type    AS ENUM ('receipt','wastage','transfer_out','transfer_in','adjustment','return_to_supplier','expiry_writeoff');
CREATE TYPE period_type      AS ENUM ('week','month');
CREATE TYPE reminder_kind    AS ENUM ('opening_count','closing_count','weekly_review','monthly_close','custom');
CREATE TYPE device_platform  AS ENUM ('android','ios','web');
CREATE TYPE notification_status AS ENUM ('scheduled','sent','failed','cancelled');
CREATE TYPE delivery_status  AS ENUM ('pending','delivered','failed','dead');

-- ---------------------------------------------------------------------------
-- Organisation structure
-- ---------------------------------------------------------------------------
CREATE TABLE business_unit (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code              text NOT NULL UNIQUE,                 -- e.g. 'DEL-CENTRAL'
  name              text NOT NULL,
  bu_type           bu_type NOT NULL DEFAULT 'lab',
  address           text,
  timezone          text NOT NULL DEFAULT 'Asia/Kolkata',
  opening_due_time  time NOT NULL DEFAULT '09:00',
  closing_due_time  time NOT NULL DEFAULT '21:00',
  grace_minutes     int  NOT NULL DEFAULT 30,             -- before a count is considered missed
  variance_tolerance_pct numeric(5,2) NOT NULL DEFAULT 5, -- opening vs previous closing
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app_user (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email          citext NOT NULL UNIQUE,
  full_name      text NOT NULL,
  phone          text,
  password_hash  text NOT NULL,                            -- argon2id
  role           user_role NOT NULL DEFAULT 'lab_tech',
  is_active      boolean NOT NULL DEFAULT true,
  session_version int NOT NULL DEFAULT 1,                  -- bump to revoke all tokens
  last_login_at  timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- Explicit BU scope for bu_manager / lab_tech / viewer. super_admin and admin see all BUs.
CREATE TABLE bu_membership (
  user_id     uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  bu_id       uuid NOT NULL REFERENCES business_unit(id) ON DELETE CASCADE,
  is_default  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, bu_id)
);

CREATE TABLE refresh_token (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  device_id   uuid,                                       -- FK added after device table
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Catalogue (shared across BUs, managed by admin)
-- ---------------------------------------------------------------------------
CREATE TABLE instrument_model (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  manufacturer  text NOT NULL,                            -- 'Sysmex'
  model_name    text NOT NULL,                            -- 'XN-550'
  category      text NOT NULL,                            -- haematology, biochemistry, immunoassay, coagulation, urinalysis, other
  notes         text,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (manufacturer, model_name)
);

CREATE TABLE supplier (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL UNIQUE,
  contact     text,
  gstin       text,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE item (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                text NOT NULL UNIQUE,               -- 'RG-XN-CELLPACK'
  name                text NOT NULL,
  kind                item_kind NOT NULL,
  category            text,                               -- free grouping: 'haematology', 'phlebotomy', 'stationery'
  manufacturer        text,
  catalogue_no        text,
  base_uom            text NOT NULL,                      -- 'test','mL','piece','g'
  pack_size           numeric(14,3) NOT NULL DEFAULT 1,   -- base units per pack
  pack_uom            text NOT NULL DEFAULT 'pack',       -- 'bottle','box','kit','pack'
  tracks_lot          boolean NOT NULL DEFAULT true,
  tracks_expiry       boolean NOT NULL DEFAULT true,
  storage             storage_condition NOT NULL DEFAULT 'room',
  hazard              text,
  instrument_model_id uuid REFERENCES instrument_model(id), -- NULL = general material
  default_min_level   numeric(14,3),
  is_active           boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_item_instrument_model ON item(instrument_model_id) WHERE instrument_model_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- BU assets
-- ---------------------------------------------------------------------------
CREATE TABLE instrument (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bu_id               uuid NOT NULL REFERENCES business_unit(id),
  instrument_model_id uuid NOT NULL REFERENCES instrument_model(id),
  serial_no           text NOT NULL,
  asset_tag           text,
  label               text,                               -- 'XN-550 #2 (Bench B)'
  installed_on        date,
  status              instrument_status NOT NULL DEFAULT 'active',
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bu_id, serial_no)
);

-- Which items a BU tracks, optionally per physical instrument.
CREATE TABLE bu_item (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bu_id          uuid NOT NULL REFERENCES business_unit(id),
  item_id        uuid NOT NULL REFERENCES item(id),
  instrument_id  uuid REFERENCES instrument(id),          -- NULL for general materials
  min_level      numeric(14,3),
  max_level      numeric(14,3),
  reorder_qty    numeric(14,3),
  sort_order     int NOT NULL DEFAULT 0,
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (bu_id, item_id, instrument_id)
);
CREATE INDEX ix_bu_item_bu ON bu_item(bu_id) WHERE is_active;

CREATE TABLE stock_lot (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bu_item_id    uuid NOT NULL REFERENCES bu_item(id),
  lot_no        text NOT NULL,
  expiry_date   date,
  supplier_id   uuid REFERENCES supplier(id),
  received_on   date NOT NULL DEFAULT CURRENT_DATE,
  received_qty  numeric(14,3) NOT NULL,                   -- base units
  unit_cost     numeric(14,4),
  status        lot_status NOT NULL DEFAULT 'active',
  created_by    uuid REFERENCES app_user(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bu_item_id, lot_no)
);
CREATE INDEX ix_stock_lot_expiry ON stock_lot(expiry_date) WHERE status = 'active';

-- ---------------------------------------------------------------------------
-- Counts (facts entered by staff)
-- ---------------------------------------------------------------------------
CREATE TABLE stock_count (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bu_id         uuid NOT NULL REFERENCES business_unit(id),
  count_date    date NOT NULL,
  session       count_session NOT NULL,
  status        count_status NOT NULL DEFAULT 'draft',
  note          text,
  created_by    uuid NOT NULL REFERENCES app_user(id),
  submitted_by  uuid REFERENCES app_user(id),
  submitted_at  timestamptz,
  reopened_by   uuid REFERENCES app_user(id),
  reopened_at   timestamptz,
  locked_at     timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bu_id, count_date, session)
);
CREATE INDEX ix_stock_count_bu_date ON stock_count(bu_id, count_date DESC);
CREATE INDEX ix_stock_count_updated ON stock_count(updated_at);

CREATE TABLE stock_count_line (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  count_id      uuid NOT NULL REFERENCES stock_count(id) ON DELETE CASCADE,
  bu_item_id    uuid NOT NULL REFERENCES bu_item(id),
  lot_id        uuid REFERENCES stock_lot(id),            -- NULL when the item does not track lots
  qty           numeric(14,3) NOT NULL CHECK (qty >= 0),  -- base units
  packs_entered numeric(14,3),                            -- what the tech typed, for display only
  loose_entered numeric(14,3),
  expected_qty  numeric(14,3),                            -- prefill (previous closing + movements)
  is_confirmed  boolean NOT NULL DEFAULT false,           -- tech confirmed or entered this line
  variance      numeric(14,3) GENERATED ALWAYS AS (qty - COALESCE(expected_qty, qty)) STORED,
  note          text,
  updated_by    uuid REFERENCES app_user(id),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (count_id, bu_item_id, lot_id)
);
CREATE INDEX ix_count_line_bu_item ON stock_count_line(bu_item_id);

-- ---------------------------------------------------------------------------
-- Movement ledger (everything that changes stock between counts)
-- ---------------------------------------------------------------------------
CREATE TABLE stock_movement (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bu_item_id     uuid NOT NULL REFERENCES bu_item(id),
  lot_id         uuid REFERENCES stock_lot(id),
  movement_type  movement_type NOT NULL,
  qty_delta      numeric(14,3) NOT NULL,                  -- signed, base units
  occurred_on    date NOT NULL DEFAULT CURRENT_DATE,
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  reference_type text,                                    -- 'transfer', 'grn', 'external:infinity'
  reference_id   text,
  counterpart_bu_item_id uuid REFERENCES bu_item(id),     -- for transfers
  note           text,
  created_by     uuid REFERENCES app_user(id),
  api_client_id  uuid,                                    -- FK added after api_client table
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (movement_type IN ('receipt','transfer_in') AND qty_delta > 0) OR
    (movement_type IN ('wastage','transfer_out','expiry_writeoff','return_to_supplier') AND qty_delta < 0) OR
    (movement_type = 'adjustment')
  )
);
CREATE INDEX ix_movement_bu_item_date ON stock_movement(bu_item_id, occurred_on);
CREATE INDEX ix_movement_created ON stock_movement(created_at);

-- ---------------------------------------------------------------------------
-- Period snapshots (frozen weekly / monthly opening & closing)
-- ---------------------------------------------------------------------------
CREATE TABLE period_snapshot (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bu_item_id      uuid NOT NULL REFERENCES bu_item(id),
  period_type     period_type NOT NULL,
  period_start    date NOT NULL,
  period_end      date NOT NULL,
  opening_qty     numeric(14,3),
  received_qty    numeric(14,3) NOT NULL DEFAULT 0,
  wastage_qty     numeric(14,3) NOT NULL DEFAULT 0,
  transfer_qty    numeric(14,3) NOT NULL DEFAULT 0,      -- net (in - out)
  adjustment_qty  numeric(14,3) NOT NULL DEFAULT 0,
  closing_qty     numeric(14,3),
  consumed_qty    numeric(14,3),                          -- derived; exposed to super_admin only
  count_days      int NOT NULL DEFAULT 0,                 -- days with both sessions submitted
  missing_days    int NOT NULL DEFAULT 0,
  is_locked       boolean NOT NULL DEFAULT false,
  locked_by       uuid REFERENCES app_user(id),
  locked_at       timestamptz,
  computed_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bu_item_id, period_type, period_start)
);
CREATE INDEX ix_snapshot_period ON period_snapshot(period_type, period_start);

-- Period lock at BU level (drives immutability of counts in that range)
CREATE TABLE period_lock (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bu_id        uuid NOT NULL REFERENCES business_unit(id),
  period_type  period_type NOT NULL,
  period_start date NOT NULL,
  period_end   date NOT NULL,
  locked_by    uuid NOT NULL REFERENCES app_user(id),
  locked_at    timestamptz NOT NULL DEFAULT now(),
  unlocked_by  uuid REFERENCES app_user(id),
  unlocked_at  timestamptz,
  reason       text,
  UNIQUE (bu_id, period_type, period_start)
);

-- ---------------------------------------------------------------------------
-- Reminders and notifications
-- ---------------------------------------------------------------------------
CREATE TABLE reminder (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bu_id                  uuid NOT NULL REFERENCES business_unit(id),
  user_id                uuid REFERENCES app_user(id),    -- NULL = every member of the BU
  kind                   reminder_kind NOT NULL,
  title                  text NOT NULL,
  body                   text,
  time_of_day            time NOT NULL,
  days_of_week           smallint[] NOT NULL DEFAULT '{1,2,3,4,5,6,7}', -- ISO: 1=Mon
  day_of_month           smallint,                         -- for monthly_close
  timezone               text NOT NULL DEFAULT 'Asia/Kolkata',
  escalate_after_minutes int,                              -- push to bu_manager if count still missing
  is_active              boolean NOT NULL DEFAULT true,
  created_by             uuid REFERENCES app_user(id),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_reminder_bu ON reminder(bu_id) WHERE is_active;

CREATE TABLE device (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  platform     device_platform NOT NULL,
  push_token   text NOT NULL UNIQUE,
  device_name  text,
  app_version  text,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE refresh_token ADD CONSTRAINT fk_refresh_device FOREIGN KEY (device_id) REFERENCES device(id) ON DELETE SET NULL;

CREATE TABLE notification (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  reminder_id   uuid REFERENCES reminder(id) ON DELETE SET NULL,
  kind          text NOT NULL,                             -- 'reminder','missed_count','escalation','low_stock','expiry'
  title         text NOT NULL,
  body          text,
  data          jsonb,                                     -- deep-link payload
  scheduled_for timestamptz NOT NULL,
  sent_at       timestamptz,
  status        notification_status NOT NULL DEFAULT 'scheduled',
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_notification_due ON notification(scheduled_for) WHERE status = 'scheduled';

-- ---------------------------------------------------------------------------
-- Integration: API clients, webhooks
-- ---------------------------------------------------------------------------
CREATE TABLE api_client (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL UNIQUE,                       -- 'matter-prod', 'infinity-staging'
  key_prefix   text NOT NULL,                              -- first 8 chars, for identification
  key_hash     text NOT NULL UNIQUE,                       -- sha256
  scopes       text[] NOT NULL DEFAULT '{}',
  allowed_ips  inet[],
  is_active    boolean NOT NULL DEFAULT true,
  last_used_at timestamptz,
  created_by   uuid REFERENCES app_user(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  revoked_at   timestamptz
);
ALTER TABLE stock_movement ADD CONSTRAINT fk_movement_api_client FOREIGN KEY (api_client_id) REFERENCES api_client(id);

CREATE TABLE webhook (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  api_client_id uuid NOT NULL REFERENCES api_client(id) ON DELETE CASCADE,
  url           text NOT NULL,
  secret        text NOT NULL,                             -- HMAC-SHA256 of body in X-SMS-Signature
  events        text[] NOT NULL,                           -- 'count.submitted','movement.created','snapshot.locked','lot.created'
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE webhook_delivery (
  id            bigserial PRIMARY KEY,
  webhook_id    uuid NOT NULL REFERENCES webhook(id) ON DELETE CASCADE,
  event         text NOT NULL,
  event_id      uuid NOT NULL,                             -- idempotency key for the receiver
  payload       jsonb NOT NULL,
  attempt       int NOT NULL DEFAULT 0,
  status        delivery_status NOT NULL DEFAULT 'pending',
  response_code int,
  response_body text,
  next_retry_at timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  delivered_at  timestamptz
);
CREATE INDEX ix_webhook_delivery_due ON webhook_delivery(next_retry_at) WHERE status = 'pending';

-- ---------------------------------------------------------------------------
-- Audit and ops
-- ---------------------------------------------------------------------------
CREATE TABLE audit_log (
  id              bigserial PRIMARY KEY,
  at              timestamptz NOT NULL DEFAULT now(),
  actor_user_id   uuid REFERENCES app_user(id),
  actor_client_id uuid REFERENCES api_client(id),
  action          text NOT NULL,                           -- 'count.submit','count.reopen','period.lock','item.update' ...
  entity_type     text NOT NULL,
  entity_id       text NOT NULL,
  bu_id           uuid REFERENCES business_unit(id),
  before          jsonb,
  after           jsonb,
  ip              inet,
  user_agent      text
);
CREATE INDEX ix_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX ix_audit_bu_at ON audit_log(bu_id, at DESC);

CREATE TABLE job_run (
  id          bigserial PRIMARY KEY,
  job_name    text NOT NULL,
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status      text NOT NULL DEFAULT 'running',             -- running, ok, failed
  message     text
);

CREATE TABLE app_setting (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['business_unit','app_user','item','instrument','bu_item','stock_lot','stock_count','reminder']
  LOOP
    EXECUTE format('CREATE TRIGGER trg_%s_updated BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t, t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------------------

-- Latest submitted count per bu_item (either session), aggregated across lots.
CREATE OR REPLACE VIEW v_last_count AS
SELECT DISTINCT ON (l.bu_item_id)
       l.bu_item_id,
       c.count_date,
       c.session,
       c.submitted_at,
       SUM(l.qty) OVER (PARTITION BY l.count_id, l.bu_item_id) AS qty
FROM stock_count_line l
JOIN stock_count c ON c.id = l.count_id
WHERE c.status IN ('submitted','locked')
ORDER BY l.bu_item_id, c.count_date DESC, (c.session = 'closing') DESC, c.submitted_at DESC;

-- Current stock = last count + movements after that count. Safe for every role (no consumption).
CREATE OR REPLACE VIEW v_current_stock AS
SELECT bi.id            AS bu_item_id,
       bi.bu_id,
       bi.item_id,
       bi.instrument_id,
       lc.count_date    AS last_count_date,
       lc.session       AS last_count_session,
       COALESCE(lc.qty, 0)
         + COALESCE((SELECT SUM(m.qty_delta) FROM stock_movement m
                     WHERE m.bu_item_id = bi.id
                       AND (lc.submitted_at IS NULL OR m.occurred_at > lc.submitted_at)), 0) AS qty_on_hand,
       bi.min_level,
       bi.max_level,
       (bi.min_level IS NOT NULL AND
        COALESCE(lc.qty,0) + COALESCE((SELECT SUM(m.qty_delta) FROM stock_movement m
                     WHERE m.bu_item_id = bi.id
                       AND (lc.submitted_at IS NULL OR m.occurred_at > lc.submitted_at)),0) < bi.min_level) AS is_low
FROM bu_item bi
LEFT JOIN v_last_count lc ON lc.bu_item_id = bi.id
WHERE bi.is_active;

-- Daily consumption. Query ONLY from Reports/Export repositories guarded by super_admin / export:consumption.
-- Movements count towards a day only when they were recorded BETWEEN the opening and the closing submission:
-- a receipt logged before the morning count is already inside the opening figure, and anything after the
-- closing count belongs to the next opening's expectation. This mirrors the prefill rule.
CREATE OR REPLACE VIEW v_daily_consumption AS
WITH sess AS (
  SELECT c.bu_id, c.count_date, c.session, c.submitted_at, l.bu_item_id, SUM(l.qty) AS qty
  FROM stock_count c
  JOIN stock_count_line l ON l.count_id = c.id
  WHERE c.status IN ('submitted','locked')
  GROUP BY c.bu_id, c.count_date, c.session, c.submitted_at, l.bu_item_id
),
days AS (
  SELECT o.bu_id, o.count_date, o.bu_item_id, o.qty AS opening_qty, cl.qty AS closing_qty,
         o.submitted_at AS opening_at, cl.submitted_at AS closing_at
  FROM sess o
  JOIN sess cl ON cl.bu_id = o.bu_id AND cl.count_date = o.count_date
             AND cl.bu_item_id = o.bu_item_id AND cl.session = 'closing'
  WHERE o.session = 'opening'
)
SELECT d.bu_id, d.bu_item_id, d.count_date,
       d.opening_qty, d.closing_qty,
       COALESCE(mv.received,0)     AS received_qty,
       COALESCE(mv.wastage,0)      AS wastage_qty,       -- negative
       COALESCE(mv.transfer_net,0) AS transfer_qty,
       COALESCE(mv.adjustment,0)   AS adjustment_qty,
       d.opening_qty + COALESCE(mv.received,0) + COALESCE(mv.wastage,0)
         + COALESCE(mv.transfer_net,0) + COALESCE(mv.adjustment,0) - d.closing_qty AS consumed_qty
FROM days d
LEFT JOIN LATERAL (
  SELECT SUM(qty_delta) FILTER (WHERE movement_type = 'receipt')                          AS received,
         SUM(qty_delta) FILTER (WHERE movement_type IN ('wastage','expiry_writeoff'))     AS wastage,
         SUM(qty_delta) FILTER (WHERE movement_type IN ('transfer_in','transfer_out'))    AS transfer_net,
         SUM(qty_delta) FILTER (WHERE movement_type IN ('adjustment','return_to_supplier')) AS adjustment
  FROM stock_movement m
  WHERE m.bu_item_id = d.bu_item_id AND m.occurred_at > d.opening_at AND m.occurred_at <= d.closing_at
) mv ON true;

INSERT INTO sms_migration(script) VALUES ('001_schema.sql') ON CONFLICT DO NOTHING;
