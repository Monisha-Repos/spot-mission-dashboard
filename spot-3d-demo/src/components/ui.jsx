import React, { useLayoutEffect, useRef, useState } from 'react';
import { API_URL } from '../api.js';
import { batteryLevel, num } from '../lib/format.js';

export function Section({ eyebrow, title, actions, children, className = '', id }) {
  return (
    <section className={`section ${className}`} id={id} aria-labelledby={id ? `${id}-title` : undefined}>
      {(eyebrow || title || actions) && (
        <header className="section-head">
          <div>
            {eyebrow && <p className="eyebrow">{eyebrow}</p>}
            {title && <h2 id={id ? `${id}-title` : undefined}>{title}</h2>}
          </div>
          {actions && <div className="section-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, sub, tone }) {
  return (
    <div className={`stat${tone ? ` tone-${tone}` : ''}`}>
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
      {sub && <span className="stat-sub">{sub}</span>}
    </div>
  );
}

/** <img> that fades in once loaded. Cached images show straight away; a failed load still reveals the alt text. */
export function FadeImg({ src, alt, className = '', ...rest }) {
  const ref = useRef(null);
  const [loaded, setLoaded] = useState(false);
  useLayoutEffect(() => {
    const img = ref.current;
    setLoaded(Boolean(img && img.complete && img.naturalWidth > 0));
  }, [src]);
  const show = () => setLoaded(true);
  return (
    <img
      ref={ref}
      src={src}
      alt={alt}
      className={`fade-img${loaded ? ' is-loaded' : ''}${className ? ` ${className}` : ''}`}
      onLoad={show}
      onError={show}
      {...rest}
    />
  );
}

/** Battery outline filled to `pct`. Decorative: pair it with the number as text. */
export function BatteryIcon({ pct }) {
  const fill = Math.max(0, Math.min(100, Number(pct) || 0));
  return (
    <svg className="batt-icon" viewBox="0 0 26 14" aria-hidden="true" focusable="false">
      <rect className="batt-shell" x="0.75" y="0.75" width="21.5" height="12.5" />
      <rect className="batt-cap" x="23" y="4.5" width="2.5" height="5" />
      {fill > 0 && <rect className="batt-fill" x="2.5" y="2.5" width={(18 * fill) / 100} height="9" />}
    </svg>
  );
}

/** Battery icon + percentage, coloured by level (red ≤30%, yellow ≤60%, green above). */
export function Battery({ pct, digits = 1 }) {
  const level = batteryLevel(pct);
  return (
    <span className={`batt batt-${level}`}>
      <BatteryIcon pct={pct} />
      <span className="batt-value">{level === 'none' ? '—' : `${num(pct, digits)}%`}</span>
    </span>
  );
}

export function Badge({ tone = 'muted', children }) {
  return <span className={`badge tone-${tone}`}>{children}</span>;
}

export function Segmented({ label, options, value, onChange }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map(o => {
        const [v, text] = Array.isArray(o) ? o : [o, o];
        return (
          <button key={v} type="button" aria-pressed={value === v} className={value === v ? 'is-on' : ''} onClick={() => onChange(v)}>
            {text}
          </button>
        );
      })}
    </div>
  );
}

/** Loading / error / empty states for a useApi() result. */
export function Async({ state, children, empty = 'Nothing to show yet.' }) {
  if (state.error && !state.data) {
    return (
      <div className="note note-error" role="alert">
        <strong>Couldn’t load this.</strong> {state.error.message}
        {state.error.status === 0 && <> Start it with <code>uvicorn app.main:create_app --factory --port 8000</code> in <code>backend/</code>, or set <code>VITE_API_URL</code> (now {API_URL}).</>}
        {state.reload && <button type="button" className="btn btn-ghost btn-sm" onClick={state.reload}>Retry</button>}
      </div>
    );
  }
  if (!state.data) return <div className="skeleton" aria-busy="true" aria-label="Loading" />;
  if (Array.isArray(state.data) && !state.data.length) return <p className="muted">{empty}</p>;
  return children(state.data);
}

/** Horizontal bars for a {label: count} map. */
export function Bars({ data, format = v => v, max, tone }) {
  const entries = Object.entries(data || {});
  if (!entries.length) return <p className="muted">None recorded.</p>;
  const top = max ?? Math.max(...entries.map(([, v]) => v), 1);
  return (
    <ul className="bars">
      {entries.map(([k, v]) => (
        <li key={k}>
          <span className="bars-label">{k.replace(/_/g, ' ').toLowerCase()}</span>
          <span className="bars-track"><span className={`bars-fill${tone ? ` tone-${tone}` : ''}`} style={{ width: `${Math.max(2, (v / top) * 100)}%` }} /></span>
          <span className="bars-value">{format(v)}</span>
        </li>
      ))}
    </ul>
  );
}

export function Field({ label, children, hint }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}
