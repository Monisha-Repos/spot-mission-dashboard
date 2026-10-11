import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
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

/**
 * A headline number. With onClick it becomes a shortcut (e.g. "Open issues" → the queue),
 * shown with a small arrow; `action` is the screen-reader description of where it goes.
 */
export function Stat({ label, value, sub, tone, hint, onClick, action }) {
  const cls = `stat${tone ? ` tone-${tone}` : ''}${onClick ? ' stat-link' : ''}`;
  const body = (
    <>
      <span className="stat-label">{label}{hint && <Hint text={hint} />}{onClick && <span className="stat-go" aria-hidden="true">→</span>}</span>
      <strong className="stat-value">{value}</strong>
      {sub && <span className="stat-sub">{sub}</span>}
      {onClick && action && <span className="sr-only">. {action}</span>}
    </>
  );
  return onClick
    ? <button type="button" className={cls} onClick={onClick}>{body}</button>
    : <div className={cls}>{body}</div>;
}

/**
 * Small "?" with a plain-language explanation on hover or focus. The tip is position: fixed so
 * scrolling tables don't clip it; Escape dismisses it.
 */
export function Hint({ text, label = 'What does this mean?' }) {
  const id = useId();
  const btn = useRef(null);
  const [pos, setPos] = useState(null);
  const show = () => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const left = Math.min(Math.max(12, r.left + r.width / 2 - 140), window.innerWidth - 292);
    const below = r.bottom + 120 < window.innerHeight;
    setPos({ left, top: below ? r.bottom + 8 : undefined, bottom: below ? undefined : window.innerHeight - r.top + 8 });
  };
  const hide = () => setPos(null);
  useEffect(() => {
    if (!pos) return undefined;
    window.addEventListener('scroll', hide, true);
    return () => window.removeEventListener('scroll', hide, true);
  }, [pos]);
  return (
    <span className="hint" onMouseEnter={show} onMouseLeave={hide}>
      <button
        ref={btn}
        type="button"
        className="hint-btn"
        aria-label={label}
        aria-describedby={id}
        onFocus={show}
        onBlur={hide}
        onClick={e => { e.stopPropagation(); pos ? hide() : show(); }}
        onKeyDown={e => { if (e.key === 'Escape' && pos) { e.stopPropagation(); hide(); } }}
      >?</button>
      <span role="tooltip" id={id} className={`hint-tip${pos ? ' is-on' : ''}`} style={pos || undefined}>{text}</span>
    </span>
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

/** A thumbnail that opens the full, uncropped image in a viewer. Escape or ✕ closes it and focus returns to the thumbnail. */
export function ZoomImg({ src, alt, ...rest }) {
  const dialog = useRef(null);
  const opener = useRef(null);
  const [open, setOpen] = useState(false);
  useEffect(() => { if (open && dialog.current && !dialog.current.open) dialog.current.showModal(); }, [open]);
  const close = () => dialog.current?.close();
  return (
    <>
      <button type="button" ref={opener} className="zoom-btn" onClick={() => setOpen(true)} aria-label={`Enlarge image: ${alt}`}>
        <FadeImg src={src} alt={alt} {...rest} />
        <span className="zoom-cue" aria-hidden="true">⤢</span>
      </button>
      {open && (
        <dialog
          ref={dialog}
          className="lightbox"
          aria-label={alt}
          onClose={() => { setOpen(false); opener.current?.focus(); }}
          onClick={e => { if (e.target === dialog.current) close(); }}
          // Parents (e.g. the live alarm) may swallow Escape; handle it here first.
          onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } }}
        >
          <figure className="lightbox-figure">
            <img src={src} alt={alt} />
            <figcaption>{alt}</figcaption>
          </figure>
          <button type="button" className="icon-btn lightbox-close" onClick={close} aria-label="Close image">✕</button>
        </dialog>
      )}
    </>
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

/** variant="status" is the quieter workflow-status look, so severity and danger keep the strong colour. */
export function Badge({ tone = 'muted', variant, children }) {
  return <span className={`badge tone-${tone}${variant ? ` badge-${variant}` : ''}`}>{children}</span>;
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

/** A specific empty state with an optional next step. */
export function Empty({ children, action }) {
  return (
    <div className="empty">
      <p className="muted">{children}</p>
      {action}
    </div>
  );
}

/**
 * Loading / error / empty states for a useApi() result.
 * refresh: also show a small "Updating…" cue while newer data loads, and flag kept data as possibly out of date if that fails.
 */
export function Async({ state, children, empty = 'Nothing to show yet.', refresh = false }) {
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
  if (Array.isArray(state.data) && !state.data.length) return typeof empty === 'string' ? <Empty>{empty}</Empty> : empty;
  if (!refresh) return children(state.data);
  return (
    <>
      {state.loading && <p className="refreshing" role="status">Updating…</p>}
      {state.error && (
        <p className="note note-warn" role="status">
          Couldn’t refresh. Showing earlier data, which may be out of date.
          {state.reload && <button type="button" className="btn btn-ghost btn-sm" onClick={state.reload}>Retry</button>}
        </p>
      )}
      {children(state.data)}
    </>
  );
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

/**
 * Floating "back to top" button, stacked just above the assistant button. Appears once the page is scrolled
 * about a screen down; returns to the top and moves focus to the start of the content for keyboard users.
 */
export function BackToTop() {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    let frame = 0;
    const check = () => { frame = 0; setShown(window.scrollY > window.innerHeight * 0.8); };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(check); };
    check();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => { window.removeEventListener('scroll', onScroll); cancelAnimationFrame(frame); };
  }, []);
  function toTop() {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
    document.getElementById('main')?.focus({ preventScroll: true });
  }
  return (
    <button
      type="button"
      className={`to-top${shown ? ' is-shown' : ''}`}
      onClick={toTop}
      aria-label="Back to the top of the page"
      title="Back to top"
      tabIndex={shown ? 0 : -1}
      aria-hidden={!shown}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
    </button>
  );
}

/** Brief success messages, bottom-left so they never cover the workspace or the assistant button. */
export function Toasts({ items }) {
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map(t => <p key={t.id} className="toast"><span aria-hidden="true">✓</span> {t.text}</p>)}
    </div>
  );
}
