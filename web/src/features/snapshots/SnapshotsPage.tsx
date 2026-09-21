import { useState } from 'react';
import { useSnapshots } from '@/api/hooks';
import { useBuId } from '@/auth/AuthProvider';
import { Button, Chip, Empty, PageHead, Panel, PillTabs, Skeleton, addDays, fmtDate, fmtQty, todayIso } from '@/ui';

export function periodStart(type: 'week' | 'month', anchor: string) {
  const d = new Date(anchor + 'T00:00:00');
  if (type === 'month') return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  const dow = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dow);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function shiftPeriod(type: 'week' | 'month', start: string, n: number) {
  if (type === 'week') return addDays(start, 7 * n);
  const d = new Date(start + 'T00:00:00'); d.setMonth(d.getMonth() + n); return periodStart('month', `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`);
}
export function periodLabel(type: 'week' | 'month', start: string, end: string) {
  return type === 'month' ? fmtDate(start, { month: 'long', year: 'numeric' }) : `${fmtDate(start)} – ${fmtDate(end, { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

export function SnapshotsPage() {
  const bu = useBuId();
  const [type, setType] = useState<'week' | 'month'>('week');
  const [start, setStart] = useState(() => periodStart('week', todayIso()));
  const q = useSnapshots(bu, { period_type: type, period_start: start });
  const s = q.data;
  return (
    <>
      <PageHead title="Periods" sub="Frozen opening and closing figures per item. Rebuilt nightly until the period is locked." actions={<PillTabs value={type} onChange={t => { setType(t); setStart(periodStart(t, todayIso())); }} options={[{ value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }]} />} />
      <div className="row between" style={{ marginBottom: 12 }}>
        <Button icon="chevronLeft" aria-label="Previous" onClick={() => setStart(shiftPeriod(type, start, -1))} />
        <div className="row"><b>{s ? periodLabel(type, s.period_start, s.period_end) : '…'}</b>{s?.is_locked && <Chip tone="brand" icon="lock">Locked</Chip>}</div>
        <Button icon="chevronRight" aria-label="Next" onClick={() => setStart(shiftPeriod(type, start, 1))} disabled={start >= periodStart(type, todayIso())} />
      </div>
      {q.isLoading ? <Skeleton rows={6} /> : !s?.items.length ? <Panel><Empty title="No figures for this period" /></Panel> : (
        <Panel><div className="table-wrap"><table>
          <thead><tr><th>Item</th><th>Instrument</th><th className="num">Opening</th><th className="num">Received</th><th className="num">Wastage</th><th className="num">Transfers</th><th className="num">Adjust.</th><th className="num">Closing</th><th className="num">Days</th></tr></thead>
          <tbody>{s.items.map(r => (
            <tr key={r.id}>
              <td><div>{r.item_name}</div><div className="small muted mono">{r.item_code} · {r.base_uom}</div></td>
              <td className="small muted">{r.instrument_label ?? 'General'}</td>
              <td className="num">{fmtQty(r.opening_qty)}</td>
              <td className="num">{r.received_qty ? fmtQty(r.received_qty) : <span className="faint">0</span>}</td>
              <td className="num">{r.wastage_qty ? <span className="delta neg">{fmtQty(r.wastage_qty)}</span> : <span className="faint">0</span>}</td>
              <td className="num">{r.transfer_qty ? fmtQty(r.transfer_qty) : <span className="faint">0</span>}</td>
              <td className="num">{r.adjustment_qty ? fmtQty(r.adjustment_qty) : <span className="faint">0</span>}</td>
              <td className="num"><b>{fmtQty(r.closing_qty)}</b></td>
              <td className="num small">{r.count_days}{r.missing_days > 0 && <span className="delta neg"> −{r.missing_days}</span>}</td>
            </tr>
          ))}</tbody>
        </table></div></Panel>
      )}
      <p className="small faint" style={{ marginTop: 10 }}>Days = days with both counts submitted; a red figure is the number of missing days so far in the period.</p>
    </>
  );
}
