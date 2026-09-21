import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { HttpError, api, errorMessage } from '@/api/client';
import { qk, useCount, useInvalidateBu } from '@/api/hooks';
import type { BuItem, CountDetail, CountLine } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import { Button, Chip, Confirm, Field, Icon, Input, Sheet, Skeleton, Textarea, fmtDate, fmtDateTime, fmtQty, packs as splitPacks, plural, useToast } from '@/ui';

type LineWrite = { bu_item_id: string; lot_id?: string | null; qty?: number; packs?: number; loose?: number; note?: string; confirmed?: boolean };
const keyOf = (l: { bu_item_id: string; lot_id?: string | null }) => `${l.bu_item_id}:${l.lot_id ?? ''}`;

export function CountPage() {
  const { countId = '' } = useParams();
  const q = useCount(countId);
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const { can } = useAuth();
  const d = q.data;
  const invalidate = useInvalidateBu(d?.header.bu_id ?? '');
  const [submitOpen, setSubmitOpen] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ message: string; keys: Set<string> } | null>(null);

  const apply = useCallback((data: CountDetail) => { qc.setQueryData(qk.count(countId), data); }, [qc, countId]);

  const saveLines = useCallback(async (writes: LineWrite[]) => {
    try {
      const data = await api.put<CountDetail>(`/api/v1/counts/${countId}/lines`, writes);
      apply(data);
      if (writes.length === 1) { setFlash(keyOf(writes[0])); setTimeout(() => setFlash(null), 700); }
      return true;
    } catch (e) { toast(errorMessage(e), 'error'); return false; }
  }, [countId, apply, toast]);

  async function confirmRemaining() {
    setBusy('confirm');
    try { apply(await api.post<CountDetail>(`/api/v1/counts/${countId}/confirm-remaining`)); }
    catch (e) { toast(errorMessage(e), 'error'); }
    finally { setBusy(null); }
  }

  async function submit(note: string) {
    setBusy('submit');
    try {
      const data = await api.post<CountDetail>(`/api/v1/counts/${countId}/submit`, { note: note || undefined });
      apply(data); invalidate(); setSubmitOpen(false); setProblem(null);
      toast(`${data.header.session === 'opening' ? 'Opening' : 'Closing'} count submitted`, 'ok');
    } catch (e) {
      if (e instanceof HttpError && e.status === 400) {
        const det = e.error.details as { unconfirmed?: { bu_item_id: string; lot_id?: string | null }[]; missing_notes?: { bu_item_id: string; lot_id?: string | null }[] } | undefined;
        const keys = new Set([...(det?.unconfirmed ?? []), ...(det?.missing_notes ?? [])].map(keyOf));
        setProblem({ message: e.error.message, keys });
        setSubmitOpen(false);
        const first = document.querySelector<HTMLElement>('[data-problem="1"]');
        first?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else toast(errorMessage(e), 'error');
    } finally { setBusy(null); }
  }

  async function reopen(reason: string) {
    setBusy('reopen');
    try { apply(await api.post<CountDetail>(`/api/v1/counts/${countId}/reopen`, { reason })); invalidate(); setReopenOpen(false); toast('Count reopened', 'ok'); }
    catch (e) { toast(errorMessage(e), 'error'); }
    finally { setBusy(null); }
  }

  const groups = useMemo(() => {
    if (!d) return [];
    const map = new Map<string, { title: string; model?: string | null; lines: CountLine[]; uncounted: BuItem[] }>();
    for (const l of d.lines) {
      const k = l.instrument_id ?? '__general';
      if (!map.has(k)) map.set(k, { title: l.instrument_label ?? 'General items', model: l.instrument_model, lines: [], uncounted: [] });
      map.get(k)!.lines.push(l);
    }
    for (const u of d.uncounted_lot_items ?? []) {
      const k = u.instrument_id ?? '__general';
      if (!map.has(k)) map.set(k, { title: u.instrument_label ?? 'General items', model: u.instrument_model, lines: [], uncounted: [] });
      map.get(k)!.uncounted.push(u);
    }
    return [...map.values()];
  }, [d]);
  const [addLot, setAddLot] = useState<BuItem | null>(null);

  if (q.isLoading) return <Skeleton rows={6} />;
  if (q.isError || !d) return <div className="empty"><h3>Count not found</h3><p>{q.error ? errorMessage(q.error) : ''}</p><Link to="/today">Back to today</Link></div>;

  const h = d.header;
  const editable = h.status === 'draft' && can('counts.edit');
  const pct = h.line_count ? Math.round((h.confirmed_count / h.line_count) * 100) : 0;
  const variances = d.lines.filter(l => l.requires_note);

  return (
    <>
      <div className="count-head">
        <div className="row between wrap" style={{ marginBottom: 8 }}>
          <div className="row" style={{ gap: 10 }}>
            <Button variant="ghost" icon="chevronLeft" aria-label="Back" onClick={() => nav(-1)} />
            <div>
              <h1 style={{ fontSize: 18 }}>{h.session === 'opening' ? 'Opening' : 'Closing'} count</h1>
              <div className="small muted">{fmtDate(h.count_date, { weekday: 'short', day: 'numeric', month: 'short' })} · {h.bu_code}{h.status !== 'draft' && h.submitted_at && ` · submitted ${fmtDateTime(h.submitted_at)} by ${h.submitted_by}`}</div>
            </div>
          </div>
          <div className="row">
            {h.status === 'draft' ? <Chip tone="warn" icon="edit">Draft</Chip> : h.status === 'locked' ? <Chip tone="brand" icon="lock">Locked</Chip> : <Chip tone="ok">Submitted</Chip>}
            {h.status === 'submitted' && can('counts.reopen') && <Button size="sm" onClick={() => setReopenOpen(true)}>Reopen</Button>}
          </div>
        </div>
        {editable && (
          <>
            <div className="row between small muted" style={{ marginBottom: 4 }}><span>{h.confirmed_count} of {h.line_count} lines confirmed</span><span className="tnum">{pct}%</span></div>
            <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><i style={{ transform: `scaleX(${pct / 100})` }} /></div>
          </>
        )}
      </div>

      {problem && (
        <div className="panel panel-pad" style={{ borderColor: 'var(--warn)', background: 'var(--warn-soft)', marginBottom: 12 }}>
          <div className="row"><Icon name="alert" size={18} style={{ color: 'var(--warn)' }} /><b>{problem.message}</b></div>
          <p className="small" style={{ marginTop: 4 }}>The affected lines are marked below. Confirm each quantity, and add a note where the count differs from what was expected.</p>
        </div>
      )}

      {groups.map(g => {
        const done = g.lines.filter(l => l.is_confirmed).length;
        return (
          <section className="sheet-section" key={g.title}>
            <header>
              <div><h3>{g.title}</h3>{g.model && <div className="serial">{g.model}</div>}</div>
              {editable && <span className="done">{done} / {g.lines.length}</span>}
            </header>
            {g.lines.map(l => <LineRow key={l.id} line={l} editable={editable} onSave={saveLines} flash={flash === keyOf(l)} problem={problem?.keys.has(keyOf(l)) ?? false} tolerance={d.variance_tolerance_pct} />)}
            {g.uncounted.map(u => (
              <div key={u.id} className="count-line" style={{ borderStyle: 'dashed' }}>
                <div className="grow"><div className="title muted">{u.item_name}</div><div className="sub"><span className="code">{u.item_code}</span><span>No lot on record, so it cannot be counted yet.</span></div></div>
                <div className="qty">{editable && <Button size="sm" icon="plus" onClick={() => setAddLot(u)}>Add lot</Button>}</div>
              </div>
            ))}
          </section>
        );
      })}
      {addLot && <AddLotSheet item={addLot} onClose={() => setAddLot(null)} onDone={async () => { setAddLot(null); await q.refetch(); invalidate(); }} />}

      {editable && (
        <div className="submit-bar">
          <div className="grow small muted">{h.line_count - h.confirmed_count > 0 ? `${h.line_count - h.confirmed_count} still to confirm` : 'All lines confirmed'}{variances.length > 0 && ` · ${variances.length} variance${variances.length > 1 ? 's' : ''}`}</div>
          {h.line_count - h.confirmed_count > 0 && <Button size="sm" onClick={confirmRemaining} loading={busy === 'confirm'}>Accept remaining</Button>}
          <Button variant="primary" onClick={() => setSubmitOpen(true)}>Submit<Icon name="arrowRight" size={16} /></Button>
        </div>
      )}

      <SubmitSheet open={submitOpen} onClose={() => setSubmitOpen(false)} detail={d} onSubmit={submit} busy={busy === 'submit'} />
      <ReopenSheet open={reopenOpen} onClose={() => setReopenOpen(false)} onConfirm={reopen} busy={busy === 'reopen'} />
    </>
  );
}

