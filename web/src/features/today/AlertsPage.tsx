import { Link } from 'react-router-dom';
import { useAlerts } from '@/api/hooks';
import { useBuId } from '@/auth/AuthProvider';
import { Chip, Empty, PageHead, Panel, Skeleton, fmtDate, fmtQty } from '@/ui';

export function AlertsPage() {
  const bu = useBuId();
  const q = useAlerts(bu);
  const a = q.data;
  return (
    <>
      <PageHead title="Alerts" sub="Low stock, expiring lots, missed counts and variances from the last week" />
      {q.isLoading || !a ? <Skeleton rows={4} /> : (
        <div className="stack">
          <Panel title={`Missed counts (${a.missed_counts.length})`}>
            {a.missed_counts.length === 0 ? <Empty title="No missed counts" icon="check" /> : a.missed_counts.map(m => (
              <div className="alert-row" key={m.date + m.session}><span className="dot" style={{ background: 'var(--danger)' }} /><span className="grow">{fmtDate(m.date, { weekday: 'short', day: 'numeric', month: 'short' })} · {m.session}</span><Link to="/counts" className="small">History</Link></div>
            ))}
          </Panel>
          <Panel title={`Low stock (${a.low_stock.length})`}>
            {a.low_stock.length === 0 ? <Empty title="Everything above minimum" icon="check" /> : a.low_stock.map(i => (
              <div className="alert-row" key={i.id}><span className="dot" style={{ background: i.qty_on_hand <= 0 ? 'var(--danger)' : 'var(--warn)' }} />
                <span className="grow"><div className="truncate">{i.item_name}</div><div className="small muted">{i.instrument_label ?? 'General'} · <span className="mono">{i.item_code}</span></div></span>
                <span className="mono small tnum nowrap">{fmtQty(i.qty_on_hand)} / {fmtQty(i.min_level)} {i.base_uom}</span></div>
            ))}
          </Panel>
          <Panel title={`Expiring within 30 days (${a.expiring_lots.length})`}>
            {a.expiring_lots.length === 0 ? <Empty title="No lots expiring soon" icon="check" /> : a.expiring_lots.map(l => (
              <div className="alert-row" key={l.id}><span className="dot" style={{ background: (l.days_to_expiry ?? 1) < 0 ? 'var(--danger)' : 'var(--warn)' }} />
                <span className="grow"><div className="truncate">{l.item_name}</div><div className="small muted">lot <span className="mono">{l.lot_no}</span> · {fmtQty(l.qty_on_hand)} {l.base_uom} on hand</div></span>
                <Chip tone={(l.days_to_expiry ?? 1) < 0 ? 'danger' : 'warn'} icon={null}>{(l.days_to_expiry ?? 0) < 0 ? 'Expired' : `${l.days_to_expiry} d`}</Chip></div>
            ))}
          </Panel>
          <Panel title={`Variances noted (${a.recent_variances.length})`}>
            {a.recent_variances.length === 0 ? <Empty title="No variances beyond tolerance" icon="check" /> : a.recent_variances.map((v, i) => (
              <div className="alert-row" key={i}><span className="dot" style={{ background: 'var(--warn)' }} />
                <span className="grow"><div>{v.item_name}{v.lot_no && <span className="mono small muted"> · {v.lot_no}</span>}</div><div className="small muted">{fmtDate(v.count_date)} {v.session} · {v.note ?? 'no note'} · {v.submitted_by ?? ''}</div></span>
                <span className={`delta ${v.variance > 0 ? 'pos' : 'neg'}`}>{v.variance > 0 ? '+' : ''}{fmtQty(v.variance)}</span></div>
            ))}
          </Panel>
        </div>
      )}
    </>
  );
}
