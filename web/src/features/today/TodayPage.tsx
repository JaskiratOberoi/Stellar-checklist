import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, errorMessage } from '@/api/client';
import { useAlerts, useInvalidateBu, useToday } from '@/api/hooks';
import type { CountDetail, CountHeader, Session_, TodayStatus } from '@/api/types';
import { useAuth, useBuId } from '@/auth/AuthProvider';
import { Button, Chip, Icon, Panel, Skeleton, fmtDate, fmtTime, fmtQty, useToast, type IconName, type Tone } from '@/ui';

const statusMeta: Record<TodayStatus, { tone: Tone; label: string; icon: IconName }> = {
  submitted: { tone: 'ok', label: 'Submitted', icon: 'check' },
  draft: { tone: 'warn', label: 'In progress', icon: 'edit' },
  pending: { tone: 'neutral', label: 'Due', icon: 'clock' },
  missed: { tone: 'danger', label: 'Missed', icon: 'alert' },
};

export function TodayPage() {
  const bu = useBuId();
  const { bu: unit, can } = useAuth();
  const today = useToday(bu);
  const alerts = useAlerts(bu);
  const nav = useNavigate();
  const toast = useToast();
  const invalidate = useInvalidateBu(bu);
  const [starting, setStarting] = useState<Session_ | null>(null);

  async function start(session: Session_, existing?: CountHeader | null) {
    if (existing) { nav(`/count/${existing.id}`); return; }
    setStarting(session);
    try {
      const d = await api.post<CountDetail>(`/api/v1/bus/${bu}/counts`, { session });
      invalidate();
      nav(`/count/${d.header.id}`);
    } catch (e) { toast(errorMessage(e), 'error'); }
    finally { setStarting(null); }
  }

  const t = today.data;
  const editable = can('counts.edit');
  const next: Session_ | null = !t ? null : t.opening_status !== 'submitted' && t.closing_status !== 'submitted' ? 'opening' : t.closing_status !== 'submitted' ? 'closing' : null;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{unit?.name}</h1>
          <p className="sub">{t ? fmtDate(t.date, { weekday: 'long', day: 'numeric', month: 'long' }) : ' '}</p>
        </div>
      </div>

      {today.isLoading ? <Skeleton rows={2} /> : today.isError ? <Panel pad><p className="muted">Could not load today: {errorMessage(today.error)}</p></Panel> : t && (
        <Panel>
          <SessionRow name="Opening count" session="opening" status={t.opening_status} header={t.opening} due={t.opening_due_time} onOpen={() => start('opening', t.opening)} editable={editable} />
          <SessionRow name="Closing count" session="closing" status={t.closing_status} header={t.closing} due={t.closing_due_time} onOpen={() => start('closing', t.closing)} editable={editable} />
          <div style={{ padding: 16, borderTop: '1px solid var(--line-2)' }}>
            {next && editable ? (
              <Button variant="primary" block loading={starting !== null} onClick={() => start(next, next === 'opening' ? t.opening : t.closing)}>
                {(next === 'opening' ? t.opening : t.closing) ? `Continue ${next} count` : `Start ${next} count`}<Icon name="arrowRight" size={18} />
              </Button>
            ) : next ? <p className="muted">Counts are entered by technicians and managers.</p>
              : <p className="row muted"><Icon name="check" size={18} style={{ color: 'var(--ok)' }} />Both counts are in for today.</p>}
          </div>
        </Panel>
      )}

      <section className="section">
        <div className="row between" style={{ marginBottom: 10 }}><h2>Needs attention</h2><Link to="/alerts" className="small">All alerts</Link></div>
        {alerts.isLoading ? <Skeleton rows={2} /> : alerts.data && (
          <Panel>
            {alerts.data.missed_counts.length === 0 && alerts.data.low_stock.length === 0 && alerts.data.expiring_lots.length === 0 && (
              <div className="alert-row muted"><Icon name="check" size={18} style={{ color: 'var(--ok)' }} />Nothing outstanding. Stock levels are fine and no lots expire this month.</div>
            )}
            {alerts.data.missed_counts.slice(0, 3).map(m => (
              <div className="alert-row" key={m.date + m.session}><span className="dot" style={{ background: 'var(--danger)' }} /><span className="grow">Missed {m.session} count on {fmtDate(m.date)}</span><Chip tone="danger">Missed</Chip></div>
            ))}
            {alerts.data.low_stock.slice(0, 4).map(i => (
              <div className="alert-row" key={i.id}><span className="dot" style={{ background: 'var(--warn)' }} /><span className="grow truncate">{i.item_name}{i.instrument_label && <span className="faint"> · {i.instrument_label}</span>}</span><span className="mono small tnum">{fmtQty(i.qty_on_hand)} / min {fmtQty(i.min_level)} {i.base_uom}</span></div>
            ))}
            {alerts.data.expiring_lots.slice(0, 3).map(l => (
              <div className="alert-row" key={l.id}><span className="dot" style={{ background: (l.days_to_expiry ?? 99) < 0 ? 'var(--danger)' : 'var(--warn)' }} /><span className="grow truncate">{l.item_name} · lot <span className="mono">{l.lot_no}</span></span><span className="small muted nowrap">{(l.days_to_expiry ?? 0) < 0 ? 'expired' : `expires in ${l.days_to_expiry} d`}</span></div>
            ))}
          </Panel>
        )}
      </section>

      {editable && (
        <section className="section">
          <h2>Quick actions</h2>
          <div className="row wrap" style={{ marginTop: 10 }}>
            <Link to="/stock/receive" className="btn"><Icon name="truck" size={18} />Receive stock</Link>
            <Link to="/stock/move" className="btn"><Icon name="swap" size={18} />Wastage / adjust</Link>
            <Link to="/stock" className="btn"><Icon name="stock" size={18} />Stock levels</Link>
          </div>
        </section>
      )}
    </>
  );
}

function SessionRow({ name, session, status, header, due, onOpen, editable }: { name: string; session: Session_; status: TodayStatus; header?: CountHeader | null; due: string; onOpen: () => void; editable: boolean }) {
  const m = statusMeta[status];
  const meta = header?.status === 'submitted' || header?.status === 'locked'
    ? `Submitted ${header.submitted_at ? fmtDate(header.submitted_at, { hour: '2-digit', minute: '2-digit' }) : ''} by ${header.submitted_by ?? '—'}`
    : header ? `${header.confirmed_count} of ${header.line_count} lines confirmed`
    : status === 'missed' ? `Was due by ${fmtTime(due)}` : `Due by ${fmtTime(due)}`;
  const clickable = header || (editable && status !== 'submitted');
  return (
    <div className={`session-row ${status}`} role={clickable ? 'button' : undefined} tabIndex={clickable ? 0 : -1} onClick={clickable ? onOpen : undefined} onKeyDown={e => { if (clickable && (e.key === 'Enter' || e.key === ' ')) onOpen(); }} style={{ cursor: clickable ? 'pointer' : 'default' }}>
      <div className="glyph"><Icon name={session === 'opening' ? 'sun' : 'clock'} size={20} /></div>
      <div className="grow"><div className="name">{name}</div><div className="meta">{meta}</div></div>
      <Chip tone={m.tone} icon={m.icon}>{m.label}</Chip>
      {clickable && <Icon name="chevronRight" size={18} style={{ color: 'var(--ink-3)' }} />}
    </div>
  );
}