function LineRow({ line: l, editable, onSave, flash, problem, tolerance }: { line: CountLine; editable: boolean; onSave: (w: LineWrite[]) => Promise<boolean>; flash: boolean; problem: boolean; tolerance: number }) {
  const hasPacks = l.pack_size > 1;
  const derived = splitPacks(l.qty, l.pack_size);
  const [packs, setPacks] = useState(() => (l.packs_entered ?? derived?.p ?? '').toString());
  const [loose, setLoose] = useState(() => (l.loose_entered ?? derived?.loose ?? '').toString());
  const [qty, setQty] = useState(() => l.qty.toString());
  const [note, setNote] = useState(l.note ?? '');
  const [showNote, setShowNote] = useState(!!l.note || l.requires_note);
  const dirty = useRef(false);

  // Re-sync from the server when another write (confirm-remaining, sync) changed this line.
  useEffect(() => {
    if (dirty.current) return;
    const dv = splitPacks(l.qty, l.pack_size);
    setPacks((l.packs_entered ?? dv?.p ?? '').toString()); setLoose((l.loose_entered ?? dv?.loose ?? '').toString()); setQty(l.qty.toString()); setNote(l.note ?? '');
    if (l.note || l.requires_note) setShowNote(true);
  }, [l.qty, l.packs_entered, l.loose_entered, l.note, l.requires_note, l.pack_size]);

  const liveQty = hasPacks ? (parseFloat(packs) || 0) * l.pack_size + (parseFloat(loose) || 0) : parseFloat(qty) || 0;
  const expected = l.expected_qty;
  const delta = expected === null || expected === undefined ? null : liveQty - expected;
  const overTolerance = expected !== null && expected !== undefined && ((expected === 0 && liveQty !== 0) || (expected !== 0 && Math.abs(delta!) / expected * 100 > tolerance));

  async function commitQty() {
    if (!dirty.current) return;
    dirty.current = false;
    const w: LineWrite = { bu_item_id: l.bu_item_id, lot_id: l.lot_id ?? null, confirmed: true };
    if (hasPacks) { w.packs = parseFloat(packs) || 0; w.loose = parseFloat(loose) || 0; } else w.qty = parseFloat(qty) || 0;
    await onSave([w]);
  }
  async function commitNote() {
    if (note === (l.note ?? '')) return;
    await onSave([{ bu_item_id: l.bu_item_id, lot_id: l.lot_id ?? null, note }]);
  }
  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const inputs = [...document.querySelectorAll<HTMLInputElement>('input[data-qty]')];
    const i = inputs.indexOf(e.currentTarget);
    (inputs[i + 1] ?? e.currentTarget).focus();
    if (inputs[i + 1]) inputs[i + 1].select();
  }
  const mark = (fn: (v: string) => void) => (v: string) => { dirty.current = true; fn(v); };

  const cls = ['count-line', l.is_confirmed ? 'confirmed' : '', (l.requires_note || overTolerance) ? 'variance' : '', flash ? 'flash' : ''].filter(Boolean).join(' ');
  return (
    <div className={cls} data-problem={problem ? '1' : undefined} style={problem ? { outline: '2px solid var(--warn)', outlineOffset: 1 } : undefined}>
      <div className="grow">
        <div className="title">{l.item_name}</div>
        <div className="sub">
          <span className="code">{l.item_code}</span>
          {l.lot_no && <span className="chip" style={{ padding: '1px 8px' }}><span className="mono">{l.lot_no}</span>{l.expiry_date && <span className="faint">· exp {fmtDate(l.expiry_date, { month: 'short', year: '2-digit' })}</span>}</span>}
          {expected !== null && expected !== undefined && <span className="expected">expected <b>{fmtQty(expected)}</b> {l.base_uom}{hasPacks && derivedText(expected, l.pack_size, l.pack_uom)}</span>}
        </div>
      </div>
      <div className="qty">
        {editable ? hasPacks ? (
          <>
            <input data-qty className="input" type="number" inputMode="decimal" min={0} step="any" value={packs} onChange={e => mark(setPacks)(e.target.value)} onBlur={commitQty} onKeyDown={onKey} aria-label={`${l.item_name} ${l.pack_uom}s`} />
            <span className="unit">{l.pack_uom}</span>
            <input data-qty className="input" type="number" inputMode="decimal" min={0} step="any" value={loose} onChange={e => mark(setLoose)(e.target.value)} onBlur={commitQty} onKeyDown={onKey} aria-label={`${l.item_name} loose ${l.base_uom}`} />
            <span className="unit">{l.base_uom}</span>
          </>
        ) : (
          <>
            <input data-qty className="input" type="number" inputMode="decimal" min={0} step="any" value={qty} onChange={e => mark(setQty)(e.target.value)} onBlur={commitQty} onKeyDown={onKey} aria-label={`${l.item_name} ${l.base_uom}`} />
            <span className="unit">{l.base_uom}</span>
          </>
        ) : <span className="mono" style={{ fontSize: 18, fontWeight: 600 }}>{fmtQty(l.qty)} <span className="small muted">{l.base_uom}</span></span>}
      </div>
      <div className="total">
        <span>{hasPacks && editable ? <>Total <span className="val">{fmtQty(liveQty)}</span> {l.base_uom}</> : <span />}
          {delta !== null && delta !== 0 && <span className={`delta ${delta > 0 ? 'pos' : 'neg'}`} style={{ marginLeft: 10 }}>{delta > 0 ? '+' : ''}{fmtQty(delta)}</span>}
        </span>
        <span className="actions">
          {editable && !l.is_confirmed && <Button size="sm" onClick={() => onSave([{ bu_item_id: l.bu_item_id, lot_id: l.lot_id ?? null, confirmed: true }])}>Confirm</Button>}
          {l.is_confirmed && editable && <Chip tone="ok">Confirmed</Chip>}
          {editable && !showNote && <Button size="sm" variant="ghost" icon="edit" onClick={() => setShowNote(true)}>Note</Button>}
          {!editable && l.note && <span className="small muted">“{l.note}”</span>}
        </span>
      </div>
      {editable && showNote && (
        <div className="note"><Input value={note} placeholder={overTolerance ? 'Why does this differ from the expected quantity?' : 'Note (optional)'} onChange={e => setNote(e.target.value)} onBlur={commitNote} aria-label="Note" /></div>
      )}
    </div>
  );
}

