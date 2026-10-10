import React from 'react';
import { API_URL } from '../api.js';

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
