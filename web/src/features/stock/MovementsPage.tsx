import { useState } from 'react';
import { useMovements } from '@/api/hooks';
import { useBuId } from '@/auth/AuthProvider';
import { Empty, Field, Input, PageHead, Panel, Select, Skeleton, addDays, fmtDate, fmtQty, movementLabel, todayIso } from '@/ui';

export function MovementsPage() {
  const bu = useBuId();
  const [from, setFrom] = useState(addDays(todayIso(), -30));
  const [to, setTo] = useState(todayIso());
  const [type, setType] = useState('');
  const q = useMovements(bu, { from, to, type: type || undefined, limit: 500 });
  return (
    <>
      <PageHead title="Movement ledger" sub="Every receipt, wastage, transfer and adjustment. Counts are separate." />
      <div className="filters">
        <Field><Input type="date" value={from} onChange={e => setFrom(e.target.value)} aria-label="From" /></Field>
        <Field><Input type="date" value={to} onChange={e => setTo(e.target.value)} aria-label="To" /></Field>
        <Field><Select value={type} onChange={e => setType(e.target.value)} aria-label="Type"><option value="">All types</option>{Object.entries(movementLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
      </div>
      {q.isLoading ? <Skeleton rows={6} /> : !q.data?.length ? <Panel><Empty title="No movements in this range" /></Panel> : (
        <Panel><div className="table-wrap"><table>
          <thead><tr><th>Date</th><th>Type</th><th>Item</th><th>Lot</th><th className="num">Qty</th><th>Note</th><th>By</th></tr></thead>
          <tbody>{q.data.map(m => (
            <tr key={m.id}>
              <td className="small nowrap">{fmtDate(m.occurred_on)}</td>
              <td className="small">{movementLabel[m.movement_type]}{m.counterpart_bu_code && <span className="muted"> · {m.counterpart_bu_code}</span>}</td>
              <td><div>{m.item_name}</div><div className="small muted">{m.instrument_label ?? 'General'}</div></td>
              <td className="mono small">{m.lot_no ?? '—'}</td>
              <td className={`num delta ${m.qty_delta > 0 ? 'pos' : 'neg'}`}>{m.qty_delta > 0 ? '+' : ''}{fmtQty(m.qty_delta)} <span className="small muted" style={{ fontFamily: 'var(--font)', fontWeight: 400 }}>{m.base_uom}</span></td>
              <td className="small muted">{m.note ?? ''}</td>
              <td className="small muted">{m.created_by ?? m.api_client ?? ''}</td>
            </tr>
          ))}</tbody>
        </table></div></Panel>
      )}
    </>
  );
}
