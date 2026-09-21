import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '@/api/client';
import { useBus } from '@/api/hooks';
import type { BusinessUnit } from '@/api/types';
import { Button, Chip, Field, Input, PageHead, Panel, Select, Sheet, Skeleton, fmtTime, useToast } from '@/ui';

export function BusPage() {
  const q = useBus(true);
  const [edit, setEdit] = useState<BusinessUnit | 'new' | null>(null);
  return (
    <>
      <PageHead title="Business units" sub="Each unit has its own instruments, count times and tolerance." actions={<Button variant="primary" icon="plus" onClick={() => setEdit('new')}>New unit</Button>} />
      {q.isLoading ? <Skeleton rows={3} /> : (
        <Panel><div className="table-wrap"><table>
          <thead><tr><th>Code</th><th>Name</th><th>Type</th><th>Counts due</th><th className="num">Tolerance</th><th className="num">Instruments</th><th className="num">Items</th><th className="num">Members</th><th></th></tr></thead>
          <tbody>{q.data?.map(b => (
            <tr key={b.id} style={{ opacity: b.is_active ? 1 : 0.55 }}>
              <td className="mono">{b.code}</td><td>{b.name}<div className="small muted">{b.address}</div></td><td className="small muted">{b.bu_type.replace('_', ' ')}</td>
              <td className="small">{fmtTime(b.opening_due_time)} / {fmtTime(b.closing_due_time)} <span className="muted">+{b.grace_minutes} min</span></td>
              <td className="num">{b.variance_tolerance_pct}%</td><td className="num">{b.instrument_count}</td><td className="num">{b.item_count}</td><td className="num">{b.member_count}</td>
              <td>{!b.is_active && <Chip icon={null}>inactive</Chip>} <Button size="sm" variant="ghost" icon="edit" aria-label="Edit" onClick={() => setEdit(b)} /></td>
            </tr>
          ))}</tbody>
        </table></div></Panel>
      )}
      {edit && <BuSheet bu={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function BuSheet({ bu, onClose }: { bu: BusinessUnit | null; onClose: () => void }) {
  const toast = useToast(); const qc = useQueryClient();
  const [f, setF] = useState({ code: bu?.code ?? '', name: bu?.name ?? '', bu_type: bu?.bu_type ?? 'lab', address: bu?.address ?? '', timezone: bu?.timezone ?? 'Asia/Kolkata', opening_due_time: bu?.opening_due_time.slice(0, 5) ?? '09:00', closing_due_time: bu?.closing_due_time.slice(0, 5) ?? '21:00', grace_minutes: bu?.grace_minutes.toString() ?? '30', variance_tolerance_pct: bu?.variance_tolerance_pct.toString() ?? '5', is_active: bu?.is_active ?? true });
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true);
    const body = { ...f, grace_minutes: +f.grace_minutes, variance_tolerance_pct: +f.variance_tolerance_pct, address: f.address || null };
    try {
      if (bu) await api.patch(`/api/v1/bus/${bu.id}`, body); else await api.post('/api/v1/bus', body);
      qc.invalidateQueries({ queryKey: ['bus'] }); toast('Saved', 'ok'); onClose();
    } catch (err) { toast(errorMessage(err), 'error'); } finally { setBusy(false); }
  }
  return (
    <Sheet open onClose={onClose} title={bu ? bu.name : 'New business unit'}>
      <form onSubmit={submit}>
        <div className="grid-2">
          <Field label="Code" hint="Short, stable, upper case"><Input className="mono" value={f.code} onChange={e => setF({ ...f, code: e.target.value.toUpperCase() })} required disabled={!!bu} /></Field>
          <Field label="Name"><Input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} required /></Field>
          <Field label="Type"><Select value={f.bu_type} onChange={e => setF({ ...f, bu_type: e.target.value })}><option value="lab">Lab</option><option value="collection_centre">Collection centre</option><option value="warehouse">Warehouse</option><option value="other">Other</option></Select></Field>
          <Field label="Timezone"><Input value={f.timezone} onChange={e => setF({ ...f, timezone: e.target.value })} /></Field>
          <Field label="Opening count due"><Input type="time" value={f.opening_due_time} onChange={e => setF({ ...f, opening_due_time: e.target.value })} /></Field>
          <Field label="Closing count due"><Input type="time" value={f.closing_due_time} onChange={e => setF({ ...f, closing_due_time: e.target.value })} /></Field>
          <Field label="Grace minutes" hint="Before a count shows as missed"><Input type="number" value={f.grace_minutes} onChange={e => setF({ ...f, grace_minutes: e.target.value })} /></Field>
          <Field label="Variance tolerance %" hint="Above this a note is required"><Input type="number" step="any" value={f.variance_tolerance_pct} onChange={e => setF({ ...f, variance_tolerance_pct: e.target.value })} /></Field>
        </div>
        <Field label="Address"><Input value={f.address} onChange={e => setF({ ...f, address: e.target.value })} /></Field>
        {bu && <label className="check" style={{ marginBottom: 12 }}><input type="checkbox" checked={f.is_active} onChange={e => setF({ ...f, is_active: e.target.checked })} />Active</label>}
        <div className="form-actions"><Button type="button" onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" loading={busy}>{bu ? 'Save' : 'Create'}</Button></div>
      </form>
    </Sheet>
  );
}
