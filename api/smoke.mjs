// End-to-end smoke test against a running API with SMS_SEED_DEV=true.
//   node api/smoke.mjs http://localhost:8095
// Exercises: login, receipt, opening + closing counts, submit validation, super_admin
// consumption report, role denial, snapshots, API key export. Exits non-zero on failure.

const base = process.argv[2] ?? 'http://localhost:8095';
let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) failures++; };

async function call(method, path, { token, key, body } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (key) headers['x-api-key'] = key;
  const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json; try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json };
}
const login = async (email, password) => (await call('POST', '/api/v1/auth/login', { body: { email, password } })).json;

// ---- sign in ---------------------------------------------------------------
const tech = await login('tech@sms.local', 'Tech123!');
ok(tech.access_token, 'tech signs in');
ok(tech.business_units?.length === 1, 'tech sees exactly one BU');
const bu = tech.business_units[0].id;
const T = tech.access_token;

const me = await call('GET', '/api/v1/auth/me', { token: T });
ok(me.json.user.role === 'lab_tech' && me.json.user.capabilities.includes('counts.edit'), 'me returns role + capabilities');

// ---- items + receipt -------------------------------------------------------
const items = (await call('GET', `/api/v1/bus/${bu}/items`, { token: T })).json;
ok(items.length > 15, `BU has ${items.length} tracked items`);
const cellpack = items.find(i => i.item_code === 'RG-XN-CELLPACK');
const gloves = items.find(i => i.item_code === 'MT-GLOVES-M');
ok(cellpack?.instrument_label && cellpack.tracks_lot, 'CELLPACK is instrument-bound and lot tracked');

const receipt = await call('POST', `/api/v1/bus/${bu}/lots`, { token: T, body: { bu_item_id: cellpack.id, lot_no: 'L2609A', expiry_date: '2027-06-30', packs: 2 } });
ok(receipt.status === 201 && receipt.json.lot.qty_on_hand === 40000, `receipt creates lot with 40000 mL on hand (got ${receipt.json.lot?.qty_on_hand})`);
const glovesIn = await call('POST', `/api/v1/bus/${bu}/lots`, { token: T, body: { bu_item_id: gloves.id, packs: 5 } });
ok(glovesIn.status === 201 && glovesIn.json.lot == null && glovesIn.json.movement.qty_delta === 500, 'receipt of non-lot item creates movement only');

// ---- opening count ---------------------------------------------------------
const opening = await call('POST', `/api/v1/bus/${bu}/counts`, { token: T, body: { session: 'opening' } });
ok(opening.status === 201 || opening.status === 200, `opening draft created (${opening.status})`);
const countId = opening.json.header.id;
const lotLine = opening.json.lines.find(l => l.bu_item_id === cellpack.id);
ok(lotLine?.lot_no === 'L2609A' && lotLine.expected_qty === 40000, `opening prefill for new lot = 40000 (got ${lotLine?.expected_qty})`);
const glovesLine = opening.json.lines.find(l => l.bu_item_id === gloves.id);
ok(glovesLine?.expected_qty === 500, `opening prefill for gloves = 500 (got ${glovesLine?.expected_qty})`);

// Submitting with unconfirmed lines must fail.
let submit = await call('POST', `/api/v1/counts/${countId}/submit`, { token: T, body: {} });
ok(submit.status === 400 && submit.json.error.details.unconfirmed.length > 0, 'submit refuses unconfirmed lines');

// Enter one line with a big variance and no note -> needs a note.
await call('PUT', `/api/v1/counts/${countId}/lines`, { token: T, body: [{ bu_item_id: gloves.id, packs: 3, loose: 20 }] });
await call('POST', `/api/v1/counts/${countId}/confirm-remaining`, { token: T });
submit = await call('POST', `/api/v1/counts/${countId}/submit`, { token: T, body: {} });
ok(submit.status === 400 && submit.json.error.details.missing_notes?.length === 1, 'submit demands a note for the variance line');
await call('PUT', `/api/v1/counts/${countId}/lines`, { token: T, body: [{ bu_item_id: gloves.id, note: 'Two boxes moved to phlebotomy room' }] });
submit = await call('POST', `/api/v1/counts/${countId}/submit`, { token: T, body: {} });
ok(submit.status === 200 && submit.json.header.status === 'submitted', 'opening count submitted');

// ---- wastage + closing count ----------------------------------------------
const waste = await call('POST', `/api/v1/bus/${bu}/movements`, { token: T, body: { bu_item_id: cellpack.id, lot_id: lotLine.lot_id, movement_type: 'wastage', qty: 1000, note: 'spill' } });
ok(waste.status === 201 && waste.json.qty_delta === -1000, 'wastage recorded as negative delta');

