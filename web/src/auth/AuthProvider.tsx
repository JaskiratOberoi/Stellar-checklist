import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { auth } from '@/api/client';
import type { BuSummary, Session, User } from '@/api/types';

interface AuthCtx {
  session: Session | null;
  user: User | null;
  bus: BuSummary[];
  bu: BuSummary | null;
  setBu: (id: string) => void;
  can: (capability: string) => boolean;
  isRole: (...roles: string[]) => boolean;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);
const BU_KEY = 'sms.bu';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(auth.session);
  const [buId, setBuId] = useState<string | null>(() => { try { return localStorage.getItem(BU_KEY); } catch { return null; } });

  useEffect(() => auth.subscribe(setSession), []);

  const bus = session?.business_units ?? [];
  const bu = useMemo(() => bus.find(b => b.id === buId) ?? bus.find(b => b.is_default) ?? bus[0] ?? null, [bus, buId]);
  const setBu = useCallback((id: string) => { setBuId(id); try { localStorage.setItem(BU_KEY, id); } catch { /* ignore */ } }, []);
  const can = useCallback((c: string) => session?.user.capabilities.includes(c) ?? false, [session]);
  const isRole = useCallback((...roles: string[]) => !!session && roles.includes(session.user.role), [session]);
  const logout = useCallback(async () => { await auth.logout(); }, []);

  const value = useMemo<AuthCtx>(() => ({ session, user: session?.user ?? null, bus, bu, setBu, can, isRole, logout }), [session, bus, bu, setBu, can, isRole, logout]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}

/** The selected BU id, guaranteed non-empty inside the shell (Shell redirects otherwise). */
export function useBuId(): string { return useAuth().bu?.id ?? ''; }
