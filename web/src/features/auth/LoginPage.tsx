import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { auth, errorMessage } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { Button, Field, Input } from '@/ui';
import { InfinityMark, NobleLogo } from '@/ui/Brand';

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
      <div className="wrap">
        <NobleLogo height={54} />
        <form className="card" onSubmit={submit}>
          <div className="brand">
            <InfinityMark height={34} />
            <h1>Stock Management System</h1>
            <span className="by">part of <b>Infinity</b></span>
          </div>
          <Field label="Email"><Input type="email" autoComplete="username" inputMode="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus /></Field>
          <Field label="Password" error={error}><Input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required /></Field>
          <Button type="submit" variant="primary" block loading={busy}>Sign in</Button>
        </form>
        <p className="foot">Reagents and materials for every Noble business unit. Forgotten your password? Ask an admin for a reset.</p>
      </div>
    </div>
  );
}