function AddLotSheet({ item, onClose, onDone }: { item: BuItem; onClose: () => void; onDone: () => Promise<void> }) {
  const toast = useToast();
  const [lotNo, setLotNo] = useState(''); const [expiry, setExpiry] = useState(''); const [packs, setPacks] = useState(''); const [loose, setLoose] = useState('');
  const [busy, setBusy] = useState(false);
  const total = (parseFloat(packs) || 0) * item.pack_size + (parseFloat(loose) || 0);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    try {
      await api.post(`/api/v1/bus/${item.bu_id}/lots`, { bu_item_id: item.id, lot_no: lotNo, expiry_date: expiry || undefined, packs: parseFloat(packs) || 0, loose: parseFloat(loose) || 0, note: 'Opening stock booked from the count sheet' });
      toast(`Lot ${lotNo} added`, 'ok'); await onDone();
    } catch (err) { toast(errorMessage(err), 'error'); } finally { setBusy(false); }
  }
  return (
    <Sheet open onClose={onClose} title={`Add lot · ${item.item_name}`}>
      <p className="small muted" style={{ marginBottom: 10 }}>Book the stock that is on the shelf as a lot. It is recorded as a receipt and appears on this sheet straight away.</p>
      <form onSubmit={submit}>
        <div className="grid-2">
          <Field label="Lot number"><Input className="mono" value={lotNo} onChange={e => setLotNo(e.target.value)} required autoFocus /></Field>
          <Field label="Expiry date"><Input type="date" value={expiry} onChange={e => setExpiry(e.target.value)} required={item.tracks_expiry} /></Field>
          <Field label={`${plural(item.pack_uom, 2)} on shelf`} hint={`1 ${item.pack_uom} = ${fmtQty(item.pack_size)} ${item.base_uom}`}><Input type="number" inputMode="decimal" min={0} step="any" value={packs} onChange={e => setPacks(e.target.value)} /></Field>
          <Field label={`Loose ${item.base_uom}`}><Input type="number" inputMode="decimal" min={0} step="any" value={loose} onChange={e => setLoose(e.target.value)} /></Field>
        </div>
        <div className="row between wrap"><span>Total <b className="mono">{fmtQty(total)}</b> {item.base_uom}</span><div className="row"><Button type="button" onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" loading={busy} disabled={total <= 0 || !lotNo}>Add lot</Button></div></div>
      </form>
    </Sheet>
  );
}

