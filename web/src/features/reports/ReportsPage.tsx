import { useMemo, useState } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, errorMessage } from '@/api/client';
import { useBus, useCatalogueItems } from '@/api/hooks';
import type { ConsumptionReport, MissedCell, Overview, PeriodLock, Snapshot } from '@/api/types';
import { Button, Chip, Confirm, Empty, Field, Icon, Input, PageHead, Panel, PillTabs, Select, Skeleton, addDays, fmtDate, fmtDateTime, fmtQty, todayIso, useToast } from '@/ui';
import { BarList, LineChart } from '@/ui/charts';
import { periodLabel, periodStart, shiftPeriod } from '../snapshots/SnapshotsPage';

export function ReportsPage() {
  return (
    <>
      <PageHead title="Reports" sub="Consumption is derived from counts and the ledger. Visible to super admins only." />
      <nav className="tabs">
        <NavLink to="/reports" end className={({ isActive }) => (isActive ? 'active' : '')}>Overview</NavLink>
        <NavLink to="/reports/consumption" className={({ isActive }) => (isActive ? 'active' : '')}>Consumption</NavLink>
        <NavLink to="/reports/periods" className={({ isActive }) => (isActive ? 'active' : '')}>Periods & locks</NavLink>
        <NavLink to="/reports/missed" className={({ isActive }) => (isActive ? 'active' : '')}>Missed counts</NavLink>
      </nav>
      <Routes>
        <Route index element={<OverviewTab />} />
        <Route path="consumption" element={<ConsumptionTab />} />
        <Route path="periods" element={<PeriodsTab />} />
        <Route path="missed" element={<MissedTab />} />
      </Routes>
    </>
  );
}

function OverviewTab() {
  const q = useQuery({ queryKey: ['reports', 'overview'], queryFn: () => api.get<Overview>('/api/v1/reports/overview') });
  if (q.isLoading || !q.data) return <Skeleton rows={4} />;
  const o = q.data;
  return (
    <div className="stack">
      <Panel title={`Month to date · from ${fmtDate(o.month_start)}`}>
        <div className="table-wrap"><table>
          <thead><tr><th>Business unit</th><th className="num">Reagent consumed</th><th className="num">Counted days</th><th className="num">Items</th><th className="num">Low</th></tr></thead>
          <tbody>{o.business_units.map(b => (
            <tr key={b.bu_id}><td>{b.bu_name} <span className="mono small muted">{b.bu_code}</span></td><td className="num">{fmtQty(b.reagent_consumed)}</td><td className="num">{b.counted_days}</td><td className="num">{b.items}</td><td className="num">{b.low_items > 0 ? <span className="delta neg">{b.low_items}</span> : 0}</td></tr>
          ))}</tbody>
        </table></div>
        <p className="small faint" style={{ padding: '8px 12px' }}>Reagent consumed sums base units across reagents and is only meaningful per item; use the Consumption tab for like-for-like comparisons.</p>
      </Panel>
      <Panel title="Most consumed items · last 30 days" pad>
        <BarList rows={o.top_items_30d.map(t => ({ label: t.item_name, sub: t.item_code, value: t.consumed_qty, unit: t.base_uom }))} />
      </Panel>
    </div>
  );
}

