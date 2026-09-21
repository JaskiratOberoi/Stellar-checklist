/**
 * Brand marks. Two identities stand together, never merged:
 *  - Infinity: the cyan→teal→blue double-helix figure-8 (same geometry as Stellar-Infinity's Mark.tsx).
 *    SMS is an Infinity product, so the app lockup is the helix + "SMS".
 *  - Noble Diagnostics: the lab's own navy roundel + wordmark (PNG artwork supplied by Noble;
 *    /branding/noble-logo-onlight.png and -ondark.png, provenance: Stellar-Infinity/branding).
 *    Shown beside Infinity with a divider: this is Noble's stock, run on Infinity's system.
 */
import { useId } from 'react';

export function InfinityMark({ height = 26, className = '' }: { height?: number; className?: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg className={`infinity-mark ${className}`} height={height} width={height * 2} viewBox="0 0 480 240" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <linearGradient id={`mk-${id}`} x1="0" y1="0" x2="480" y2="240" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#06b6d4" /><stop offset="50%" stopColor="#0d9488" /><stop offset="100%" stopColor="#2563eb" />
        </linearGradient>
      </defs>
      <path d="M96,92 L96,148 M132,78 L132,162 M168,92 L168,148 M312,92 L312,148 M348,78 L348,162 M384,92 L384,148" stroke="rgba(13,148,136,.28)" strokeWidth="7" strokeLinecap="round" />
      <path d="M60,120 C60,182 170,182 240,120 C310,58 420,58 420,120" stroke="rgba(13,148,136,.34)" strokeWidth="14" strokeLinecap="round" />
      <path d="M60,120 C60,58 170,58 240,120 C310,182 420,182 420,120" stroke={`url(#mk-${id})`} strokeWidth="14" strokeLinecap="round" />
    </svg>
  );
}

export function NobleLogo({ height = 26, className = '' }: { height?: number; className?: string }) {
  return (
    <picture className={`noble-logo ${className}`} title="Noble Diagnostics">
      <source srcSet="/branding/noble-logo-ondark.png" media="(prefers-color-scheme: dark)" />
      <img src="/branding/noble-logo-onlight.png" alt="Noble Diagnostics" style={{ height }} />
    </picture>
  );
}

/** Infinity helix + SMS wordmark. `sub` adds the long name underneath. */
export function AppLockup({ sub = true, size = 24 }: { sub?: boolean; size?: number }) {
  return (
    <span className="lockup">
      <InfinityMark height={size} />
      <span className="lockup__text">
        <b>SMS</b>
        {sub && <small>Stock Management · Infinity</small>}
      </span>
    </span>
  );
}

/** App lockup, divider, Noble mark: the pairing used in every bar. */
export function BrandBar({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brandbar ${compact ? 'compact' : ''}`}>
      <AppLockup sub={!compact} size={compact ? 20 : 24} />
      <NobleLogo height={compact ? 22 : 26} />
    </div>
  );
}
