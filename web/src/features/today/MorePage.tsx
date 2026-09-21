import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import { Icon, PageHead, Panel, type IconName } from '@/ui';

export function MorePage() {
  const { user, bu, can, logout } = useAuth();
  const nav = useNavigate();
  const items: { to: string; label: string; icon: IconName; show: boolean; hint?: string }[] = [
    { to: '/stock/receive', label: 'Receive stock', icon: 'truck', show: can('stock.receive') },
    { to: '/stock/move', label: 'Wastage, adjustment, transfer', icon: 'swap', show: can('stock.wastage') },
    { to: '/stock/movements', label: 'Movement ledger', icon: 'log', show: !!bu },
    { to: '/instruments', label: 'Instruments', icon: 'instrument', show: !!bu && can('bu.instruments') },
    { to: '/items', label: 'Tracked items', icon: 'list', show: !!bu && can('bu.items') },
    { to: '/snapshots', label: 'Weekly and monthly periods', icon: 'clock', show: !!bu },
    { to: '/reports', label: 'Reports', icon: 'chart', show: can('reports'), hint: 'super admin' },
    { to: '/catalogue', label: 'Catalogue', icon: 'box', show: can('catalogue') },
    { to: '/admin/bus', label: 'Business units', icon: 'building', show: can('bus') },
    { to: '/admin/users', label: 'Users', icon: 'users', show: can('users') },
    { to: '/admin/keys', label: 'API keys', icon: 'key', show: can('api_keys') },
    { to: '/admin/audit', label: 'Audit log', icon: 'log', show: can('audit') },
    { to: '/settings', label: 'Settings', icon: 'settings', show: true },
  ];
  return (
    <>
      <PageHead title="More" sub={`${user?.full_name} · ${user?.role.replace('_', ' ')}`} />
      <Panel>
        {items.filter(i => i.show).map(i => (
          <Link key={i.to} to={i.to} className="alert-row" style={{ color: 'inherit' }}><Icon name={i.icon} size={20} style={{ color: 'var(--ink-2)' }} /><span className="grow">{i.label}</span>{i.hint && <span className="small faint">{i.hint}</span>}<Icon name="chevronRight" size={16} style={{ color: 'var(--ink-3)' }} /></Link>
        ))}
        <button className="alert-row" style={{ width: '100%', background: 'none', border: 0, color: 'var(--danger)', textAlign: 'left' }} onClick={() => logout().then(() => nav('/login'))}><Icon name="logout" size={20} /><span className="grow">Sign out</span></button>
      </Panel>
    </>
  );
}