function ConsumptionTab() {
  const bus = useBus();
  const items = useCatalogueItems();
  const [from, setFrom] = useState(addDays(todayIso(), -30));
  const [to, setTo] = useState(todayIso());
  const [groupBy, setGroupBy] = useState<'bu' | 'instrument' | 'item' | 'bu_item'>('bu');
  const [bu, setBu] = useState('');
  const [item, setItem] = useState('');
  const [kind, setKind] = useState('');
  const params = { group_by: groupBy, from, to, bu_id: bu || undefined, item_id: item || undefined, kind: kind || undefined };
  const q = useQuery({ queryKey: ['reports', 'consumption', params], queryFn: () => api.get<ConsumptionReport>('/api/v1/reports/consumption', params) });
  const unit = item ? items.data?.find(i => i.id === item)?.base_uom : undefined;
  const mixed = !item && groupBy !== 'item' && groupBy !== 'bu_item';
  const csv = api.url(`/api/v1/reports/consumption/export.csv?from=${from}&to=${to}${bu ? `&bu_id=${bu}` : ''}${item ? `&item_id=${item}` : ''}${kind ? `&kind=${kind}` : ''}`);

  async function download() {
    const res = await fetch(csv, { headers: { authorization: `Bearer ${JSON.parse(localStorage.getItem('sms.session') ?? '{}').access_token}` } });
    const blob = await res.blob(); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `consumption_${from}_${to}.csv`; a.click();
  }

  return (
    <div className="stack">
      <div className="filters">
        <Field><Input type="date" value={from} onChange={e => setFrom(e.target.value)} aria-label="From" /></Field>
        <Field><Input type="date" value={to} onChange={e => setTo(e.target.value)} aria-label="To" /></Field>
        <Field><Select value={bu} onChange={e => setBu(e.target.value)} aria-label="Business unit"><option value="">All units</option>{bus.data?.map(b => <option key={b.id} value={b.id}>{b.code}</option>)}</Select></Field>
        <Field><Select value={kind} onChange={e => setKind(e.target.value)} aria-label="Kind"><option value="">All kinds</option><option value="reagent">Reagents</option><option value="calibrator">Calibrators</option><option value="control">Controls</option><option value="consumable">Consumables</option><option value="material">Materials</option></Select></Field>
        <Field><Select value={item} onChange={e => setItem(e.target.value)} aria-label="Item" style={{ maxWidth: 260 }}><option value="">All items</option>{items.data?.map(i => <option key={i.id} value={i.id}>{i.name} · {i.code}</option>)}</Select></Field>
        <PillTabs value={groupBy} onChange={setGroupBy} options={[{ value: 'bu', label: 'By unit' }, { value: 'instrument', label: 'By instrument' }, { value: 'item', label: 'By item' }, { value: 'bu_item', label: 'Item × unit' }]} />
        <Button size="sm" icon="download" onClick={download}>CSV</Button>
      </div>
      {mixed && <p className="small muted"><Icon name="info" size={14} /> Totals across different items mix units. Pick one item for a comparable figure per unit or instrument.</p>}
      {q.isLoading || !q.data ? <Skeleton rows={4} /> : (
        <>
          <Panel title="Consumed per day" pad>
            <LineChart label="Consumed per day" points={q.data.series.map(s => ({ x: s.count_date.slice(0, 10), y: s.consumed_qty ?? 0 }))} />
          </Panel>
          <Panel title={`Consumed ${groupBy === 'bu' ? 'by business unit' : groupBy === 'instrument' ? 'by instrument' : groupBy === 'item' ? 'by item' : 'by item and unit'}`} pad>
            <BarList unit={unit} max={20} rows={q.data.groups.map(g => ({ label: g.key_name, sub: `${g.key_code} · ${g.days} days · received ${fmtQty(g.received_qty)} · wastage ${fmtQty(g.wastage_qty)}`, value: g.consumed_qty ?? 0, unit: g.base_uom ?? unit }))} />
          </Panel>
          <Panel title="Table">
            <div className="table-wrap"><table>
              <thead><tr><th>Group</th><th className="num">Consumed</th><th className="num">Received</th><th className="num">Wastage</th><th className="num">Days</th><th className="num">Items</th></tr></thead>
              <tbody>{q.data.groups.map(g => <tr key={g.key_id}><td>{g.key_name}<div className="small muted mono">{g.key_code}</div></td><td className="num"><b>{fmtQty(g.consumed_qty)}</b> <span className="small muted" style={{ fontFamily: 'var(--font)' }}>{g.base_uom ?? unit ?? ''}</span></td><td className="num">{fmtQty(g.received_qty)}</td><td className="num">{fmtQty(g.wastage_qty)}</td><td className="num">{g.days}</td><td className="num">{g.items}</td></tr>)}</tbody>
            </table></div>
          </Panel>
        </>
      )}
    </div>
  );
}

