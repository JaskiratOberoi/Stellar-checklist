import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '@/api/client';
import type { ApiKey } from '@/api/types';
import { Button, Chip, Confirm, Empty, Field, Input, PageHead, Panel, Sheet, Skeleton, fmtDateTime, useToast } from '@/ui';

const scopes: [string, string][] = [
  ['catalogue:read', 'Items, models, business units, instruments'],
  ['export:counts', 'Count headers and lines'],
  ['export:movements', 'Movement ledger and lots'],
  ['export:levels', 'Current stock per item'],
  ['export:snapshots', 'Period opening / closing (no consumption)'],
  ['export:consumption', 'Daily and period consumption'],
  ['ingest:movements', 'Push receipts and adjustments in'],
  ['webhooks:manage', 'Manage webhook subscriptions (not built yet)'],
];

export function ApiKeysPage() {
  const q = useQuery({ queryKey: ['api-keys'], queryFn: () => api.get<ApiKey[]>('/api/v1/admin/api-keys') });
  const qc = useQueryClient(); const toast = useToast();
  const [create, setCreate] = useState(false);
  const [issued, setIssued] = useState<{ name: string; key: string } | null>(null);
  const [revoke, setRevoke] = useState<ApiKey | null>(null);
  const [f, setF] = useState({ name: '', scopes: new Set<string>(['catalogue:read', 'export:counts']), ips: '' });
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true);
    try {
      const r = await api.post<{ name: string; key: string }>('/api/v1/admin/api-keys', { name: f.name, scopes: [...f.scopes], allowed_ips: f.ips.split(',').map(s => s.trim()).filter(Boolean) });
      qc.invalidateQueries({ queryKey: ['api-keys'] }); setCreate(false); setIssued(r); setF({ name: '', scopes: new Set(['catalogue:read', 'export:counts']), ips: '' });
    } catch (err) { toast(errorMessage(err), 'error'); } finally { setBusy(false); }
  }
  async function doRevoke() {
    if (!revoke) return;
    try { await api.post(`/api/v1/admin/api-keys/${revoke.id}/revoke`); qc.invalidateQueries({ queryKey: ['api-keys'] }); toast('Key revoked', 'ok'); setRevoke(null); }
    catch (e) { toast(errorMessage(e), 'error'); }
  }
  return (
    <>
      <PageHead title="API keys" sub="Machine access for Matter, Infinity and other systems. Keys are shown once." actions={<Button variant="primary" icon="plus" onClick={() => setCreate(true)}>New key</Button>} />
      {q.isLoading ? <Skeleton rows={3} /> : !q.data?.length ? <Panel><Empty title="No API keys" icon="key" /></Panel> : (
        <Panel>{q.data.map(k => (
          <div className="alert-row" key={k.id} style={{ opacity: k.is_active ? 1 : 0.55 }}>
            <span className="grow"><div>{k.name} <span className="mono small muted">{k.key_prefix}…</span></div><div className="small muted">{k.scopes.join(', ')}{k.allowed_ips?.length ? ` · IPs ${k.allowed_ips.join(', ')}` : ''} · {k.last_used_at ? `last used ${fmtDateTime(k.last_used_at)}` : 'never used'}</div></span>
            {k.is_active ? <Button size="sm" variant="danger" onClick={() => setRevoke(k)}>Revoke</Button> : <Chip icon={null}>revoked</Chip>}
          </div>
        ))}</Panel>
      )}
      <Sheet open={create} onClose={() => setCreate(false)} title="New API key">
        <form onSubmit={submit}>
          <Field label="Name" hint="e.g. infinity-prod, matter-staging"><Input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} required /></Field>
          <Field label="Scopes"><div className="panel">{scopes.map(([s, d]) => <label key={s} className="alert-row" style={{ cursor: 'pointer' }}><input type="checkbox" checked={f.scopes.has(s)} onChange={e => { const n = new Set(f.scopes); e.target.checked ? n.add(s) : n.delete(s); setF({ ...f, scopes: n }); }} style={{ accentColor: 'var(--brand)', width: 18, height: 18 }} /><span className="grow"><span className="mono small">{s}</span><div className="small muted">{d}</div></span></label>)}</div></Field>
          <Field label="Allowed IPs (optional, comma separated)"><Input className="mono" value={f.ips} onChange={e => setF({ ...f, ips: e.target.value })} placeholder="203.0.113.10, 198.51.100.0/24" /></Field>
          <div className="form-actions"><Button type="button" onClick={() => setCreate(false)}>Cancel</Button><Button type="submit" variant="primary" loading={busy}>Issue key</Button></div>
        </form>
      </Sheet>
      <Sheet open={!!issued} onClose={() => setIssued(null)} title={`Key for ${issued?.name}`}>
        <p className="muted small" style={{ marginBottom: 10 }}>Copy it now. It is stored hashed and cannot be shown again. Send it as the <span className="mono">X-Api-Key</span> header.</p>
        <div className="code-box">{issued?.key}</div>
        <div className="form-actions"><Button variant="primary" onClick={() => setIssued(null)}>Done</Button></div>
      </Sheet>
      <Confirm open={!!revoke} onClose={() => setRevoke(null)} onConfirm={doRevoke} title={`Revoke ${revoke?.name}?`} body="Every request using this key fails immediately. This cannot be undone." confirmLabel="Revoke" danger />
    </>
  );
}
