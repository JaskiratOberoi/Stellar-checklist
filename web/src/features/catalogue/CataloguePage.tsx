import { useState, type FormEvent } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '@/api/client';
import { useCatalogueItems, useModels, useSuppliers } from '@/api/hooks';
import type { InstrumentModel, Item, Supplier } from '@/api/types';
import { Button, Chip, Empty, Field, Input, PageHead, Panel, Select, Sheet, Skeleton, fmtQty, kindLabel, useDebounced, useToast } from '@/ui';

export function CataloguePage() {
  return (
    <>
      <PageHead title="Catalogue" sub="Shared across every business unit. Reagents attach to an instrument model; everything else is general." />
      <nav className="tabs">
        <NavLink to="/catalogue" end className={({ isActive }) => (isActive ? 'active' : '')}>Items</NavLink>
        <NavLink to="/catalogue/models" className={({ isActive }) => (isActive ? 'active' : '')}>Instrument models</NavLink>
        <NavLink to="/catalogue/suppliers" className={({ isActive }) => (isActive ? 'active' : '')}>Suppliers</NavLink>
      </nav>
      <Routes>
        <Route index element={<ItemsTab />} />
        <Route path="models" element={<ModelsTab />} />
        <Route path="suppliers" element={<SuppliersTab />} />
      </Routes>
    </>
  );
}

const storages = [['room', 'Room temperature'], ['fridge_2_8', 'Fridge 2–8 °C'], ['freezer_minus20', 'Freezer −20 °C'], ['freezer_minus80', 'Freezer −80 °C']];

