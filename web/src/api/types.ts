// Shapes mirror the API's snake_case JSON (api/src/Sms.Api/Endpoints/*).

export type Role = 'super_admin' | 'admin' | 'bu_manager' | 'lab_tech' | 'viewer';

export interface User {
  id: string; email: string; full_name: string; phone?: string | null; role: Role; capabilities: string[];
}
export interface BuSummary { id: string; code: string; name: string; timezone: string; is_default: boolean }
export interface Session { access_token: string; refresh_token: string; expires_in: number; user: User; business_units: BuSummary[] }

export interface BusinessUnit {
  id: string; code: string; name: string; bu_type: string; address?: string | null; timezone: string;
  opening_due_time: string; closing_due_time: string; grace_minutes: number; variance_tolerance_pct: number;
  is_active: boolean; instrument_count: number; item_count: number; member_count: number; created_at: string; updated_at: string;
}
export interface Instrument {
  id: string; bu_id: string; instrument_model_id: string; manufacturer: string; model_name: string; category: string;
  serial_no: string; asset_tag?: string | null; label?: string | null; installed_on?: string | null; status: 'active' | 'down' | 'retired';
  notes?: string | null; tracked_item_count: number;
}
export interface InstrumentModel {
  id: string; manufacturer: string; model_name: string; category: string; notes?: string | null; is_active: boolean; item_count: number; instrument_count: number;
}
export interface Supplier { id: string; name: string; contact?: string | null; gstin?: string | null; is_active: boolean }
export type ItemKind = 'reagent' | 'calibrator' | 'control' | 'consumable' | 'material';
export interface Item {
  id: string; code: string; name: string; kind: ItemKind; category?: string | null; manufacturer?: string | null; catalogue_no?: string | null;
  base_uom: string; pack_size: number; pack_uom: string; tracks_lot: boolean; tracks_expiry: boolean; storage: string; hazard?: string | null;
  instrument_model_id?: string | null; instrument_model_name?: string | null; default_min_level?: number | null; is_active: boolean; updated_at: string;
}
export interface BuItem {
  id: string; bu_id: string; item_id: string; item_code: string; item_name: string; kind: ItemKind; category?: string | null;
  base_uom: string; pack_size: number; pack_uom: string; tracks_lot: boolean; tracks_expiry: boolean; storage: string;
  instrument_id?: string | null; instrument_label?: string | null; instrument_model?: string | null; instrument_serial?: string | null;
  min_level?: number | null; max_level?: number | null; reorder_qty?: number | null; sort_order: number; is_active: boolean;
  qty_on_hand: number; is_low: boolean; last_count_date?: string | null; last_count_session?: string | null; active_lot_count: number; nearest_expiry?: string | null;
}
export interface Lot {
  id: string; bu_item_id: string; bu_id: string; item_code: string; item_name: string; base_uom: string; pack_size: number; instrument_label?: string | null;
  lot_no: string; expiry_date?: string | null; supplier_id?: string | null; supplier_name?: string | null; received_on: string; received_qty: number;
  unit_cost?: number | null; status: 'active' | 'exhausted' | 'expired' | 'quarantined'; qty_on_hand: number; days_to_expiry?: number | null; created_at: string; updated_at: string;
}
export type MovementType = 'receipt' | 'wastage' | 'transfer_out' | 'transfer_in' | 'adjustment' | 'return_to_supplier' | 'expiry_writeoff';
export interface Movement {
  id: string; bu_item_id: string; bu_id: string; item_code: string; item_name: string; base_uom: string; instrument_label?: string | null;
  lot_id?: string | null; lot_no?: string | null; movement_type: MovementType; qty_delta: number; occurred_on: string; occurred_at: string;
  reference_type?: string | null; reference_id?: string | null; counterpart_bu_item_id?: string | null; counterpart_bu_code?: string | null;
  note?: string | null; created_by?: string | null; api_client?: string | null; created_at: string;
}
export type CountStatus = 'draft' | 'submitted' | 'locked';
export type Session_ = 'opening' | 'closing';
export interface CountHeader {
  id: string; bu_id: string; bu_code: string; count_date: string; session: Session_; status: CountStatus; note?: string | null;
  created_by?: string | null; submitted_by?: string | null; submitted_at?: string | null; reopened_by?: string | null; reopened_at?: string | null;
  created_at: string; updated_at: string; line_count: number; confirmed_count: number; variance_count: number;
}
export interface CountLine {
  id: string; bu_item_id: string; lot_id?: string | null; lot_no?: string | null; expiry_date?: string | null; qty: number;
  packs_entered?: number | null; loose_entered?: number | null; expected_qty?: number | null; variance: number; is_confirmed: boolean; note?: string | null;
  item_code: string; item_name: string; kind: ItemKind; base_uom: string; pack_size: number; pack_uom: string; tracks_lot: boolean;
  instrument_id?: string | null; instrument_label?: string | null; instrument_model?: string | null; requires_note: boolean;
}
export interface CountDetail { header: CountHeader; lines: CountLine[]; variance_tolerance_pct: number; uncounted_lot_items?: BuItem[] }
export type TodayStatus = 'submitted' | 'draft' | 'pending' | 'missed';
export interface Today {
  date: string; local_time: string; opening_due_time: string; closing_due_time: string; grace_minutes: number;
  opening?: CountHeader | null; closing?: CountHeader | null; opening_status: TodayStatus; closing_status: TodayStatus;
}
export interface Alerts {
  low_stock: BuItem[]; expiring_lots: Lot[]; missed_counts: { date: string; session: Session_ }[];
  recent_variances: { count_date: string; session: Session_; item_name: string; lot_no?: string | null; qty: number; expected_qty: number; variance: number; note?: string | null; submitted_by?: string | null }[];
}
export interface Snapshot {
  id: string; bu_item_id: string; bu_id: string; bu_code: string; item_code: string; item_name: string; kind: ItemKind; base_uom: string; instrument_label?: string | null;
  period_type: 'week' | 'month'; period_start: string; period_end: string; opening_qty?: number | null; received_qty: number; wastage_qty: number; transfer_qty: number;
  adjustment_qty: number; closing_qty?: number | null; consumed_qty?: number | null; count_days: number; missing_days: number; is_locked: boolean; computed_at: string;
}
export interface SnapshotSet { period_type: 'week' | 'month'; period_start: string; period_end: string; is_locked?: boolean; locked_bus?: string[]; items: Snapshot[] }
export interface AdminUser {
  id: string; email: string; full_name: string; phone?: string | null; role: Role; is_active: boolean; last_login_at?: string | null; created_at: string; bu_codes: string[]; bu_ids: string[];
}
export interface ApiKey { id: string; name: string; key_prefix: string; scopes: string[]; allowed_ips?: string[] | null; is_active: boolean; last_used_at?: string | null; created_at: string; revoked_at?: string | null }
export interface AuditRow {
  id: number; at: string; actor_user_id?: string | null; actor_name?: string | null; actor_client_id?: string | null; client_name?: string | null; action: string;
  entity_type: string; entity_id: string; bu_id?: string | null; bu_code?: string | null; before?: string | null; after?: string | null; ip?: string | null;
}
export interface JobRun { id: number; job_name: string; started_at: string; finished_at?: string | null; status: string; message?: string | null }
export interface ItemHistory {
  item: BuItem; lots: Lot[]; movements: Movement[];
  counts: { count_date: string; session: Session_; status: CountStatus; qty: number; expected_qty?: number | null; submitted_by?: string | null }[];
}
export interface ConsumptionGroup { key_id: string; key_code: string; key_name: string; base_uom?: string | null; consumed_qty?: number | null; received_qty?: number | null; wastage_qty?: number | null; days: number; items: number }
export interface ConsumptionReport { from: string; to: string; group_by: string; groups: ConsumptionGroup[]; series: { count_date: string; consumed_qty?: number | null; received_qty?: number | null; wastage_qty?: number | null }[] }
export interface DailyConsumption {
  count_date: string; bu_id: string; bu_code: string; bu_item_id: string; item_code: string; item_name: string; kind: ItemKind; base_uom: string; instrument_label?: string | null;
  opening_qty: number; received_qty: number; wastage_qty: number; transfer_qty: number; adjustment_qty: number; closing_qty: number; consumed_qty: number;
}
export interface MissedCell { bu_id: string; bu_code: string; bu_name: string; count_date: string; session: Session_; status?: CountStatus | null; submitted_by?: string | null; submitted_at?: string | null }
export interface Overview {
  month_start: string;
  business_units: { bu_id: string; bu_code: string; bu_name: string; reagent_consumed?: number | null; counted_days: number; items: number; low_items: number }[];
  top_items_30d: { item_id: string; item_code: string; item_name: string; base_uom: string; consumed_qty: number }[];
}
export interface PeriodLock { id: string; bu_id: string; bu_code: string; period_type: 'week' | 'month'; period_start: string; period_end: string; locked_by?: string | null; locked_at: string; unlocked_by?: string | null; unlocked_at?: string | null; reason?: string | null }
export interface ApiError { code: string; message: string; details?: unknown }
