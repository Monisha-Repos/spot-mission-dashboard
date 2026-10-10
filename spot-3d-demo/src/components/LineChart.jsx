import React from 'react';

const W = 1000, H = 260, PAD = { l: 44, r: 16, t: 16, b: 28 };

/** Minimal SVG line chart. series: [{ name, tone, values: (number|null)[] }], labels: string[] (x axis). */
export default function LineChart({ series, labels, format = v => v, title }) {
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
  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}>
        {ticks.map(t => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} className="chart-grid" />
            <text x={PAD.l - 6} y={y(t) + 3} textAnchor="end" className="chart-tick">{format(Math.round(t * 10) / 10)}</text>
          </g>
        ))}
        {labels.map((l, i) => i % every === 0 && <text key={i} x={x(i)} y={H - 8} textAnchor="middle" className="chart-tick">{l}</text>)}
        {series.map(s => {
          const pts = s.values.map((v, i) => (v === null || v === undefined ? null : [x(i), y(v)]));
          const d = pts.reduce((acc, p, i) => (p ? acc + `${acc && pts[i - 1] ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}` : acc), '');
          return (
            <g key={s.name} className={`chart-series tone-${s.tone}`}>
              <path d={d} />
              {pts.map((p, i) => p && <circle key={i} cx={p[0]} cy={p[1]} r="3"><title>{`${s.name} · ${labels[i]}: ${format(s.values[i])}`}</title></circle>)}
            </g>
          );
        })}
      </svg>
      <figcaption className="chart-legend">
        {series.map(s => <span key={s.name} className={`tone-${s.tone}`}><i aria-hidden="true" />{s.name}</span>)}
      </figcaption>
    </figure>
  );
}
