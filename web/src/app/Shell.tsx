import { useEffect, useRef, useState } from 'react';
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import { useAlerts } from '@/api/hooks';
import { Icon, type IconName } from '@/ui';
import { AppLockup, InfinityMark, NobleLogo } from '@/ui/Brand';

interface Nav { to: string; label: string; icon: IconName; show: boolean }

export function Shell() {
  const { session, user, bus, bu, setBu, can, isRole, logout } = useAuth();
  const loc = useLocation();
  const nav = useNavigate();
  const [menu, setMenu] = useState<null | 'bu' | 'user'>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const alerts = useAlerts(bu?.id ?? '');
  const alertCount = alerts.data ? alerts.data.low_stock.length + alerts.data.expiring_lots.length + alerts.data.missed_counts.length : 0;

  useEffect(() => {
    const h = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(null); };
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h);
  }, []);
  useEffect(() => { setMenu(null); }, [loc.pathname]);

  if (!session || !user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  const global = isRole('super_admin', 'admin');
  if (!bu && !global) return <NoBu onLogout={logout} />;

  const primary: Nav[] = [
    { to: '/today', label: 'Today', icon: 'today', show: !!bu },
    { to: '/counts', label: 'Counts', icon: 'count', show: !!bu },
    { to: '/stock', label: 'Stock', icon: 'stock', show: !!bu },
    { to: '/alerts', label: 'Alerts', icon: 'alert', show: !!bu },
  ];
  const manage: Nav[] = [
    { to: '/instruments', label: 'Instruments', icon: 'instrument', show: !!bu && can('bu.instruments') },
    { to: '/items', label: 'Tracked items', icon: 'list', show: !!bu && can('bu.items') },
    { to: '/snapshots', label: 'Periods', icon: 'clock', show: !!bu },
  ];
  const admin: Nav[] = [
    { to: '/reports', label: 'Reports', icon: 'chart', show: can('reports') },
    { to: '/catalogue', label: 'Catalogue', icon: 'box', show: can('catalogue') },
    { to: '/admin/bus', label: 'Business units', icon: 'building', show: can('bus') },
    { to: '/admin/users', label: 'Users', icon: 'users', show: can('users') },
    { to: '/admin/keys', label: 'API keys', icon: 'key', show: can('api_keys') },
    { to: '/admin/audit', label: 'Audit log', icon: 'log', show: can('audit') },
  ];
  const link = (n: Nav) => <NavLink key={n.to} to={n.to} className={({ isActive }) => `navlink ${isActive ? 'active' : ''}`}><Icon name={n.icon} />{n.label}</NavLink>;
  const moreActive = !primary.some(p => loc.pathname.startsWith(p.to));

  const buSwitch = bus.length > 0 && (
    <div style={{ position: 'relative' }}>
      <button className="bu-switch" onClick={() => setMenu(menu === 'bu' ? null : 'bu')} aria-haspopup="menu" aria-expanded={menu === 'bu'}>
        <span className="truncate">{bu?.name ?? 'Select unit'}</span>{bu && <span className="code">{bu.code}</span>}<Icon name="chevronDown" size={14} />
      </button>
      {menu === 'bu' && (
        <div className="menu" role="menu" ref={menuRef}>
          {bus.map(b => <button key={b.id} role="menuitem" onClick={() => { setBu(b.id); setMenu(null); }}><Icon name={b.id === bu?.id ? 'check' : 'building'} size={16} /><span className="grow truncate">{b.name}</span><span className="code small muted">{b.code}</span></button>)}
        </div>
      )}
    </div>
  );

  return (
    <div className="shell">
      <aside className="rail hide-mobile">
        <div className="brandhead">
          <AppLockup />
          {buSwitch}
        </div>
        <div className="group">Daily</div>
        {primary.filter(n => n.show).map(link)}
        {manage.some(n => n.show) && <><div className="group">Unit</div>{manage.filter(n => n.show).map(link)}</>}
        {admin.some(n => n.show) && <><div className="group">Organisation</div>{admin.filter(n => n.show).map(link)}</>}
        <div className="spacer" />
        <NavLink to="/settings" className={({ isActive }) => `navlink ${isActive ? 'active' : ''}`}><Icon name="settings" />{user.full_name}</NavLink>
        <button className="navlink" onClick={() => logout().then(() => nav('/login'))}><Icon name="logout" />Sign out</button>
        <div className="noble-foot">
          <NobleLogo height={26} />
          <small>Noble stock · run on Infinity</small>
        </div>
      </aside>
      <div className="content">
        <header className="topbar hide-desktop">
          <InfinityMark height={22} />
          <div className="grow">{buSwitch}</div>
          <NobleLogo height={20} />
          <NavLink to="/settings" aria-label="Settings" className="btn ghost icon"><Icon name="settings" /></NavLink>
        </header>
        <main className="main"><Outlet /></main>
        <nav className="tabbar hide-desktop" aria-label="Primary">
          {primary.filter(n => n.show).map(n => (
            <NavLink key={n.to} to={n.to} className={({ isActive }) => (isActive ? 'active' : '')}>
              <Icon name={n.icon} size={22} />{n.label}
              {n.to === '/alerts' && alertCount > 0 && <span className="badge">{alertCount}</span>}
            </NavLink>
          ))}
          <NavLink to="/more" className={moreActive ? 'active' : ''}><Icon name="more" size={22} />More</NavLink>
        </nav>
      </div>
    </div>
  );
}

function NoBu({ onLogout }: { onLogout: () => Promise<void> }) {
  const nav = useNavigate();
  return (
    <div className="login"><div className="card">
      <h1>No business unit yet</h1>
      <p className="muted" style={{ margin: '8px 0 16px' }}>Your account is not a member of any business unit. Ask your manager to add you, then sign in again.</p>
      <button className="btn primary block" onClick={() => onLogout().then(() => nav('/login'))}>Sign out</button>
    </div></div>
  );
}
