import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { useBus } from '@/api/hooks';
import type { AuditRow } from '@/api/types';
import { Empty, Field, Input, PageHead, Panel, Select, Sheet, Skeleton, fmtDateTime, useDebounced } from '@/ui';

export function AuditPage() {
  const bus = useBus(true);
  const [action, setAction] = useState(''); const da = useDebounced(action);
  const [bu, setBu] = useState('');
  const [entity, setEntity] = useState('');
  const [open, setOpen] = useState<AuditRow | null>(null);
  const q = useQuery({ queryKey: ['audit', da, bu, entity], queryFn: () => api.get<AuditRow[]>('/api/v1/admin/audit', { action: da || undefined, bu_id: bu || undefined, entity_type: entity || undefined, limit: 200 }) });
  const pretty = (s?: string | null) => { if (!s) return '—'; try { return JSON.stringify(JSON.parse(s), null, 2); } catch { return s; } };
  return (
    <>
      <PageHead title="Audit log" sub="Every write, with who, what and the before/after state." />
      <div className="filters">
        <Field><Input placeholder="Action, e.g. count.reopen" value={action} onChange={e => setAction(e.target.value)} aria-label="Action" style={{ minWidth: 220 }} /></Field>
        <Field><Select value={bu} onChange={e => setBu(e.target.value)} aria-label="Business unit"><option value="">All units</option>{bus.data?.map(b => <option key={b.id} value={b.id}>{b.code}</option>)}</Select></Field>
        <Field><Select value={entity} onChange={e => setEntity(e.target.value)} aria-label="Entity"><option value="">All entities</option>{['stock_count', 'stock_movement', 'stock_lot', 'bu_item', 'instrument', 'item', 'business_unit', 'app_user', 'api_client', 'period_lock'].map(e => <option key={e}>{e}</option>)}</Select></Field>
      </div>
      {q.isLoading ? <Skeleton rows={6} /> : !q.data?.length ? <Panel><Empty title="No entries match" /></Panel> : (
        <Panel><div className="table-wrap"><table>
          <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Entity</th><th>Unit</th></tr></thead>
          <tbody>{q.data.map(r => (
            <tr key={r.id} onClick={() => setOpen(r)} style={{ cursor: 'pointer' }}>
              <td className="small nowrap">{fmtDateTime(r.at)}</td><td className="small">{r.actor_name ?? r.client_name ?? 'system'}</td><td className="mono small">{r.action}</td>
              <td className="small muted">{r.entity_type} <span className="mono">{r.entity_id.slice(0, 8)}</span></td><td className="small muted">{r.bu_code ?? ''}</td>
            </tr>
          ))}</tbody>
        </table></div></Panel>
      )}
      <Sheet open={!!open} onClose={() => setOpen(null)} title={open?.action ?? ''} wide>
        {open && (
          <div className="stack">
            <dl className="kv small"><dt>When</dt><dd>{fmtDateTime(open.at)}</dd><dt>Who</dt><dd>{open.actor_name ?? open.client_name ?? 'system'}{open.ip && <span className="muted"> · {open.ip}</span>}</dd><dt>Entity</dt><dd>{open.entity_type} <span className="mono">{open.entity_id}</span></dd></dl>
            <div className="grid-2">
              <div><h3 className="small muted" style={{ marginBottom: 6 }}>Before</h3><pre className="code-box small" style={{ whiteSpace: 'pre-wrap', margin: 0, maxHeight: 320, overflow: 'auto', userSelect: 'text' }}>{pretty(open.before)}</pre></div>
              <div><h3 className="small muted" style={{ marginBottom: 6 }}>After</h3><pre className="code-box small" style={{ whiteSpace: 'pre-wrap', margin: 0, maxHeight: 320, overflow: 'auto', userSelect: 'text' }}>{pretty(open.after)}</pre></div>
            </div>
          </div>
        )}
      </Sheet>
    </>
  );
}
