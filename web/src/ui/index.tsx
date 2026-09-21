import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type ButtonHTMLAttributes, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from './Icon';

export { Icon };
export type { IconName };

// ---- buttons & fields -------------------------------------------------------
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'danger' | 'ghost' | 'default'; size?: 'sm' | 'md'; block?: boolean; icon?: IconName; loading?: boolean };
export function Button({ variant = 'default', size = 'md', block, icon, loading, className = '', children, disabled, ...rest }: BtnProps) {
  const cls = ['btn', variant !== 'default' ? variant : '', size === 'sm' ? 'sm' : '', block ? 'block' : '', !children && icon ? 'icon' : '', className].filter(Boolean).join(' ');
  return (
    <button className={cls} disabled={disabled || loading} {...rest}>
      {loading ? <Icon name="refresh" size={16} style={{ animation: 'spin 900ms linear infinite' }} /> : icon ? <Icon name={icon} size={size === 'sm' ? 15 : 18} /> : null}
      {children}
    </button>
  );
}

export function Field({ label, hint, error, children, className = '' }: { label?: string; hint?: string; error?: string | null; children: ReactNode; className?: string }) {
  return (
    <div className={`field ${className}`}>
      {label && <label>{label}</label>}
      {children}
      {error ? <span className="error">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}
export function Input({ className = '', ...rest }: InputHTMLAttributes<HTMLInputElement>) { return <input className={`input ${className}`} {...rest} />; }
export function Select({ className = '', ...rest }: SelectHTMLAttributes<HTMLSelectElement>) { return <select className={`select ${className}`} {...rest} />; }
export function Textarea({ className = '', ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) { return <textarea className={`textarea ${className}`} {...rest} />; }

// ---- status chip --------------------------------------------------------------
export type Tone = 'ok' | 'warn' | 'danger' | 'brand' | 'neutral';
const toneIcon: Record<Tone, IconName> = { ok: 'check', warn: 'alert', danger: 'x', brand: 'info', neutral: 'clock' };
export function Chip({ tone = 'neutral', icon, children }: { tone?: Tone; icon?: IconName | null; children: ReactNode }) {
  const name = icon === null ? null : icon ?? toneIcon[tone];
  return <span className={`chip ${tone === 'neutral' ? '' : tone}`}>{name && <Icon name={name} size={14} />}{children}</span>;
}

// ---- layout helpers -------------------------------------------------------------
export function PageHead({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div><h1>{title}</h1>{sub && <p className="sub">{sub}</p>}</div>
      {actions && <div className="row wrap">{actions}</div>}
    </div>
  );
}
export function Panel({ title, actions, children, pad, className = '' }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; pad?: boolean; className?: string }) {
  return (
    <section className={`panel ${className}`}>
      {(title || actions) && <div className="panel-head"><h2>{title}</h2>{actions && <div className="row">{actions}</div>}</div>}
      <div className={pad ? 'panel-pad' : ''}>{children}</div>
    </section>
  );
}
export function Empty({ title, children, icon = 'inbox' }: { title: string; children?: ReactNode; icon?: IconName }) {
  return <div className="empty"><Icon name={icon} size={28} style={{ color: 'var(--ink-3)', marginBottom: 8 }} /><h3>{title}</h3>{children && <p>{children}</p>}</div>;
}
export function Skeleton({ rows = 3 }: { rows?: number }) {
  return <div className="stack">{Array.from({ length: rows }).map((_, i) => <div key={i} className="skeleton" style={{ height: 44, opacity: 1 - i * 0.18 }} />)}</div>;
}
export function PillTabs<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return <div className="pill-tabs" role="tablist">{options.map(o => <button key={o.value} role="tab" aria-selected={o.value === value} className={o.value === value ? 'active' : ''} onClick={() => onChange(o.value)}>{o.label}</button>)}</div>;
}

// ---- sheet / drawer -------------------------------------------------------------
function Overlay({ onClose, children, className, label }: { onClose: () => void; children: ReactNode; className: string; label: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);
  return createPortal(
    <>
      <div className="overlay" onClick={onClose} />
      <div className={className} role="dialog" aria-modal="true" aria-label={label}>{children}</div>
    </>, document.body);
}
export function Sheet({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  if (!open) return null;
  return (
    <Overlay onClose={onClose} className={`sheet ${wide ? 'wide' : ''}`} label={title}>
      <div className="sheet-title"><h2>{title}</h2><Button variant="ghost" icon="x" aria-label="Close" onClick={onClose} /></div>
      {children}
    </Overlay>
  );
}
export function Drawer({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode }) {
  if (!open) return null;
  return (
    <Overlay onClose={onClose} className="drawer" label={typeof title === 'string' ? title : 'Details'}>
      <div className="sheet-title"><h2>{title}</h2><Button variant="ghost" icon="x" aria-label="Close" onClick={onClose} /></div>
      {children}
    </Overlay>
  );
}
export function Confirm({ open, onClose, onConfirm, title, body, confirmLabel = 'Confirm', danger, loading, children }: { open: boolean; onClose: () => void; onConfirm: () => void; title: string; body?: ReactNode; confirmLabel?: string; danger?: boolean; loading?: boolean; children?: ReactNode }) {
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      {body && <p className="muted" style={{ marginBottom: 12 }}>{body}</p>}
      {children}
      <div className="form-actions"><Button onClick={onClose}>Cancel</Button><Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>{confirmLabel}</Button></div>
    </Sheet>
  );
}

// ---- toasts ----------------------------------------------------------------
interface Toast { id: number; text: string; tone?: 'ok' | 'error' }
const ToastCtx = createContext<(text: string, tone?: 'ok' | 'error') => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const n = useRef(0);
  const push = useCallback((text: string, tone?: 'ok' | 'error') => {
    const id = ++n.current;
    setToasts(t => [...t, { id, text, tone }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), tone === 'error' ? 5000 : 2800);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      {toasts.length > 0 && createPortal(<div className="toasts" aria-live="polite">{toasts.map(t => <div key={t.id} className={`toast ${t.tone ?? ''}`}>{t.tone === 'ok' ? <Icon name="check" size={16} /> : t.tone === 'error' ? <Icon name="alert" size={16} /> : null}{t.text}</div>)}</div>, document.body)}
    </ToastCtx.Provider>
  );
}
export function useToast() { return useContext(ToastCtx); }

// ---- formatting ----------------------------------------------------------------
export function fmtQty(n: number | null | undefined, digits = 0) {
  if (n === null || n === undefined) return '—';
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: Math.abs(n) < 10 && n % 1 !== 0 ? 3 : digits }).format(n);
}
export function fmtDate(d: string | null | undefined, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }) {
  if (!d) return '—';
  const dt = d.length === 10 ? new Date(d + 'T00:00:00') : new Date(d);
  return new Intl.DateTimeFormat('en-IN', opts).format(dt);
}
export function fmtDateTime(d: string | null | undefined) { return fmtDate(d, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
export function fmtTime(t: string) { return t.slice(0, 5); }
export function packs(qty: number, packSize: number) {
  if (!packSize || packSize <= 1) return null;
  const p = Math.floor(qty / packSize); const loose = +(qty - p * packSize).toFixed(3);
  return { p, loose };
}
export function plural(unit: string, n: number) {
  if (n === 1) return unit;
  if (/(s|x|z|ch|sh)$/i.test(unit)) return unit + 'es';
  if (/[^aeiou]y$/i.test(unit)) return unit.slice(0, -1) + 'ies';
  return unit + 's';
}
export function todayIso() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
export function addDays(iso: string, n: number) { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }
export const kindLabel: Record<string, string> = { reagent: 'Reagent', calibrator: 'Calibrator', control: 'Control', consumable: 'Consumable', material: 'Material' };
export const movementLabel: Record<string, string> = { receipt: 'Receipt', wastage: 'Wastage', transfer_out: 'Transfer out', transfer_in: 'Transfer in', adjustment: 'Adjustment', return_to_supplier: 'Return to supplier', expiry_writeoff: 'Expiry write-off' };
export function useDebounced<T>(value: T, ms = 250) { const [v, setV] = useState(value); useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]); return v; }
export function useMediaQuery(q: string) { const [m, setM] = useState(() => window.matchMedia(q).matches); useEffect(() => { const mq = window.matchMedia(q); const h = () => setM(mq.matches); mq.addEventListener('change', h); return () => mq.removeEventListener('change', h); }, [q]); return m; }
