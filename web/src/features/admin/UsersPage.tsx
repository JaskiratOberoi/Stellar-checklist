import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '@/api/client';
import { useBus } from '@/api/hooks';
import type { AdminUser, Role } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import { Button, Chip, Field, Input, PageHead, Panel, Select, Sheet, Skeleton, fmtDateTime, useToast } from '@/ui';

const roleLabel: Record<Role, string> = { super_admin: 'Super admin', admin: 'Admin', bu_manager: 'Unit manager', lab_tech: 'Lab technician', viewer: 'Viewer' };

export function UsersPage() {
  const [inactive, setInactive] = useState(false);
  const q = useQuery({ queryKey: ['users', inactive], queryFn: () => api.get<AdminUser[]>('/api/v1/admin/users', { include_inactive: inactive }) });
  const [edit, setEdit] = useState<AdminUser | 'new' | null>(null);
  const [temp, setTemp] = useState<{ email: string; password: string } | null>(null);
  const toast = useToast();
  async function reset(u: AdminUser) {
    try { const r = await api.post<{ temporary_password: string }>(`/api/v1/admin/users/${u.id}/reset-password`); setTemp({ email: u.email, password: r.temporary_password }); }
    catch (e) { toast(errorMessage(e), 'error'); }
  }
  return (
    <>
      <PageHead title="Users" sub="One role per user. Managers, technicians and viewers are scoped to their units." actions={<><label className="check"><input type="checkbox" checked={inactive} onChange={e => setInactive(e.target.checked)} />Show inactive</label><Button variant="primary" icon="plus" onClick={() => setEdit('new')}>New user</Button></>} />
      {q.isLoading ? <Skeleton rows={5} /> : (
        <Panel><div className="table-wrap"><table>
          <thead><tr><th>Name</th><th>Role</th><th>Units</th><th>Last sign-in</th><th></th></tr></thead>
          <tbody>{q.data?.map(u => (
            <tr key={u.id} style={{ opacity: u.is_active ? 1 : 0.55 }}>
              <td>{u.full_name}<div className="small muted">{u.email}</div></td>
              <td><Chip tone={u.role === 'super_admin' ? 'brand' : 'neutral'} icon={null}>{roleLabel[u.role]}</Chip></td>
              <td className="small muted">{u.role === 'super_admin' || u.role === 'admin' ? 'All units' : u.bu_codes.join(', ') || <span style={{ color: 'var(--warn)' }}>none</span>}</td>
              <td className="small muted">{u.last_login_at ? fmtDateTime(u.last_login_at) : 'never'}</td>
              <td className="nowrap"><Button size="sm" variant="ghost" onClick={() => reset(u)}>Reset password</Button> <Button size="sm" variant="ghost" icon="edit" aria-label="Edit" onClick={() => setEdit(u)} /></td>
            </tr>
          ))}</tbody>
        </table></div></Panel>
      )}
      {edit && <UserSheet user={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onTemp={setTemp} />}
      <Sheet open={!!temp} onClose={() => setTemp(null)} title="Temporary password">
        <p className="muted small" style={{ marginBottom: 10 }}>Share this with {temp?.email} through a safe channel. It is shown once; they should change it after signing in.</p>
        <div className="code-box">{temp?.password}</div>
        <div className="form-actions"><Button variant="primary" onClick={() => setTemp(null)}>Done</Button></div>
      </Sheet>
    </>
  );
}

function UserSheet({ user, onClose, onTemp }: { user: AdminUser | null; onClose: () => void; onTemp: (t: { email: string; password: string }) => void }) {
  const toast = useToast(); const qc = useQueryClient();
  const { isRole } = useAuth();
  const bus = useBus(true);
  const [f, setF] = useState({ email: user?.email ?? '', full_name: user?.full_name ?? '', phone: user?.phone ?? '', role: user?.role ?? 'lab_tech', is_active: user?.is_active ?? true, password: '' });
  const [buIds, setBuIds] = useState<Set<string>>(new Set(user?.bu_ids ?? []));
  const [busy, setBusy] = useState(false);
  const scoped = f.role !== 'super_admin' && f.role !== 'admin';
  const roles: Role[] = isRole('super_admin') ? ['super_admin', 'admin', 'bu_manager', 'lab_tech', 'viewer'] : ['bu_manager', 'lab_tech', 'viewer'];
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true);
    try {
      const body = { ...f, phone: f.phone || null, password: f.password || undefined, bu_ids: scoped ? [...buIds] : [] };
      if (user) { await api.patch(`/api/v1/admin/users/${user.id}`, body); toast('User saved', 'ok'); }
      else { const r = await api.post<{ temporary_password?: string | null }>('/api/v1/admin/users', body); toast('User created', 'ok'); if (r.temporary_password) onTemp({ email: f.email, password: r.temporary_password }); }
      qc.invalidateQueries({ queryKey: ['users'] }); onClose();
    } catch (err) { toast(errorMessage(err), 'error'); } finally { setBusy(false); }
  }
  return (
    <Sheet open onClose={onClose} title={user ? user.full_name : 'New user'}>
      <form onSubmit={submit}>
        <div className="grid-2">
          <Field label="Full name"><Input value={f.full_name} onChange={e => setF({ ...f, full_name: e.target.value })} required /></Field>
          <Field label="Email"><Input type="email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} required disabled={!!user} /></Field>
          <Field label="Phone"><Input value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} /></Field>
          <Field label="Role"><Select value={f.role} onChange={e => setF({ ...f, role: e.target.value as Role })}>{roles.map(r => <option key={r} value={r}>{roleLabel[r]}</option>)}</Select></Field>
          {!user && <Field label="Password" hint="Leave empty to generate a temporary one"><Input type="text" autoComplete="off" value={f.password} onChange={e => setF({ ...f, password: e.target.value })} /></Field>}
        </div>
        {scoped && (
          <Field label="Business units" hint="The first ticked unit opens by default">
            <div className="panel" style={{ maxHeight: 200, overflow: 'auto' }}>{bus.data?.filter(b => b.is_active).map(b => (
              <label key={b.id} className="alert-row" style={{ cursor: 'pointer' }}><input type="checkbox" checked={buIds.has(b.id)} onChange={e => { const s = new Set(buIds); e.target.checked ? s.add(b.id) : s.delete(b.id); setBuIds(s); }} style={{ accentColor: 'var(--brand)', width: 18, height: 18 }} /><span className="grow">{b.name} <span className="mono small muted">{b.code}</span></span></label>
            ))}</div>
          </Field>
        )}
        {user && <label className="check" style={{ marginBottom: 12 }}><input type="checkbox" checked={f.is_active} onChange={e => setF({ ...f, is_active: e.target.checked })} />Active (inactive users are signed out everywhere)</label>}
        <div className="form-actions"><Button type="button" onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" loading={busy}>{user ? 'Save' : 'Create'}</Button></div>
      </form>
    </Sheet>
  );
}
