import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api, useApp } from '../api.js';
import { titleCase } from '../lib/format.js';

const SUGGESTIONS = {
  simple: ['What needs attention right now?', 'Did the V2 changes help?', 'Why does WP05 fail?'],
  technical: ['Compare V1 and V2 action success with the p-value', 'Which waypoints have the highest navigation failure rate?', 'What is the model’s PR-AUC and how was it split?'],
};

function contextLabel(ctx) {
  const parts = [];
  if (ctx.mission) parts.push(`Run ${ctx.mission}`);
  if (ctx.part) parts.push(titleCase(ctx.part));
  if (ctx.waypoint) parts.push(ctx.waypoint);
  else if (ctx.floor) parts.push(`Floor ${ctx.floor}`);
  return parts.join(' · ');
}

/** Where a cited source can be opened in the dashboard, if anywhere. */
function citationTarget(c) {
  if (c.kind === 'mission') return { label: 'Open in Replay', tab: 'replay', opts: { mission: c.id } };
  if (c.kind === 'waypoint') return { label: 'Show on the map', tab: 'overview', opts: { waypoint: c.id, scrollTo: 'map' } };
  if (c.kind === 'Spot part') return { label: 'Show on the robot', tab: 'overview', opts: { part: c.id, scrollTo: 'main' } };
  return null;
}

function Citation({ c, onOpen }) {
  const target = citationTarget(c);
  return (
    <li>
      <details className="cite">
        <summary><code>{c.id}</code><span className="cite-title">{c.title}</span></summary>
        <div className="cite-body">
          <p><span className="muted">{titleCase(c.kind)}</span> · {c.title}</p>
          {target && <button type="button" className="btn btn-ghost btn-sm" onClick={() => onOpen(target)}>{target.label}</button>}
        </div>
      </details>
    </li>
  );
}

/** Bottom-right assistant shared by every tab. mode: simple (Overview) or technical (Data Analysis, Operator). */
export default function AskPanel({ mode, context }) {
  const { go } = useApp();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [unseen, setUnseen] = useState(false);
  const log = useRef(null);
  const input = useRef(null);
  const fab = useRef(null);
  const nearBottom = useRef(true);

  // Follow new messages only if the reader is already at the bottom; otherwise offer a "New response" jump.
  useLayoutEffect(() => {
    const el = log.current;
    if (!el) return;
    const last = messages[messages.length - 1];
    if (nearBottom.current || last?.role === 'user') { el.scrollTo(0, el.scrollHeight); setUnseen(false); }
    else if (last?.role === 'ai') setUnseen(true);
  }, [messages, busy]);
  useEffect(() => { if (open) input.current?.focus(); }, [open]);

  function onScroll() {
    const el = log.current;
    nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    if (nearBottom.current) setUnseen(false);
  }
  function close() {
    setOpen(false);
    fab.current?.focus();
  }

  async function ask(q) {
    const text = q.trim();
    if (!text || busy) return;
    setQuestion('');
    setMessages(m => [...m, { role: 'user', text }]);
    setBusy(true);
    const ctx = Object.fromEntries(Object.entries(context || {}).filter(([, v]) => v !== undefined && v !== null && v !== ''));
    try {
      const res = await api('/ask', { method: 'POST', body: { question: text, mode, context: Object.keys(ctx).length ? ctx : null } });
      setMessages(m => [...m, { role: 'ai', text: res.answer, citations: res.citations || [], provider: res.provider }]);
    } catch (e) {
      setMessages(m => [...m, { role: 'ai', text: e.message, error: true, question: text }]);
    } finally {
      setBusy(false);
    }
  }

  const where = contextLabel(context || {});
  return (
    <div className={`ask${open ? ' is-open' : ''}`}>
      {open && (
        <section className="ask-panel" role="dialog" aria-label="AI assistant" onKeyDown={e => { if (e.key === 'Escape') close(); }}>
          <header className="ask-head">
            <div>
              <p className="eyebrow">AI assistant · {mode === 'technical' ? 'technical' : 'plain language'}</p>
              {where && <p className="ask-context">Looking at: {where}</p>}
            </div>
            <button type="button" className="icon-btn" onClick={close} aria-label="Close assistant">✕</button>
          </header>
          <div className="ask-log" ref={log} aria-live="polite" onScroll={onScroll}>
            {!messages.length && (
              <div className="ask-empty">
                <p className="muted">Ask about missions, waypoints, equipment or the model. Answers cite the records they used.</p>
                {SUGGESTIONS[mode].map(s => <button key={s} type="button" className="chip" onClick={() => ask(s)}>{s}</button>)}
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`msg msg-${m.role}${m.error ? ' msg-error' : ''}`}>
                <p>{m.text}</p>
                {m.error && m.question && (
                  <button type="button" className="btn btn-ghost btn-sm msg-retry" disabled={busy} onClick={() => ask(m.question)}>Retry</button>
                )}
                {m.citations?.length > 0 && (
                  <ul className="citations" aria-label="Sources">
                    {m.citations.slice(0, 8).map(c => <Citation key={c.id} c={c} onOpen={t => go(t.tab, t.opts)} />)}
                  </ul>
                )}
              </div>
            ))}
            {busy && <div className="msg msg-ai"><p className="typing">Thinking…</p></div>}
          </div>
          {unseen && (
            <button type="button" className="btn btn-ghost btn-sm ask-new" onClick={() => { log.current?.scrollTo({ top: log.current.scrollHeight }); setUnseen(false); }}>
              New response ↓
            </button>
          )}
          <form className="ask-form" onSubmit={e => { e.preventDefault(); ask(question); }}>
            <input ref={input} value={question} onChange={e => setQuestion(e.target.value)} placeholder="Ask a question…" aria-label="Question" maxLength={2000} />
            <button type="submit" className="btn btn-accent btn-sm" disabled={busy || !question.trim()}>Ask</button>
          </form>
        </section>
      )}
      <button type="button" ref={fab} className="ask-fab" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-label={open ? 'Close AI assistant' : 'Open AI assistant'}>AI</button>
    </div>
  );
}
