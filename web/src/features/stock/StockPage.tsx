import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '@/api/client';
import { useHistory, useInstruments, useInvalidateBu, useLevels } from '@/api/hooks';
import type { BuItem } from '@/api/types';
import { useAuth, useBuId } from '@/auth/AuthProvider';
import { Button, Chip, Drawer, Empty, Field, Icon, Input, PageHead, Panel, Select, Skeleton, fmtDate, fmtQty, kindLabel, movementLabel, useMediaQuery, useToast } from '@/ui';

export function StockPage() {
  const bu = useBuId();
  const { can } = useAuth();
  const levels = useLevels(bu);
  const instruments = useInstruments(bu);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [ins, setIns] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const desktop = useMediaQuery('(min-width: 768px)');

  const rows = useMemo(() => (levels.data ?? []).filter(i =>
    (!q || i.item_name.toLowerCase().includes(q.toLowerCase()) || i.item_code.toLowerCase().includes(q.toLowerCase())) &&
    (!kind || i.kind === kind) && (!ins || (ins === 'general' ? !i.instrument_id : i.instrument_id === ins)) && (!lowOnly || i.is_low)), [levels.data, q, kind, ins, lowOnly]);

  const status = (i: BuItem) => i.qty_on_hand <= 0 ? <Chip tone="danger" icon="x">Out</Chip> : i.is_low ? <Chip tone="warn">Low</Chip> : <Chip tone="ok">OK</Chip>;

  return (
    <>
      <PageHead title="Stock levels" sub="Last count plus every movement since" actions={can('stock.receive') && <><Link to="/stock/receive" className="btn primary"><Icon name="truck" size={18} />Receive</Link><Link to="/stock/move" className="btn"><Icon name="swap" size={18} />Wastage / adjust</Link></>} />
      <div className="filters">
        <Field><Input placeholder="Search item or code" value={q} onChange={e => setQ(e.target.value)} aria-label="Search" style={{ minWidth: 200 }} /></Field>
        <Field><Select value={kind} onChange={e => setKind(e.target.value)} aria-label="Kind"><option value="">All kinds</option>{Object.entries(kindLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        <Field><Select value={ins} onChange={e => setIns(e.target.value)} aria-label="Instrument"><option value="">All instruments</option>{instruments.data?.map(i => <option key={i.id} value={i.id}>{i.label ?? `${i.model_name} · ${i.serial_no}`}</option>)}<option value="general">General items</option></Select></Field>
        <label className="check"><input type="checkbox" checked={lowOnly} onChange={e => setLowOnly(e.target.checked)} />Low only</label>
        <span className="small muted">{rows.length} items</span>
      </div>
      {levels.isLoading ? <Skeleton rows={6} /> : rows.length === 0 ? <Panel><Empty title="No items match">Try clearing a filter.</Empty></Panel> : desktop ? (
        <Panel><div className="table-wrap"><table>
          <thead><tr><th>Item</th><th>Instrument</th><th className="num">On hand</th><th className="num">Min</th><th>Status</th><th>Lots</th><th>Last count</th></tr></thead>
          <tbody>{rows.map(i => (
            <tr key={i.id} onClick={() => setOpen(i.id)} style={{ cursor: 'pointer' }}>
              <td><div>{i.item_name}</div><div className="small muted mono">{i.item_code}</div></td>
              <td className="small muted">{i.instrument_label ?? 'General'}</td>
              <td className="num"><b>{fmtQty(i.qty_on_hand)}</b> <span className="small muted" style={{ fontFamily: 'var(--font)' }}>{i.base_uom}</span></td>
              <td className="num muted">{fmtQty(i.min_level)}</td>
              <td>{status(i)}</td>
              <td className="small muted">{i.tracks_lot ? `${i.active_lot_count} active${i.nearest_expiry ? ` · exp ${fmtDate(i.nearest_expiry, { month: 'short', year: '2-digit' })}` : ''}` : '—'}</td>
              <td className="small muted">{i.last_count_date ? `${fmtDate(i.last_count_date)} ${i.last_count_session}` : 'never'}</td>
            </tr>
          ))}</tbody>
        </table></div></Panel>
      ) : (
        <Panel>{rows.map(i => (
          <button key={i.id} className="alert-row" style={{ width: '100%', background: 'none', border: 0, textAlign: 'left', color: 'inherit' }} onClick={() => setOpen(i.id)}>
            <span className="grow"><div className="truncate">{i.item_name}</div><div className="small muted">{i.instrument_label ?? 'General'} · <span className="mono">{i.item_code}</span></div></span>
            <span className="right"><div className="mono tnum" style={{ fontWeight: 600 }}>{fmtQty(i.qty_on_hand)} <span className="small muted">{i.base_uom}</span></div><div>{status(i)}</div></span>
          </button>
        ))}</Panel>
      )}
      <ItemDrawer bu={bu} id={open} onClose={() => setOpen(null)} />
    </>
  );
}

export function ItemDrawer({ bu, id, onClose }: { bu: string; id: string | null; onClose: () => void }) {
  const h = useHistory(bu, id ?? undefined);
  const { can } = useAuth();
  const toast = useToast();
  const invalidate = useInvalidateBu(bu);
  const [edit, setEdit] = useState(false);
  const [min, setMin] = useState(''); const [max, setMax] = useState(''); const [reorder, setReorder] = useState('');
  const [saving, setSaving] = useState(false);
  const it = h.data?.item;

  async function save() {
    if (!it) return;
    setSaving(true);
    try {
      await api.patch(`/api/v1/bus/${bu}/items/${it.id}`, { min_level: min === '' ? null : +min, max_level: max === '' ? null : +max, reorder_qty: reorder === '' ? null : +reorder });
      invalidate(); h.refetch(); setEdit(false); toast('Thresholds saved', 'ok');
    } catch (e) { toast(errorMessage(e), 'error'); } finally { setSaving(false); }
  }

  return (
    <Drawer open={!!id} onClose={onClose} title={it ? it.item_name : 'Item'}>
      {h.isLoading || !it ? <Skeleton rows={4} /> : (
        <div className="stack">
          <div className="row wrap"><Chip tone="brand" icon={null}>{kindLabel[it.kind]}</Chip><span className="mono small">{it.item_code}</span>{it.instrument_label && <span className="small muted">· {it.instrument_label}</span>}</div>
          <div className="panel stats">
            <div className="stat"><span className="label">On hand</span><span className="value">{fmtQty(it.qty_on_hand)}<small>{it.base_uom}</small></span></div>
            <div className="stat"><span className="label">Minimum</span><span className="value">{fmtQty(it.min_level)}</span></div>
            <div className="stat"><span className="label">Pack</span><span className="value">{fmtQty(it.pack_size)}<small>{it.base_uom} / {it.pack_uom}</small></span></div>
          </div>
          {can('bu.items') && (edit ? (
            <Panel title="Thresholds" pad>
              <div className="grid-2">
                <Field label={`Minimum (${it.base_uom})`}><Input type="number" inputMode="decimal" value={min} onChange={e => setMin(e.target.value)} /></Field>
                <Field label="Maximum"><Input type="number" inputMode="decimal" value={max} onChange={e => setMax(e.target.value)} /></Field>
                <Field label="Reorder quantity"><Input type="number" inputMode="decimal" value={reorder} onChange={e => setReorder(e.target.value)} /></Field>
              </div>
              <div className="form-actions"><Button onClick={() => setEdit(false)}>Cancel</Button><Button variant="primary" onClick={save} loading={saving}>Save</Button></div>
            </Panel>
          ) : <Button size="sm" icon="edit" onClick={() => { setMin(it.min_level?.toString() ?? ''); setMax(it.max_level?.toString() ?? ''); setReorder(it.reorder_qty?.toString() ?? ''); setEdit(true); }}>Edit thresholds</Button>)}
          {it.tracks_lot && (
            <Panel title={`Lots (${h.data!.lots.filter(l => l.status === 'active').length} active)`}>
              {h.data!.lots.length === 0 ? <Empty title="No lots received yet" /> : h.data!.lots.map(l => (
                <div className="alert-row" key={l.id}><span className="grow"><div className="mono">{l.lot_no}</div><div className="small muted">exp {fmtDate(l.expiry_date, { day: 'numeric', month: 'short', year: 'numeric' })} · received {fmtDate(l.received_on)}{l.supplier_name && ` · ${l.supplier_name}`}</div></span>
                  <span className="right"><div className="mono tnum">{fmtQty(l.qty_on_hand)}</div><Chip tone={l.status === 'active' ? 'ok' : l.status === 'expired' ? 'danger' : 'neutral'} icon={null}>{l.status}</Chip></span></div>
              ))}
            </Panel>
          )}
          <Panel title="Recent counts">
            {h.data!.counts.length === 0 ? <Empty title="Not counted in the last 30 days" /> : <table><tbody>{h.data!.counts.slice(0, 12).map((c, i) => (
              <tr key={i}><td className="small">{fmtDate(c.count_date)} <span className="muted">{c.session}</span></td><td className="num">{fmtQty(c.qty)}</td><td className="num small muted">{c.expected_qty !== null && c.expected_qty !== undefined && c.qty - c.expected_qty !== 0 ? <span className={`delta ${c.qty - c.expected_qty > 0 ? 'pos' : 'neg'}`}>{c.qty - c.expected_qty > 0 ? '+' : ''}{fmtQty(c.qty - c.expected_qty)}</span> : ''}</td></tr>
            ))}</tbody></table>}
          </Panel>
          <Panel title="Recent movements">
            {h.data!.movements.length === 0 ? <Empty title="No movements in the last 30 days" /> : <table><tbody>{h.data!.movements.slice(0, 20).map(m => (
              <tr key={m.id}><td className="small">{fmtDate(m.occurred_on)}<div className="muted">{movementLabel[m.movement_type]}{m.lot_no && <span className="mono"> · {m.lot_no}</span>}{m.counterpart_bu_code && ` · ${m.counterpart_bu_code}`}</div></td><td className={`num delta ${m.qty_delta > 0 ? 'pos' : 'neg'}`}>{m.qty_delta > 0 ? '+' : ''}{fmtQty(m.qty_delta)}</td></tr>
            ))}</tbody></table>}
          </Panel>
        </div>
      )}
    </Drawer>
  );
}
