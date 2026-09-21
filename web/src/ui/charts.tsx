import { useMemo, useRef, useState } from 'react';
import { fmtDate, fmtQty } from './index';

/**
 * Two small SVG charts, single series each (so no legend), text in ink tokens,
 * marks in the one chart hue. Hover layer: per-bar tooltip and line crosshair.
 */

export function BarList({ rows, unit, max = 12 }: { rows: { label: string; sub?: string | null; value: number; unit?: string | null }[]; unit?: string; max?: number }) {
  const top = rows.slice(0, max);
  const peak = Math.max(1, ...top.map(r => r.value));
  if (top.length === 0) return <p className="muted small">No data in this range.</p>;
  return (
    <div className="stack" style={{ gap: 8 }} role="list">
      {top.map((r, i) => (
        <div key={i} role="listitem" style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 34%) 1fr auto', gap: 10, alignItems: 'center' }}>
          <div className="truncate" title={r.label}><div className="truncate">{r.label}</div>{r.sub && <div className="small muted truncate">{r.sub}</div>}</div>
          <svg className="chart" height={20} viewBox="0 0 100 20" preserveAspectRatio="none" aria-hidden="true">
            <rect x={0} y={2} width={Math.max(0.5, (r.value / peak) * 100)} height={16} className="bar" rx={0} style={{ clipPath: 'inset(0 round 0 4px 4px 0)' }} />
          </svg>
          <div className="mono tnum small right nowrap">{fmtQty(r.value)} <span className="muted" style={{ fontFamily: 'var(--font)' }}>{r.unit ?? unit ?? ''}</span></div>
        </div>
      ))}
      {rows.length > max && <p className="small faint">and {rows.length - max} more</p>}
    </div>
  );
}

export function LineChart({ points, label, height = 200 }: { points: { x: string; y: number }[]; label: string; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const W = 720, H = height, padL = 44, padR = 12, padT = 12, padB = 26;
  const { path, area, xs, ys, ticks, maxY } = useMemo(() => {
    const n = points.length;
    const maxRaw = Math.max(1, ...points.map(p => p.y));
    const mag = Math.pow(10, Math.floor(Math.log10(maxRaw)));
    const maxY = Math.ceil(maxRaw / mag) * mag;
    const xs = points.map((_, i) => padL + (n === 1 ? (W - padL - padR) / 2 : (i * (W - padL - padR)) / (n - 1)));
    const ys = points.map(p => padT + (H - padT - padB) * (1 - p.y / maxY));
    const path = xs.map((x, i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(' ');
    const area = n > 1 ? `${path} L${xs[n - 1].toFixed(1)},${H - padB} L${xs[0].toFixed(1)},${H - padB} Z` : '';
    const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => ({ v: maxY * f, y: padT + (H - padT - padB) * (1 - f) }));
    return { path, area, xs, ys, ticks, maxY };
  }, [points, H]);
  if (points.length === 0) return <p className="muted small">No data in this range.</p>;

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0; for (let i = 1; i < xs.length; i++) if (Math.abs(xs[i] - x) < Math.abs(xs[best] - x)) best = i;
    setHover(best);
  }
  const labelEvery = Math.max(1, Math.ceil(points.length / 8));
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} onMouseMove={onMove} onMouseLeave={() => setHover(null)} style={{ display: 'block', width: '100%', height: 'auto' }}>
        <g className="grid">{ticks.map(t => <line key={t.v} x1={padL} x2={W - padR} y1={t.y} y2={t.y} />)}</g>
        <g className="axis"><line x1={padL} x2={W - padR} y1={H - padB} y2={H - padB} /></g>
        {ticks.map(t => <text key={t.v} x={padL - 6} y={t.y + 4} textAnchor="end">{fmtQty(t.v)}</text>)}
        {points.map((p, i) => i % labelEvery === 0 && <text key={p.x} x={xs[i]} y={H - 8} textAnchor="middle">{fmtDate(p.x)}</text>)}
        {area && <path d={area} className="area" />}
        <path d={path} className="line" />
        {points.length <= 40 && points.map((p, i) => <circle key={p.x} cx={xs[i]} cy={ys[i]} r={4} className="dot" />)}
        {hover !== null && <><line className="crosshair" x1={xs[hover]} x2={xs[hover]} y1={padT} y2={H - padB} /><circle cx={xs[hover]} cy={ys[hover]} r={5} className="dot" /></>}
        <rect x={padL} y={padT} width={W - padL - padR} height={H - padT - padB} className="hit" />
      </svg>
      {hover !== null && <div className="tooltip" style={{ left: `${(xs[hover] / W) * 100}%`, top: `${(ys[hover] / H) * 100}%` }}>{fmtDate(points[hover].x, { weekday: 'short', day: 'numeric', month: 'short' })} · <b>{fmtQty(points[hover].y)}</b></div>}
      <span className="sr-only">Max {fmtQty(maxY)}</span>
    </div>
  );
}