function derivedText(qty: number, packSize: number, packUom: string) {
  const s = splitPacks(qty, packSize);
  if (!s) return null;
  return <span className="faint"> ({s.p} {plural(packUom, s.p)}{s.loose ? ` + ${fmtQty(s.loose)}` : ''})</span>;
}

function SubmitSheet({ open, onClose, detail, onSubmit, busy }: { open: boolean; onClose: () => void; detail: CountDetail; onSubmit: (note: string) => void; busy: boolean }) {
  const [note, setNote] = useState('');
  const unconfirmed = detail.lines.filter(l => !l.is_confirmed);
  const variances = detail.lines.filter(l => l.requires_note);
  const missingNotes = variances.filter(l => !l.note);
  return (
    <Sheet open={open} onClose={onClose} title={`Submit ${detail.header.session} count`}>
      <dl className="kv" style={{ marginBottom: 14 }}>
        <dt>Lines</dt><dd>{detail.lines.length} counted{unconfirmed.length > 0 && <span style={{ color: 'var(--warn)' }}> · {unconfirmed.length} not yet confirmed</span>}</dd>
        <dt>Variances</dt><dd>{variances.length === 0 ? 'None beyond tolerance' : `${variances.length}${missingNotes.length ? ` · ${missingNotes.length} without a note` : ''}`}</dd>
      </dl>
      {variances.length > 0 && (
        <div className="panel" style={{ marginBottom: 14, maxHeight: 220, overflow: 'auto' }}>
          {variances.map(l => (
            <div className="alert-row" key={l.id}><span className="grow"><div className="small">{l.item_name}{l.lot_no && <span className="mono muted"> · {l.lot_no}</span>}</div><div className="small muted">{l.note ?? <span style={{ color: 'var(--warn)' }}>note needed</span>}</div></span><span className={`delta ${l.variance > 0 ? 'pos' : 'neg'}`}>{l.variance > 0 ? '+' : ''}{fmtQty(l.variance)}</span></div>
          ))}
        </div>
      )}
      <Field label="Note for this count (optional)"><Textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Anything the manager should know" /></Field>
      <div className="form-actions"><Button onClick={onClose}>Back</Button><Button variant="primary" loading={busy} onClick={() => onSubmit(note)}>Submit count</Button></div>
    </Sheet>
  );
}

function ReopenSheet({ open, onClose, onConfirm, busy }: { open: boolean; onClose: () => void; onConfirm: (reason: string) => void; busy: boolean }) {
  const [reason, setReason] = useState('');
  return (
    <Confirm open={open} onClose={onClose} onConfirm={() => onConfirm(reason)} title="Reopen this count" body="The count goes back to draft so quantities can be corrected. The reason is recorded in the audit log." confirmLabel="Reopen" loading={busy}>
      <Field label="Reason"><Input value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. lot L2609A was miscounted" autoFocus /></Field>
    </Confirm>
  );
}