const closing = await call('POST', `/api/v1/bus/${bu}/counts`, { token: T, body: { session: 'closing' } });
const closingId = closing.json.header.id;
const closingLot = closing.json.lines.find(l => l.bu_item_id === cellpack.id);
ok(closingLot.expected_qty === 39000, `closing prefill = opening 40000 - 1000 wastage (got ${closingLot.expected_qty})`);
await call('PUT', `/api/v1/counts/${closingId}/lines`, { token: T, body: [
  { bu_item_id: cellpack.id, lot_id: lotLine.lot_id, qty: 37500, note: 'day run' },
  { bu_item_id: gloves.id, qty: 250, note: 'used' },
] });
await call('POST', `/api/v1/counts/${closingId}/confirm-remaining`, { token: T });
submit = await call('POST', `/api/v1/counts/${closingId}/submit`, { token: T, body: {} });
ok(submit.status === 200, 'closing count submitted');

const today = (await call('GET', `/api/v1/bus/${bu}/counts/today`, { token: T })).json;
ok(today.opening_status === 'submitted' && today.closing_status === 'submitted', 'today shows both sessions submitted');

const levels = (await call('GET', `/api/v1/bus/${bu}/levels`, { token: T })).json;
ok(levels.find(l => l.id === cellpack.id)?.qty_on_hand === 37500, 'level = last closing count');

// ---- role boundaries -------------------------------------------------------
const viewer = await login('viewer@sms.local', 'Viewer123!');
const vEdit = await call('PUT', `/api/v1/counts/${closingId}/lines`, { token: viewer.access_token, body: [] });
ok(vEdit.status === 403, 'viewer cannot edit counts');
const manager = await login('manager@sms.local', 'Manager123!');
const mReport = await call('GET', '/api/v1/reports/consumption', { token: manager.access_token });
ok(mReport.status === 403, 'manager is denied consumption reports');
const reopen = await call('POST', `/api/v1/counts/${closingId}/reopen`, { token: manager.access_token, body: { reason: 'recount' } });
ok(reopen.status === 200 && reopen.json.header.status === 'draft', 'manager can reopen with a reason');
submit = await call('POST', `/api/v1/counts/${closingId}/submit`, { token: manager.access_token, body: {} });
ok(submit.status === 200, 're-submitted after reopen');

// ---- super admin: consumption, snapshots, API key -------------------------
const admin = await login('admin@sms.local', 'ChangeMe123!');
const A = admin.access_token;
const daily = (await call('GET', `/api/v1/reports/consumption/daily?bu_id=${bu}`, { token: A })).json;
const cp = daily.find(d => d.bu_item_id === cellpack.id);
ok(cp?.consumed_qty === 1500, `super_admin sees CELLPACK consumed 1500 (40000 - 1000 wastage - 37500 = ${cp?.consumed_qty})`);
const gl = daily.find(d => d.bu_item_id === gloves.id);
ok(gl?.consumed_qty === 70, `gloves consumed 70 (320 opening - 250 closing = ${gl?.consumed_qty})`);
const grouped = (await call('GET', '/api/v1/reports/consumption?group_by=instrument', { token: A })).json;
ok(grouped.groups.length >= 1, 'grouped consumption by instrument');

const snap = (await call('GET', `/api/v1/bus/${bu}/snapshots?period_type=week`, { token: manager.access_token })).json;
const snapCp = snap.items.find(s => s.bu_item_id === cellpack.id);
ok(snapCp && snapCp.closing_qty === 37500 && snapCp.consumed_qty === undefined, 'manager weekly snapshot has closing but no consumed field');

const keyRes = await call('POST', '/api/v1/admin/api-keys', { token: A, body: { name: 'smoke-' + Date.now(), scopes: ['export:counts', 'export:consumption', 'catalogue:read'] } });
ok(keyRes.status === 201 && keyRes.json.key.startsWith('sms_live_'), 'API key issued');
const exp = await call('GET', `/export/v1/counts?bu=${tech.business_units[0].code}`, { key: keyRes.json.key });
ok(exp.status === 200 && exp.json.items.length >= 2 && exp.json.items[0].lines.length > 0, `export returns ${exp.json.items?.length} submitted counts with lines`);
const expNo = await call('GET', '/export/v1/movements', { key: keyRes.json.key });
ok(expNo.status === 403, 'export refuses missing scope');
const expCons = await call('GET', '/export/v1/consumption/daily', { key: keyRes.json.key });
ok(expCons.status === 200 && expCons.json.items.length >= 2, 'export consumption with scope');

const audit = (await call('GET', '/api/v1/admin/audit?limit=5', { token: A })).json;
ok(audit.length === 5 && audit.some(a => a.action === 'count.reopen'), 'audit log records the reopen');

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
