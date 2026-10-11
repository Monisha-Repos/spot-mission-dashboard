import React, { useState } from 'react';

const W = 1000, H = 260, PAD = { l: 44, r: 16, t: 16, b: 28 };
// Each series gets its own line style and marker so they stay distinguishable without colour.
const STYLES = [
  { dash: undefined, marker: 'circle' },
  { dash: '10 6', marker: 'square' },
  { dash: '2 5', marker: 'diamond' },
];

function Marker({ shape, x, y, size = 4 }) {
  if (shape === 'square') return <rect x={x - size} y={y - size} width={size * 2} height={size * 2} />;
  if (shape === 'diamond') return <path d={`M${x} ${y - size - 1}L${x + size + 1} ${y}L${x} ${y + size + 1}L${x - size - 1} ${y}Z`} />;
  return <circle cx={x} cy={y} r={size - 0.5} />;
}

/**
 * Minimal SVG line chart. series: [{ name, tone, values: (number|null)[] }], labels: string[] (x axis),
 * details: optional [{ name, date }] per x position, shown in the point tooltip.
 */
export default function LineChart({ series, labels, details = [], format = v => v, title }) {
  const [tip, setTip] = useState(null);
  const all = series.flatMap(s => s.values).filter(v => v !== null && v !== undefined);
  if (!all.length) return <p className="muted">No values yet.</p>;
  let lo = Math.min(...all), hi = Math.max(...all);
  if (lo === hi) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.1;
  lo -= pad; hi += pad;
  const n = labels.length;
  const x = i => PAD.l + (n === 1 ? (W - PAD.l - PAD.r) / 2 : (i / (n - 1)) * (W - PAD.l - PAD.r));
  const y = v => PAD.t + (1 - (v - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
  const ticks = [lo + pad, (lo + hi) / 2, hi - pad];
  const every = Math.max(1, Math.ceil(n / 6));
  const describe = (s, i) => {
    const d = details[i];
    return `${d?.name || labels[i]}${d?.date ? ` · ${d.date}` : ''} · ${s.name}: ${format(s.values[i])}`;
  };

  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="group" aria-label={title} onMouseLeave={() => setTip(null)}>
        {ticks.map(t => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} className="chart-grid" />
            <text x={PAD.l - 6} y={y(t) + 3} textAnchor="end" className="chart-tick">{format(Math.round(t * 10) / 10)}</text>
          </g>
        ))}
        {labels.map((l, i) => i % every === 0 && <text key={i} x={x(i)} y={H - 8} textAnchor="middle" className="chart-tick">{l}</text>)}
        {series.map((s, si) => {
          const style = STYLES[si % STYLES.length];
          const pts = s.values.map((v, i) => (v === null || v === undefined ? null : [x(i), y(v)]));
          const d = pts.reduce((acc, p, i) => (p ? acc + `${acc && pts[i - 1] ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}` : acc), '');
          return (
            <g key={s.name} className={`chart-series tone-${s.tone}`}>
              <path d={d} strokeDasharray={style.dash} />
              {pts.map((p, i) => p && <Marker key={i} shape={style.marker} x={p[0]} y={p[1]} />)}
            </g>
          );
        })}
        {/* Large invisible targets on top, so points are easy to hover, tap or tab to. */}
        {series.map((s, si) => s.values.map((v, i) => (v === null || v === undefined ? null : (
          <circle
            key={`${si}-${i}`}
            className="chart-hit"
            cx={x(i)}
            cy={y(v)}
            r="16"
            tabIndex={0}
            role="img"
            aria-label={describe(s, i)}
            onMouseEnter={() => setTip({ si, i })}
            onFocus={() => setTip({ si, i })}
            onBlur={() => setTip(null)}
            onClick={() => setTip({ si, i })}
          />
        ))))}
      </svg>
      {tip && (() => {
        const s = series[tip.si];
        const d = details[tip.i];
        const left = (x(tip.i) / W) * 100;
        return (
          <div className={`chart-tip${left > 70 ? ' is-right' : ''}`} style={{ left: `${left}%`, top: `${(y(s.values[tip.i]) / H) * 100}%` }} aria-hidden="true">
            <strong>{d?.name || labels[tip.i]}</strong>
            {d?.date && <span className="muted">{d.date}</span>}
            <span className={`tone-${s.tone}`}>{s.name}: <b>{format(s.values[tip.i])}</b></span>
          </div>
        );
      })()}
      <figcaption className="chart-legend">
        {series.map((s, si) => {
          const style = STYLES[si % STYLES.length];
          return (
            <span key={s.name} className={`tone-${s.tone}`}>
              <svg className="chart-key" viewBox="0 0 28 10" aria-hidden="true">
                <line x1="1" y1="5" x2="27" y2="5" strokeDasharray={style.dash ? style.dash.split(' ').map(n => n / 2).join(' ') : undefined} />
                <Marker shape={style.marker} x={14} y={5} size={3} />
              </svg>
              {s.name}
            </span>
          );
        })}
      </figcaption>
    </figure>
  );
}
