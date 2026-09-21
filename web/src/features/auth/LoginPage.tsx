import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { auth, errorMessage } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { Button, Field, Input } from '@/ui';

export function LoginPage() {
  const { session } = useAuth();
  const nav = useNavigate();
  const loc = useLocation() as { state?: { from?: string } };
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (session) return <Navigate to={loc.state?.from ?? '/today'} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try { await auth.login(email.trim(), password); nav(loc.state?.from ?? '/today', { replace: true }); }
    catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  }

  return (
    <div className="login">
      <form className="card" onSubmit={submit}>
        <div className="brand">
          <img src="/icons/icon.svg" alt="" />
          <div><h1>Stock Management System</h1><p>Reagents and materials, every business unit</p></div>
        </div>
        <Field label="Email"><Input type="email" autoComplete="username" inputMode="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus /></Field>
        <Field label="Password" error={error}><Input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required /></Field>
        <Button type="submit" variant="primary" block loading={busy}>Sign in</Button>
        <p className="faint small" style={{ marginTop: 14, textAlign: 'center' }}>Forgotten your password? Ask an admin for a reset.</p>
      </form>
    </div>
  );
}
