import { useState, type FormEvent } from 'react';
import { api, errorMessage } from '@/api/client';
import { useInstruments, useInvalidateBu, useModels } from '@/api/hooks';
import type { Instrument, Item } from '@/api/types';
import { useBuId } from '@/auth/AuthProvider';
import { Button, Chip, Empty, Field, Icon, Input, PageHead, Panel, Select, Sheet, Skeleton, fmtDate, fmtQty, kindLabel, useToast } from '@/ui';

export function InstrumentsPage() {
  const bu = useBuId();
  const q = useInstruments(bu);
  const [add, setAdd] = useState(false);
  const [edit, setEdit] = useState<Instrument | null>(null);
  const [proposed, setProposed] = useState<{ instrument: Instrument; items: Item[] } | null>(null);
  return (
    <>
      <PageHead title="Instruments" sub="Each instrument owns the reagent list it consumes." actions={<Button variant="primary" icon="plus" onClick={() => setAdd(true)}>Add instrument</Button>} />
      {q.isLoading ? <Skeleton rows={3} /> : !q.data?.length ? <Panel><Empty title="No instruments yet" icon="instrument">Add the analysers in this unit; their reagents follow automatically.</Empty></Panel> : (
        <Panel>{q.data.map(i => (
          <div className="alert-row" key={i.id}>
            <Icon name="instrument" size={22} style={{ color: i.status === 'active' ? 'var(--brand)' : 'var(--ink-3)' }} />
            <span className="grow"><div>{i.label ?? `${i.manufacturer} ${i.model_name}`}</div><div className="small muted">{i.manufacturer} {i.model_name} · <span className="mono">{i.serial_no}</span>{i.installed_on && ` · installed ${fmtDate(i.installed_on, { month: 'short', year: 'numeric' })}`} · {i.tracked_item_count} tracked items</div></span>
            <Chip tone={i.status === 'active' ? 'ok' : i.status === 'down' ? 'warn' : 'neutral'} icon={null}>{i.status}</Chip>
            <Button size="sm" variant="ghost" icon="edit" aria-label="Edit" onClick={() => setEdit(i)} />
          </div>
        ))}</Panel>
      )}
      <AddInstrument open={add} onClose={() => setAdd(false)} bu={bu} onCreated={(ins, items) => { setAdd(false); if (items.length) setProposed({ instrument: ins, items }); }} />
      {edit && <EditInstrument ins={edit} onClose={() => setEdit(null)} />}
      {proposed && <ProposeItems bu={bu} instrument={proposed.instrument} items={proposed.items} onClose={() => setProposed(null)} />}
    </>
  );
}

function AddInstrument({ open, onClose, bu, onCreated }: { open: boolean; onClose: () => void; bu: string; onCreated: (i: Instrument, items: Item[]) => void }) {
  const models = useModels();
  const toast = useToast();
  const invalidate = useInvalidateBu(bu);
  const [model, setModel] = useState(''); const [serial, setSerial] = useState(''); const [label, setLabel] = useState(''); const [installed, setInstalled] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true);
    try {
      const r = await api.post<{ instrument: Instrument; proposed_items: Item[] }>(`/api/v1/bus/${bu}/instruments`, { instrument_model_id: model, serial_no: serial, label: label || undefined, installed_on: installed || undefined });
      invalidate(); toast('Instrument added', 'ok'); setSerial(''); setLabel(''); onCreated(r.instrument, r.proposed_items);
    } catch (err) { toast(errorMessage(err), 'error'); } finally { setBusy(false); }
  }
  return (
    <Sheet open={open} onClose={onClose} title="Add instrument">
      <form onSubmit={submit}>
        <Field label="Model"><Select value={model} onChange={e => setModel(e.target.value)} required><option value="">Choose…</option>{models.data?.map(m => <option key={m.id} value={m.id}>{m.manufacturer} {m.model_name} · {m.item_count} reagents</option>)}</Select></Field>
        <div className="grid-2">
          <Field label="Serial number"><Input className="mono" value={serial} onChange={e => setSerial(e.target.value)} required /></Field>
          <Field label="Label (optional)" hint="e.g. XN-550 · Bench A"><Input value={label} onChange={e => setLabel(e.target.value)} /></Field>
          <Field label="Installed on"><Input type="date" value={installed} onChange={e => setInstalled(e.target.value)} /></Field>
        </div>
        <div className="form-actions"><Button type="button" onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" loading={busy}>Add</Button></div>
      </form>
    </Sheet>
  );
}

