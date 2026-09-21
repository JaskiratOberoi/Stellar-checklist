import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, errorMessage } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { Button, Field, Input, PageHead, Panel, useToast } from '@/ui';

export function SettingsPage() {
  const { user, bus, bu, setBu, logout } = useAuth();
  const toast = useToast(); const nav = useNavigate();
  const [cur, setCur] = useState(''); const [nw, setNw] = useState(''); const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  async function change(e: FormEvent) {
    e.preventDefault();
    if (nw !== again) { toast('New passwords do not match', 'error'); return; }
    setBusy(true);
    try { await api.post('/api/v1/auth/change-password', { current_password: cur, new_password: nw }); toast('Password changed', 'ok'); setCur(''); setNw(''); setAgain(''); }
    catch (err) { toast(errorMessage(err), 'error'); } finally { setBusy(false); }
  }
  return (
    <>
      <PageHead title="Settings" sub={`${user?.full_name} · ${user?.email}`} />
      <div className="stack">
        {bus.length > 1 && (
          <Panel title="Default business unit" pad>
            <div className="row wrap">{bus.map(b => <Button key={b.id} variant={b.id === bu?.id ? 'primary' : 'default'} size="sm" onClick={() => setBu(b.id)}>{b.code}</Button>)}</div>
          </Panel>
        )}
        <Panel title="Change password" pad>
          <form onSubmit={change} style={{ maxWidth: 420 }}>
            <Field label="Current password"><Input type="password" autoComplete="current-password" value={cur} onChange={e => setCur(e.target.value)} required /></Field>
            <Field label="New password" hint="At least 8 characters"><Input type="password" autoComplete="new-password" value={nw} onChange={e => setNw(e.target.value)} required minLength={8} /></Field>
            <Field label="Repeat new password"><Input type="password" autoComplete="new-password" value={again} onChange={e => setAgain(e.target.value)} required /></Field>
            <div className="form-actions"><Button type="submit" variant="primary" loading={busy}>Change password</Button></div>
          </form>
        </Panel>
        <Panel title="Install on this device" pad>
          <p className="muted small">Android (Chrome): open the browser menu and choose <b>Install app</b>. iPhone (Safari): tap Share, then <b>Add to Home Screen</b>. The app then opens full-screen with its own icon.</p>
        </Panel>
        <Panel title="Session" pad>
          <div className="row wrap"><Button onClick={() => logout().then(() => nav('/login'))} icon="logout">Sign out</Button><Button variant="danger" onClick={async () => { try { await api.post('/api/v1/auth/logout-all'); } catch { /* ignore */ } await logout(); nav('/login'); }}>Sign out everywhere</Button></div>
        </Panel>
      </div>
    </>
  );
}
