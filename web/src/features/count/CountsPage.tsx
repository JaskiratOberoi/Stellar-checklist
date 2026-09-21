import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useCounts } from '@/api/hooks';
import { useBuId } from '@/auth/AuthProvider';
import { Chip, Empty, Field, Input, PageHead, Panel, Select, Skeleton, addDays, fmtDate, fmtDateTime, todayIso, type Tone } from '@/ui';

const tone: Record<string, Tone> = { draft: 'warn', submitted: 'ok', locked: 'brand' };

export function CountsPage() {
  const bu = useBuId();
  const [from, setFrom] = useState(addDays(todayIso(), -30));
  const [to, setTo] = useState(todayIso());
  const [session, setSession] = useState('');
  const q = useCounts(bu, { from, to, session: session || undefined, limit: 200 });
  return (
    <>
      <PageHead title="Count history" sub="Every opening and closing count for this unit" />
      <div className="filters">
        <Field><Input type="date" value={from} onChange={e => setFrom(e.target.value)} aria-label="From" /></Field>
        <Field><Input type="date" value={to} onChange={e => setTo(e.target.value)} aria-label="To" /></Field>
        <Field><Select value={session} onChange={e => setSession(e.target.value)} aria-label="Session"><option value="">Both sessions</option><option value="opening">Opening</option><option value="closing">Closing</option></Select></Field>
      </div>
      {q.isLoading ? <Skeleton rows={5} /> : !q.data?.length ? <Panel><Empty title="No counts in this range" /></Panel> : (
        <Panel>
          <div className="table-wrap"><table>
            <thead><tr><th>Date</th><th>Session</th><th>Status</th><th className="num">Lines</th><th className="num">Variances</th><th>Submitted</th></tr></thead>
            <tbody>{q.data.map(c => (
              <tr key={c.id}>
                <td><Link to={`/count/${c.id}`}>{fmtDate(c.count_date, { weekday: 'short', day: 'numeric', month: 'short' })}</Link></td>
                <td style={{ textTransform: 'capitalize' }}>{c.session}</td>
                <td><Chip tone={tone[c.status]} icon={c.status === 'locked' ? 'lock' : undefined}>{c.status === 'draft' ? `Draft · ${c.confirmed_count}/${c.line_count}` : c.status}</Chip></td>
                <td className="num">{c.line_count}</td>
                <td className="num">{c.variance_count > 0 ? <span className="delta neg">{c.variance_count}</span> : '0'}</td>
                <td className="small muted">{c.submitted_at ? `${fmtDateTime(c.submitted_at)} · ${c.submitted_by}` : '—'}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </Panel>
      )}
    </>
  );
}
