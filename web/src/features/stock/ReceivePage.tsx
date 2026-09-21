import { useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, errorMessage } from '@/api/client';
import { useBuItems, useInvalidateBu, useSuppliers } from '@/api/hooks';
import { useBuId } from '@/auth/AuthProvider';
import { Button, Field, Input, PageHead, Panel, Select, fmtQty, plural, todayIso, useToast } from '@/ui';

export function ItemSelect({ items, value, onChange, label = 'Item' }: { items: { id: string; item_name: string; item_code: string; instrument_label?: string | null }[]; value: string; onChange: (v: string) => void; label?: string }) {
  const groups = useMemo(() => {
    const m = new Map<string, typeof items>();
    for (const i of items) { const k = i.instrument_label ?? 'General items'; if (!m.has(k)) m.set(k, []); m.get(k)!.push(i); }
    return [...m.entries()];
  }, [items]);
  return (
    <Field label={label}>
      <Select value={value} onChange={e => onChange(e.target.value)} required>
        <option value="">Choose an item…</option>
        {groups.map(([g, list]) => <optgroup key={g} label={g}>{list.map(i => <option key={i.id} value={i.id}>{i.item_name} · {i.item_code}</option>)}</optgroup>)}
      </Select>
    </Field>
  );
}

export function ReceivePage() {
  const bu = useBuId();
  const items = useBuItems(bu);
  const suppliers = useSuppliers();
  const toast = useToast();
  const nav = useNavigate();
  const invalidate = useInvalidateBu(bu);
  const [itemId, setItemId] = useState('');
  const [lotNo, setLotNo] = useState('');
  const [expiry, setExpiry] = useState('');
  const [supplier, setSupplier] = useState('');
  const [packs, setPacks] = useState('');
  const [loose, setLoose] = useState('');
  const [on, setOn] = useState(todayIso());
  const [cost, setCost] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const item = items.data?.find(i => i.id === itemId);
  const total = item ? (parseFloat(packs) || 0) * item.pack_size + (parseFloat(loose) || 0) : 0;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!item) return;
    setBusy(true);
    try {
      await api.post(`/api/v1/bus/${bu}/lots`, { bu_item_id: item.id, lot_no: lotNo || undefined, expiry_date: expiry || undefined, supplier_id: supplier || undefined, packs: parseFloat(packs) || 0, loose: parseFloat(loose) || 0, received_on: on, unit_cost: cost ? +cost : undefined, note: note || undefined });
      invalidate();
      toast(`Received ${fmtQty(total)} ${item.base_uom} of ${item.item_name}`, 'ok');
      setLotNo(''); setExpiry(''); setPacks(''); setLoose(''); setCost(''); setNote('');
    } catch (err) { toast(errorMessage(err), 'error'); } finally { setBusy(false); }
  }

  return (
    <>
      <PageHead title="Receive stock" sub="Book a delivery in. Lot-tracked items get a lot; the quantity is added to the ledger." />
      <Panel pad>
        <form onSubmit={submit}>
          <ItemSelect items={items.data ?? []} value={itemId} onChange={setItemId} />
          {item && (
            <>
              {item.tracks_lot && <div className="grid-2">
                <Field label="Lot number"><Input className="mono" value={lotNo} onChange={e => setLotNo(e.target.value)} required placeholder="As printed on the pack" /></Field>
                <Field label="Expiry date"><Input type="date" value={expiry} onChange={e => setExpiry(e.target.value)} required={item.tracks_expiry} /></Field>
              </div>}
              <div className="grid-2">
                <Field label={`${plural(item.pack_uom, 2)} received`} hint={`1 ${item.pack_uom} = ${fmtQty(item.pack_size)} ${item.base_uom}`}><Input type="number" inputMode="decimal" min={0} step="any" value={packs} onChange={e => setPacks(e.target.value)} /></Field>
                <Field label={`Loose ${item.base_uom}`}><Input type="number" inputMode="decimal" min={0} step="any" value={loose} onChange={e => setLoose(e.target.value)} /></Field>
                <Field label="Received on"><Input type="date" value={on} onChange={e => setOn(e.target.value)} max={todayIso()} required /></Field>
                <Field label="Supplier"><Select value={supplier} onChange={e => setSupplier(e.target.value)}><option value="">—</option>{suppliers.data?.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
                <Field label={`Unit cost (per ${item.base_uom}, optional)`}><Input type="number" inputMode="decimal" min={0} step="any" value={cost} onChange={e => setCost(e.target.value)} /></Field>
                <Field label="Note"><Input value={note} onChange={e => setNote(e.target.value)} placeholder="Invoice or GRN reference" /></Field>
              </div>
              <div className="row between wrap" style={{ marginTop: 6 }}>
                <span>Total <b className="mono">{fmtQty(total)}</b> {item.base_uom}</span>
                <div className="row"><Button type="button" onClick={() => nav(-1)}>Cancel</Button><Button type="submit" variant="primary" loading={busy} disabled={total <= 0}>Book receipt</Button></div>
              </div>
            </>
          )}
        </form>
      </Panel>
    </>
  );
}
