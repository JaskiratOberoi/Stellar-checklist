import { useState } from 'react';
import { api, errorMessage } from '@/api/client';
import { useBuItems, useInstruments, useInvalidateBu } from '@/api/hooks';
import type { BuItem, Item } from '@/api/types';
import { useBuId } from '@/auth/AuthProvider';
import { Button, Chip, Empty, Field, Input, PageHead, Panel, Select, Sheet, Skeleton, fmtQty, kindLabel, useToast } from '@/ui';
import { ProposeItems } from '../instruments/InstrumentsPage';

export function BuItemsPage() {
  const bu = useBuId();
  const [inactive, setInactive] = useState(false);
  const q = useBuItems(bu, { include_inactive: inactive });
  const instruments = useInstruments(bu);
  const toast = useToast();
  const invalidate = useInvalidateBu(bu);
  const [pick, setPick] = useState(false);
  const [target, setTarget] = useState('');
  const [suggest, setSuggest] = useState<{ ins: string; items: Item[] } | null>(null);
  const [edit, setEdit] = useState<BuItem | null>(null);

  async function loadSuggestions() {
    try {
      const items = await api.get<Item[]>(`/api/v1/bus/${bu}/items/suggestions`, { instrument_id: target || undefined });
      if (items.length === 0) { toast('Nothing left to add for that choice', 'ok'); return; }
      setPick(false); setSuggest({ ins: target, items });
    } catch (e) { toast(errorMessage(e), 'error'); }
  }
  async function toggle(i: BuItem) {
    try { await api.patch(`/api/v1/bus/${bu}/items/${i.id}`, { is_active: !i.is_active }); invalidate(); }
    catch (e) { toast(errorMessage(e), 'error'); }
  }

  return (
    <>
      <PageHead title="Tracked items" sub="What appears on this unit's count sheet, with its minimum levels." actions={<><label className="check"><input type="checkbox" checked={inactive} onChange={e => setInactive(e.target.checked)} />Show inactive</label><Button variant="primary" icon="plus" onClick={() => setPick(true)}>Add items</Button></>} />
      {q.isLoading ? <Skeleton rows={6} /> : !q.data?.length ? <Panel><Empty title="Nothing tracked yet" icon="list">Add an instrument or pick general items to start counting.</Empty></Panel> : (
        <Panel><div className="table-wrap"><table>
          <thead><tr><th>Item</th><th>Instrument</th><th>Kind</th><th className="num">Min</th><th className="num">Max</th><th className="num">Reorder</th><th>Active</th><th></th></tr></thead>
          <tbody>{q.data.map(i => (
            <tr key={i.id} style={{ opacity: i.is_active ? 1 : 0.55 }}>
              <td><div>{i.item_name}</div><div className="small muted mono">{i.item_code}</div></td>
              <td className="small muted">{i.instrument_label ?? 'General'}</td>
              <td><Chip icon={null}>{kindLabel[i.kind]}</Chip></td>
              <td className="num">{fmtQty(i.min_level)}</td><td className="num muted">{fmtQty(i.max_level)}</td><td className="num muted">{fmtQty(i.reorder_qty)}</td>
              <td><label className="check"><input type="checkbox" checked={i.is_active} onChange={() => toggle(i)} /></label></td>
              <td><Button size="sm" variant="ghost" icon="edit" aria-label="Edit thresholds" onClick={() => setEdit(i)} /></td>
            </tr>
          ))}</tbody>
        </table></div></Panel>
      )}
      <Sheet open={pick} onClose={() => setPick(false)} title="Add tracked items">
        <Field label="For" hint="Instrument reagents come from the model's catalogue list; general items are everything else."><Select value={target} onChange={e => setTarget(e.target.value)}><option value="">General items (no instrument)</option>{instruments.data?.filter(i => i.status !== 'retired').map(i => <option key={i.id} value={i.id}>{i.label ?? `${i.model_name} · ${i.serial_no}`}</option>)}</Select></Field>
        <div className="form-actions"><Button onClick={() => setPick(false)}>Cancel</Button><Button variant="primary" onClick={loadSuggestions}>Show items</Button></div>
      </Sheet>
      {suggest && <ProposeItems bu={bu} instrument={instruments.data?.find(i => i.id === suggest.ins) ?? null} items={suggest.items} onClose={() => setSuggest(null)} />}
      {edit && <EditThresholds bu={bu} item={edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function EditThresholds({ bu, item, onClose }: { bu: string; item: BuItem; onClose: () => void }) {
  const toast = useToast();
  const invalidate = useInvalidateBu(bu);
  const [min, setMin] = useState(item.min_level?.toString() ?? ''); const [max, setMax] = useState(item.max_level?.toString() ?? ''); const [reorder, setReorder] = useState(item.reorder_qty?.toString() ?? ''); const [sort, setSort] = useState(item.sort_order.toString());
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try { await api.patch(`/api/v1/bus/${bu}/items/${item.id}`, { min_level: min === '' ? null : +min, max_level: max === '' ? null : +max, reorder_qty: reorder === '' ? null : +reorder, sort_order: +sort || 0 }); invalidate(); toast('Saved', 'ok'); onClose(); }
    catch (e) { toast(errorMessage(e), 'error'); } finally { setBusy(false); }
  }
  return (
    <Sheet open onClose={onClose} title={item.item_name}>
      <p className="small muted" style={{ marginBottom: 10 }}>{item.instrument_label ?? 'General'} · quantities in {item.base_uom}</p>
      <div className="grid-2">
        <Field label="Minimum level"><Input type="number" inputMode="decimal" value={min} onChange={e => setMin(e.target.value)} /></Field>
        <Field label="Maximum level"><Input type="number" inputMode="decimal" value={max} onChange={e => setMax(e.target.value)} /></Field>
        <Field label="Reorder quantity"><Input type="number" inputMode="decimal" value={reorder} onChange={e => setReorder(e.target.value)} /></Field>
        <Field label="Sort order" hint="Lower numbers count first within the instrument"><Input type="number" value={sort} onChange={e => setSort(e.target.value)} /></Field>
      </div>
      <div className="form-actions"><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} loading={busy}>Save</Button></div>
    </Sheet>
  );
}