function PeriodsTab() {
  const bus = useBus();
  const toast = useToast();
  const [type, setType] = useState<'week' | 'month'>('month');
  const [start, setStart] = useState(() => periodStart('month', todayIso()));
  const [bu, setBu] = useState('');
  const [lock, setLock] = useState<{ buId: string; unlock: boolean } | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const params = { period_type: type, period_start: start, bu_id: bu || undefined };
  const q = useQuery({ queryKey: ['reports', 'snapshots', params], queryFn: () => api.get<{ period_type: string; period_start: string; period_end: string; locked_bus: string[]; items: Snapshot[] }>('/api/v1/reports/snapshots', params) });
  const locks = useQuery({ queryKey: ['periods'], queryFn: () => api.get<PeriodLock[]>('/api/v1/periods') });
  const ended = q.data ? q.data.period_end < todayIso() : false;
  const byBu = useMemo(() => {
    const m = new Map<string, Snapshot[]>();
    for (const r of q.data?.items ?? []) { if (!m.has(r.bu_id)) m.set(r.bu_id, []); m.get(r.bu_id)!.push(r); }
    return [...m.entries()];
  }, [q.data]);

  async function doLock() {
    if (!lock) return; setBusy(true);
    try {
      await api.post(`/api/v1/periods/${lock.unlock ? 'unlock' : 'lock'}`, { bu_id: lock.buId, period_type: type, period_start: start, reason: reason || undefined });
      toast(lock.unlock ? 'Period unlocked' : 'Period locked', 'ok'); setLock(null); setReason(''); q.refetch(); locks.refetch();
    } catch (e) { toast(errorMessage(e), 'error'); } finally { setBusy(false); }
  }

  return (
    <div className="stack">
      <div className="filters">
        <PillTabs value={type} onChange={t => { setType(t); setStart(periodStart(t, todayIso())); }} options={[{ value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }]} />
        <Button size="sm" icon="chevronLeft" aria-label="Previous" onClick={() => setStart(shiftPeriod(type, start, -1))} />
        <b>{q.data ? periodLabel(type, q.data.period_start, q.data.period_end) : '…'}</b>
        <Button size="sm" icon="chevronRight" aria-label="Next" onClick={() => setStart(shiftPeriod(type, start, 1))} disabled={start >= periodStart(type, todayIso())} />
        <Field><Select value={bu} onChange={e => setBu(e.target.value)} aria-label="Business unit"><option value="">All units</option>{bus.data?.map(b => <option key={b.id} value={b.id}>{b.code}</option>)}</Select></Field>
      </div>
      {q.isLoading || !q.data ? <Skeleton rows={5} /> : byBu.length === 0 ? <Panel><Empty title="No snapshot rows for this period" /></Panel> : byBu.map(([buId, rows]) => {
        const locked = q.data!.locked_bus.includes(buId);
        return (
          <Panel key={buId} title={<span className="row">{rows[0].bu_code}{locked && <Chip tone="brand" icon="lock">Locked</Chip>}</span>} actions={locked ? <Button size="sm" icon="unlock" onClick={() => setLock({ buId, unlock: true })}>Unlock</Button> : <Button size="sm" icon="lock" variant="primary" disabled={!ended} title={ended ? undefined : 'The period has not ended yet'} onClick={() => setLock({ buId, unlock: false })}>Lock period</Button>}>
            <div className="table-wrap"><table>
              <thead><tr><th>Item</th><th>Instrument</th><th className="num">Opening</th><th className="num">Received</th><th className="num">Wastage</th><th className="num">Closing</th><th className="num">Consumed</th><th className="num">Days</th></tr></thead>
              <tbody>{rows.map(r => (
                <tr key={r.id}><td>{r.item_name}<div className="small muted mono">{r.item_code} · {r.base_uom}</div></td><td className="small muted">{r.instrument_label ?? 'General'}</td><td className="num">{fmtQty(r.opening_qty)}</td><td className="num">{fmtQty(r.received_qty)}</td><td className="num">{fmtQty(r.wastage_qty)}</td><td className="num">{fmtQty(r.closing_qty)}</td><td className="num"><b>{fmtQty(r.consumed_qty)}</b></td><td className="num small">{r.count_days}{r.missing_days > 0 && <span className="delta neg"> −{r.missing_days}</span>}</td></tr>
              ))}</tbody>
            </table></div>
          </Panel>
        );
      })}
      {locks.data && locks.data.length > 0 && (
        <Panel title="Lock history">
          {locks.data.map(l => <div className="alert-row" key={l.id}><Icon name={l.unlocked_at ? 'unlock' : 'lock'} size={16} style={{ color: l.unlocked_at ? 'var(--ink-3)' : 'var(--brand)' }} /><span className="grow small">{l.bu_code} · {l.period_type} from {fmtDate(l.period_start)} · locked {fmtDateTime(l.locked_at)} by {l.locked_by}{l.unlocked_at && ` · unlocked ${fmtDateTime(l.unlocked_at)} by ${l.unlocked_by}`}{l.reason && <span className="muted"> · {l.reason}</span>}</span></div>)}
        </Panel>
      )}
      <Confirm open={!!lock} onClose={() => setLock(null)} onConfirm={doLock} loading={busy} title={lock?.unlock ? 'Unlock period' : 'Lock period'} confirmLabel={lock?.unlock ? 'Unlock' : 'Lock'} danger={lock?.unlock}
        body={lock?.unlock ? 'Counts and movements in this period become editable again. The reason is recorded.' : 'Snapshots freeze, and counts and movements in this period can no longer be changed.'}>
        <Field label={lock?.unlock ? 'Reason (required)' : 'Reason (optional)'}><Input value={reason} onChange={e => setReason(e.target.value)} autoFocus /></Field>
      </Confirm>
    </div>
  );
}