function ItemsTab() {
  const [q, setQ] = useState(''); const dq = useDebounced(q);
  const [kind, setKind] = useState(''); const [model, setModel] = useState(''); const [inactive, setInactive] = useState(false);
  const items = useCatalogueItems({ q: dq || undefined, kind: kind || undefined, instrument_model_id: model || undefined, include_inactive: inactive });
  const models = useModels();
  const [edit, setEdit] = useState<Item | 'new' | null>(null);
  return (
    <>
      <div className="filters">
        <Field><Input placeholder="Search" value={q} onChange={e => setQ(e.target.value)} aria-label="Search" /></Field>
        <Field><Select value={kind} onChange={e => setKind(e.target.value)} aria-label="Kind"><option value="">All kinds</option>{Object.entries(kindLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        <Field><Select value={model} onChange={e => setModel(e.target.value)} aria-label="Model"><option value="">All models</option>{models.data?.map(m => <option key={m.id} value={m.id}>{m.manufacturer} {m.model_name}</option>)}</Select></Field>
        <label className="check"><input type="checkbox" checked={inactive} onChange={e => setInactive(e.target.checked)} />Show inactive</label>
        <span className="grow" /><Button variant="primary" icon="plus" onClick={() => setEdit('new')}>New item</Button>
      </div>
      {items.isLoading ? <Skeleton rows={6} /> : !items.data?.length ? <Panel><Empty title="No items" /></Panel> : (
        <Panel><div className="table-wrap"><table>
          <thead><tr><th>Code</th><th>Name</th><th>Kind</th><th>Model</th><th>Pack</th><th>Lot</th><th>Storage</th><th></th></tr></thead>
          <tbody>{items.data.map(i => (
            <tr key={i.id} style={{ opacity: i.is_active ? 1 : 0.55 }}>
              <td className="mono small">{i.code}</td><td>{i.name}<div className="small muted">{i.manufacturer}{i.catalogue_no && ` · ${i.catalogue_no}`}</div></td>
              <td><Chip icon={null}>{kindLabel[i.kind]}</Chip></td><td className="small muted">{i.instrument_model_name ?? 'General'}</td>
              <td className="small nowrap">{fmtQty(i.pack_size)} {i.base_uom} / {i.pack_uom}</td><td className="small muted">{i.tracks_lot ? (i.tracks_expiry ? 'lot + expiry' : 'lot') : '—'}</td>
              <td className="small muted">{storages.find(s => s[0] === i.storage)?.[1]}</td>
              <td><Button size="sm" variant="ghost" icon="edit" aria-label="Edit" onClick={() => setEdit(i)} /></td>
            </tr>
          ))}</tbody>
        </table></div></Panel>
      )}
      {edit && <ItemSheet item={edit === 'new' ? null : edit} models={models.data ?? []} onClose={() => setEdit(null)} />}
    </>
  );
}

function ItemSheet({ item, models, onClose }: { item: Item | null; models: InstrumentModel[]; onClose: () => void }) {
  const toast = useToast(); const qc = useQueryClient();
  const [f, setF] = useState({
    code: item?.code ?? '', name: item?.name ?? '', kind: item?.kind ?? 'reagent', category: item?.category ?? '', manufacturer: item?.manufacturer ?? '', catalogue_no: item?.catalogue_no ?? '',
    base_uom: item?.base_uom ?? '', pack_size: item?.pack_size?.toString() ?? '1', pack_uom: item?.pack_uom ?? 'pack', tracks_lot: item?.tracks_lot ?? true, tracks_expiry: item?.tracks_expiry ?? true,
    storage: item?.storage ?? 'room', hazard: item?.hazard ?? '', instrument_model_id: item?.instrument_model_id ?? '', default_min_level: item?.default_min_level?.toString() ?? '', is_active: item?.is_active ?? true,
  });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (v: string | boolean) => setF({ ...f, [k]: v });
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true);
    const body = { ...f, pack_size: +f.pack_size || 1, default_min_level: f.default_min_level === '' ? null : +f.default_min_level, instrument_model_id: f.instrument_model_id || null, clear_instrument_model: !f.instrument_model_id, category: f.category || null, manufacturer: f.manufacturer || null, catalogue_no: f.catalogue_no || null, hazard: f.hazard || null };
    try {
      if (item) await api.patch(`/api/v1/catalogue/items/${item.id}`, body); else await api.post('/api/v1/catalogue/items', body);
      qc.invalidateQueries({ queryKey: ['catalogue'] }); toast(item ? 'Item saved' : 'Item created', 'ok'); onClose();
    } catch (err) { toast(errorMessage(err), 'error'); } finally { setBusy(false); }
  }
  return (
    <Sheet open onClose={onClose} title={item ? item.name : 'New catalogue item'} wide>
      <form onSubmit={submit}>
        <div className="grid-2">
          <Field label="Code" hint="Stable identifier used by integrations"><Input className="mono" value={f.code} onChange={e => set('code')(e.target.value)} required disabled={!!item} /></Field>
          <Field label="Name"><Input value={f.name} onChange={e => set('name')(e.target.value)} required /></Field>
          <Field label="Kind"><Select value={f.kind} onChange={e => set('kind')(e.target.value)}>{Object.entries(kindLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          <Field label="Instrument model" hint="Leave empty for general materials"><Select value={f.instrument_model_id} onChange={e => set('instrument_model_id')(e.target.value)}><option value="">General (no instrument)</option>{models.map(m => <option key={m.id} value={m.id}>{m.manufacturer} {m.model_name}</option>)}</Select></Field>
          <Field label="Base unit" hint="test, mL, piece, g"><Input value={f.base_uom} onChange={e => set('base_uom')(e.target.value)} required /></Field>
          <Field label="Pack size (base units per pack)"><Input type="number" inputMode="decimal" min={0} step="any" value={f.pack_size} onChange={e => set('pack_size')(e.target.value)} required /></Field>
          <Field label="Pack unit" hint="bottle, kit, box, cubitainer"><Input value={f.pack_uom} onChange={e => set('pack_uom')(e.target.value)} /></Field>
          <Field label="Storage"><Select value={f.storage} onChange={e => set('storage')(e.target.value)}>{storages.map(s => <option key={s[0]} value={s[0]}>{s[1]}</option>)}</Select></Field>
          <Field label="Manufacturer"><Input value={f.manufacturer} onChange={e => set('manufacturer')(e.target.value)} /></Field>
          <Field label="Catalogue number"><Input className="mono" value={f.catalogue_no} onChange={e => set('catalogue_no')(e.target.value)} /></Field>
          <Field label="Category" hint="Free text grouping, e.g. phlebotomy"><Input value={f.category} onChange={e => set('category')(e.target.value)} /></Field>
          <Field label="Default minimum level"><Input type="number" inputMode="decimal" value={f.default_min_level} onChange={e => set('default_min_level')(e.target.value)} /></Field>
          <Field label="Hazard note"><Input value={f.hazard} onChange={e => set('hazard')(e.target.value)} /></Field>
        </div>
        <div className="row wrap" style={{ gap: 16, marginBottom: 12 }}>
          <label className="check"><input type="checkbox" checked={f.tracks_lot} onChange={e => set('tracks_lot')(e.target.checked)} />Tracks lots</label>
          <label className="check"><input type="checkbox" checked={f.tracks_expiry} onChange={e => set('tracks_expiry')(e.target.checked)} />Tracks expiry</label>
          {item && <label className="check"><input type="checkbox" checked={f.is_active} onChange={e => set('is_active')(e.target.checked)} />Active</label>}
        </div>
        <div className="form-actions"><Button type="button" onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" loading={busy}>{item ? 'Save' : 'Create'}</Button></div>
      </form>
    </Sheet>
  );
}

function ModelsTab() {
  const models = useModels(true);
  const [edit, setEdit] = useState<InstrumentModel | 'new' | null>(null);
  return (
    <>
      <div className="filters"><span className="grow" /><Button variant="primary" icon="plus" onClick={() => setEdit('new')}>New model</Button></div>
      {models.isLoading ? <Skeleton rows={4} /> : (
        <Panel><div className="table-wrap"><table>
          <thead><tr><th>Manufacturer</th><th>Model</th><th>Category</th><th className="num">Reagents</th><th className="num">Instruments</th><th></th></tr></thead>
          <tbody>{models.data?.map(m => (
            <tr key={m.id} style={{ opacity: m.is_active ? 1 : 0.55 }}><td>{m.manufacturer}</td><td>{m.model_name}</td><td className="small muted">{m.category}</td><td className="num">{m.item_count}</td><td className="num">{m.instrument_count}</td><td><Button size="sm" variant="ghost" icon="edit" aria-label="Edit" onClick={() => setEdit(m)} /></td></tr>
          ))}</tbody>
        </table></div></Panel>
      )}
      {edit && <ModelSheet model={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function ModelSheet({ model, onClose }: { model: InstrumentModel | null; onClose: () => void }) {
  const toast = useToast(); const qc = useQueryClient();
  const [f, setF] = useState({ manufacturer: model?.manufacturer ?? '', model_name: model?.model_name ?? '', category: model?.category ?? 'haematology', notes: model?.notes ?? '', is_active: model?.is_active ?? true });
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true);
    try {
      if (model) await api.patch(`/api/v1/catalogue/instrument-models/${model.id}`, f); else await api.post('/api/v1/catalogue/instrument-models', f);
      qc.invalidateQueries({ queryKey: ['catalogue'] }); toast('Saved', 'ok'); onClose();
    } catch (err) { toast(errorMessage(err), 'error'); } finally { setBusy(false); }
  }
  return (
    <Sheet open onClose={onClose} title={model ? `${model.manufacturer} ${model.model_name}` : 'New instrument model'}>
      <form onSubmit={submit}>
        <div className="grid-2">
          <Field label="Manufacturer"><Input value={f.manufacturer} onChange={e => setF({ ...f, manufacturer: e.target.value })} required /></Field>
          <Field label="Model"><Input value={f.model_name} onChange={e => setF({ ...f, model_name: e.target.value })} required /></Field>
          <Field label="Category"><Select value={f.category} onChange={e => setF({ ...f, category: e.target.value })}>{['haematology', 'biochemistry', 'immunoassay', 'coagulation', 'urinalysis', 'microbiology', 'molecular', 'other'].map(c => <option key={c}>{c}</option>)}</Select></Field>
          <Field label="Notes"><Input value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} /></Field>
        </div>
        {model && <label className="check" style={{ marginBottom: 12 }}><input type="checkbox" checked={f.is_active} onChange={e => setF({ ...f, is_active: e.target.checked })} />Active</label>}
        <div className="form-actions"><Button type="button" onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" loading={busy}>{model ? 'Save' : 'Create'}</Button></div>
      </form>
    </Sheet>
  );
}

function SuppliersTab() {
  const s = useSuppliers(true);
  const [edit, setEdit] = useState<Supplier | 'new' | null>(null);
  return (
    <>
      <div className="filters"><span className="grow" /><Button variant="primary" icon="plus" onClick={() => setEdit('new')}>New supplier</Button></div>
      {s.isLoading ? <Skeleton rows={3} /> : !s.data?.length ? <Panel><Empty title="No suppliers yet" /></Panel> : (
        <Panel>{s.data.map(x => <div className="alert-row" key={x.id} style={{ opacity: x.is_active ? 1 : 0.55 }}><span className="grow">{x.name}<div className="small muted">{x.contact}{x.gstin && ` · GSTIN ${x.gstin}`}</div></span><Button size="sm" variant="ghost" icon="edit" aria-label="Edit" onClick={() => setEdit(x)} /></div>)}</Panel>
      )}
      {edit && <SupplierSheet supplier={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function SupplierSheet({ supplier, onClose }: { supplier: Supplier | null; onClose: () => void }) {
  const toast = useToast(); const qc = useQueryClient();
  const [f, setF] = useState({ name: supplier?.name ?? '', contact: supplier?.contact ?? '', gstin: supplier?.gstin ?? '', is_active: supplier?.is_active ?? true });
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true);
    try {
      if (supplier) await api.patch(`/api/v1/catalogue/suppliers/${supplier.id}`, f); else await api.post('/api/v1/catalogue/suppliers', f);
      qc.invalidateQueries({ queryKey: ['catalogue'] }); toast('Saved', 'ok'); onClose();
    } catch (err) { toast(errorMessage(err), 'error'); } finally { setBusy(false); }
  }
  return (
    <Sheet open onClose={onClose} title={supplier ? supplier.name : 'New supplier'}>
      <form onSubmit={submit}>
        <Field label="Name"><Input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} required /></Field>
        <Field label="Contact"><Input value={f.contact} onChange={e => setF({ ...f, contact: e.target.value })} /></Field>
        <Field label="GSTIN"><Input className="mono" value={f.gstin} onChange={e => setF({ ...f, gstin: e.target.value })} /></Field>
        {supplier && <label className="check" style={{ marginBottom: 12 }}><input type="checkbox" checked={f.is_active} onChange={e => setF({ ...f, is_active: e.target.checked })} />Active</label>}
        <div className="form-actions"><Button type="button" onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" loading={busy}>{supplier ? 'Save' : 'Create'}</Button></div>
      </form>
    </Sheet>
  );
}