function EditInstrument({ ins, onClose }: { ins: Instrument; onClose: () => void }) {
  const toast = useToast();
  const invalidate = useInvalidateBu(ins.bu_id);
  const [label, setLabel] = useState(ins.label ?? ''); const [status, setStatus] = useState(ins.status); const [notes, setNotes] = useState(ins.notes ?? '');
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true);
    try { await api.patch(`/api/v1/instruments/${ins.id}`, { label: label || undefined, status, notes: notes || undefined }); invalidate(); toast('Saved', 'ok'); onClose(); }
    catch (err) { toast(errorMessage(err), 'error'); } finally { setBusy(false); }
  }
  return (
    <Sheet open onClose={onClose} title={`${ins.manufacturer} ${ins.model_name} · ${ins.serial_no}`}>
      <form onSubmit={submit}>
        <Field label="Label"><Input value={label} onChange={e => setLabel(e.target.value)} /></Field>
        <Field label="Status" hint="Retired instruments keep their history but drop off the count sheet once their items are deactivated."><Select value={status} onChange={e => setStatus(e.target.value as Instrument['status'])}><option value="active">Active</option><option value="down">Down</option><option value="retired">Retired</option></Select></Field>
        <Field label="Notes"><Input value={notes} onChange={e => setNotes(e.target.value)} /></Field>
        <div className="form-actions"><Button type="button" onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" loading={busy}>Save</Button></div>
      </form>
    </Sheet>
  );
}

export function ProposeItems({ bu, instrument, items, onClose }: { bu: string; instrument: Instrument | null; items: Item[]; onClose: () => void }) {
  const toast = useToast();
  const invalidate = useInvalidateBu(bu);
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(items.map(i => i.id)));
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    try {
      await api.post(`/api/v1/bus/${bu}/items/bulk`, [...chosen].map(id => ({ item_id: id, instrument_id: instrument?.id ?? undefined })));
      invalidate(); toast(`${chosen.size} items now tracked`, 'ok'); onClose();
    } catch (err) { toast(errorMessage(err), 'error'); } finally { setBusy(false); }
  }
  return (
    <Sheet open onClose={onClose} title={instrument ? `Track reagents for ${instrument.label ?? instrument.serial_no}` : 'Add tracked items'}>
      <p className="muted small" style={{ marginBottom: 10 }}>{instrument ? 'These items belong to this model in the catalogue. Untick any this unit does not use.' : 'Pick the catalogue items this unit keeps in stock.'}</p>
      <div className="panel" style={{ maxHeight: '48vh', overflow: 'auto', marginBottom: 12 }}>
        {items.map(i => (
          <label className="alert-row" key={i.id} style={{ cursor: 'pointer' }}>
            <input type="checkbox" checked={chosen.has(i.id)} onChange={e => { const s = new Set(chosen); e.target.checked ? s.add(i.id) : s.delete(i.id); setChosen(s); }} style={{ accentColor: 'var(--brand)', width: 18, height: 18 }} />
            <span className="grow"><div>{i.name}</div><div className="small muted"><span className="mono">{i.code}</span> · {kindLabel[i.kind]} · {fmtQty(i.pack_size)} {i.base_uom} / {i.pack_uom}</div></span>
          </label>
        ))}
      </div>
      <div className="form-actions"><Button onClick={onClose}>Skip</Button><Button variant="primary" onClick={submit} loading={busy} disabled={chosen.size === 0}>Track {chosen.size} item{chosen.size === 1 ? '' : 's'}</Button></div>
    </Sheet>
  );
}