function MissedTab() {
  const [from, setFrom] = useState(addDays(todayIso(), -13));
  const [to, setTo] = useState(todayIso());
  const q = useQuery({ queryKey: ['reports', 'missed', from, to], queryFn: () => api.get<{ from: string; to: string; cells: MissedCell[] }>('/api/v1/reports/missed-counts', { from, to }) });
  const grid = useMemo(() => {
    const cells = q.data?.cells ?? [];
    const days = [...new Set(cells.map(c => c.count_date.slice(0, 10)))].sort();
    const bus = [...new Map(cells.map(c => [c.bu_id, c])).values()].sort((a, b) => a.bu_code.localeCompare(b.bu_code));
    const lookup = new Map(cells.map(c => [`${c.bu_id}|${c.count_date.slice(0, 10)}|${c.session}`, c]));
    return { days, bus, lookup };
  }, [q.data]);
  const today = todayIso();
  return (
    <div className="stack">
      <div className="filters">
        <Field><Input type="date" value={from} onChange={e => setFrom(e.target.value)} aria-label="From" /></Field>
        <Field><Input type="date" value={to} onChange={e => setTo(e.target.value)} aria-label="To" /></Field>
        <span className="small muted">Each cell is opening / closing. Green submitted, red missed, amber draft, grey not yet due.</span>
      </div>
      {q.isLoading ? <Skeleton rows={4} /> : grid.bus.length === 0 ? <Panel><Empty title="No business units" /></Panel> : (
        <Panel pad>
          <div style={{ overflowX: 'auto' }}>
            <div className="heat" style={{ gridTemplateColumns: `140px repeat(${grid.days.length}, minmax(52px, 1fr))`, minWidth: 140 + grid.days.length * 56 }}>
              <div />
              {grid.days.map(d => <div key={d} className="small muted" style={{ textAlign: 'center' }}>{fmtDate(d, { day: 'numeric', month: 'short' })}</div>)}
              {grid.bus.map(b => (
                <>
                  <div key={b.bu_id + 'l'} className="small" style={{ alignSelf: 'center' }}>{b.bu_code}</div>
                  {grid.days.map(d => {
                    const o = grid.lookup.get(`${b.bu_id}|${d}|opening`); const c = grid.lookup.get(`${b.bu_id}|${d}|closing`);
                    const cls = (x?: MissedCell) => x?.status === 'submitted' || x?.status === 'locked' ? 'submitted' : x?.status === 'draft' ? 'draft' : d < today ? 'missed' : 'pending';
                    const glyph = (x?: MissedCell) => x?.status === 'submitted' || x?.status === 'locked' ? '✓' : x?.status === 'draft' ? '…' : d < today ? '×' : '·';
                    return <div key={b.bu_id + d} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}><div className={`cell ${cls(o)}`} title={`${b.bu_code} ${d} opening${o?.submitted_by ? ` · ${o.submitted_by}` : ''}`}>{glyph(o)}</div><div className={`cell ${cls(c)}`} title={`${b.bu_code} ${d} closing${c?.submitted_by ? ` · ${c.submitted_by}` : ''}`}>{glyph(c)}</div></div>;
                  })}
                </>
              ))}
            </div>
          </div>
        </Panel>
      )}
    </div>
  );
}
