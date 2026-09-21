import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, errorMessage } from '@/api/client';
import { useBuItems, useInstruments, useInvalidateBu, useLots } from '@/api/hooks';
import type { Instrument } from '@/api/types';
import { useAuth, useBuId } from '@/auth/AuthProvider';
import { Button, Field, Input, PageHead, Panel, PillTabs, Select, Textarea, fmtQty, plural, todayIso, useToast } from '@/ui';
import { ItemSelect } from './ReceivePage';

type Kind = 'wastage' | 'adjustment' | 'transfer' | 'return_to_supplier' | 'expiry_writeoff';

export function MovePage() {
  const bu = useBuId();
  const { bus, can } = useAuth();
  const items = useBuItems(bu);
  const toast = useToast();
  const nav = useNavigate();
  const invalidate = useInvalidateBu(bu);
  const [kind, setKind] = useState<Kind>('wastage');
  const [itemId, setItemId] = useState('');
  const [lotId, setLotId] = useState('');
  const [packs, setPacks] = useState(''); const [loose, setLoose] = useState('');
  const [sign, setSign] = useState<'+' | '-'>('-');
  const [on, setOn] = useState(todayIso());
  const [note, setNote] = useState('');
  const [toBu, setToBu] = useState('');
  const [toIns, setToIns] = useState('');
  const [toInstruments, setToInstruments] = useState<Instrument[]>([]);
  const [busy, setBusy] = useState(false);
  const item = items.data?.find(i => i.id === itemId);
  const lots = useLots(bu, { bu_item_id: itemId || undefined, status: 'active' });
  const qty = item ? (parseFloat(packs) || 0) * item.pack_size + (parseFloat(loose) || 0) : 0;

  useEffect(() => { setLotId(''); }, [itemId]);
  useEffect(() => {
    if (!toBu) { setToInstruments([]); return; }
    api.get<Instrument[]>(`/api/v1/bus/${toBu}/instruments`).then(setToInstruments).catch(() => setToInstruments([]));
  }, [toBu]);

  const options: { value: Kind; label: string }[] = [
    { value: 'wastage', label: 'Wastage' },
    ...(can('stock.adjust') ? [{ value: 'adjustment' as Kind, label: 'Adjustment' }, { value: 'expiry_writeoff' as Kind, label: 'Expiry' }, { value: 'return_to_supplier' as Kind, label: 'Return' }] : []),
    ...(can('stock.transfer') ? [{ value: 'transfer' as Kind, label: 'Transfer' }] : []),
  ];

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!item || qty <= 0) return;
    setBusy(true);
    try {
      if (kind === 'transfer') {
        await api.post(`/api/v1/bus/${bu}/transfers`, { from_bu_item_id: item.id, to_bu_id: toBu, to_instrument_id: toIns || undefined, lot_id: lotId || undefined, qty, occurred_on: on, note: note || undefined });
        toast(`Transferred ${fmtQty(qty)} ${item.base_uom} to ${bus.find(b => b.id === toBu)?.code}`, 'ok');
      } else {
        await api.post(`/api/v1/bus/${bu}/movements`, { bu_item_id: item.id, lot_id: lotId || undefined, movement_type: kind, qty: kind === 'adjustment' && sign === '-' ? -qty : qty, occurred_on: on, note: note || undefined });
        toast(`${options.find(o => o.value === kind)?.label} recorded`, 'ok');
      }
      invalidate(); setPacks(''); setLoose(''); setNote('');
    } catch (err) { toast(errorMessage(err), 'error'); } finally { setBusy(false); }
  }

  const help: Record<Kind, string> = {
    wastage: 'Spilled, broken, contaminated or otherwise unusable stock. Reduces the quantity on hand.',
    adjustment: 'Correct a known discrepancy up or down. A note explaining the reason is required.',
    transfer: 'Move stock to another business unit. The receiving unit gets a matching lot.',
    return_to_supplier: 'Stock sent back to the supplier. Reduces the quantity on hand.',
    expiry_writeoff: 'Expired stock removed from the shelf.',
  };

  return (
    <>
      <PageHead title="Stock movement" sub={help[kind]} />
      <Panel pad>
        <div style={{ marginBottom: 14 }}><PillTabs value={kind} onChange={setKind} options={options} /></div>
        <form onSubmit={submit}>
          <ItemSelect items={items.data ?? []} value={itemId} onChange={setItemId} />
          {item && (
            <>
              {item.tracks_lot && (
                <Field label="Lot" hint={lots.data?.length === 0 ? 'No active lots for this item' : undefined}>
                  <Select value={lotId} onChange={e => setLotId(e.target.value)} required>
                    <option value="">Choose a lot…</option>
                    {lots.data?.map(l => <option key={l.id} value={l.id}>{l.lot_no} · {fmtQty(l.qty_on_hand)} {item.base_uom} on hand{l.expiry_date ? ` · exp ${l.expiry_date}` : ''}</option>)}
                  </Select>
                </Field>
              )}
              {kind === 'transfer' && (
                <div className="grid-2">
                  <Field label="To business unit"><Select value={toBu} onChange={e => { setToBu(e.target.value); setToIns(''); }} required><option value="">Choose…</option>{bus.filter(b => b.id !== bu).map(b => <option key={b.id} value={b.id}>{b.name} · {b.code}</option>)}</Select></Field>
                  <Field label="To instrument (optional)"><Select value={toIns} onChange={e => setToIns(e.target.value)}><option value="">General / same as item</option>{toInstruments.map(i => <option key={i.id} value={i.id}>{i.label ?? `${i.model_name} · ${i.serial_no}`}</option>)}</Select></Field>
                </div>
              )}
              {kind === 'adjustment' && (
                <Field label="Direction"><PillTabs value={sign} onChange={setSign} options={[{ value: '-', label: 'Reduce stock' }, { value: '+', label: 'Increase stock' }]} /></Field>
              )}
              <div className="grid-2">
                <Field label={plural(item.pack_uom, 2)} hint={`1 ${item.pack_uom} = ${fmtQty(item.pack_size)} ${item.base_uom}`}><Input type="number" inputMode="decimal" min={0} step="any" value={packs} onChange={e => setPacks(e.target.value)} /></Field>
                <Field label={`Loose ${item.base_uom}`}><Input type="number" inputMode="decimal" min={0} step="any" value={loose} onChange={e => setLoose(e.target.value)} /></Field>
                <Field label="Date"><Input type="date" value={on} onChange={e => setOn(e.target.value)} max={todayIso()} required /></Field>
              </div>
              <Field label={kind === 'adjustment' ? 'Reason (required)' : 'Note'}><Textarea value={note} onChange={e => setNote(e.target.value)} required={kind === 'adjustment'} /></Field>
              <div className="row between wrap">
                <span>Quantity <b className="mono">{kind === 'adjustment' ? sign : '−'}{fmtQty(qty)}</b> {item.base_uom}</span>
                <div className="row"><Button type="button" onClick={() => nav(-1)}>Cancel</Button><Button type="submit" variant={kind === 'transfer' ? 'primary' : 'danger'} loading={busy} disabled={qty <= 0}>{kind === 'transfer' ? 'Transfer' : 'Record'}</Button></div>
              </div>
            </>
          )}
        </form>
      </Panel>
    </>
  );
}
