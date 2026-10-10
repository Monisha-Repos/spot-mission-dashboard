import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { titleCase } from '../lib/format.js';

const SUGGESTIONS = {
  simple: ['What needs attention right now?', 'Did the V2 changes help?', 'Why does WP05 fail?'],
  technical: ['Compare V1 and V2 action success with the p-value', 'Which waypoints have the highest navigation failure rate?', 'What is the model’s PR-AUC and how was it split?'],
};

function contextLabel(ctx) {
  const parts = [];
  if (ctx.part) parts.push(titleCase(ctx.part));
  if (ctx.waypoint) parts.push(ctx.waypoint);
  else if (ctx.floor) parts.push(`Floor ${ctx.floor}`);
  return parts.join(' · ');
}

/** Bottom-right assistant shared by every tab. mode: simple (Overview) or technical (Data Scientist, Operator). */
export default function AskPanel({ mode, context }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const log = useRef(null);
  const input = useRef(null);
  useEffect(() => { log.current?.scrollTo(0, log.current.scrollHeight); }, [messages, busy]);
  useEffect(() => { if (open) input.current?.focus(); }, [open]);

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
      setMessages(m => [...m, { role: 'ai', text: e.message, error: true }]);
    } finally {
      setBusy(false);
    }
  }

  const where = contextLabel(context || {});
  return (
    <div className={`ask${open ? ' is-open' : ''}`}>
      {open && (
        <section className="ask-panel" role="dialog" aria-label="AI assistant" onKeyDown={e => { if (e.key === 'Escape') setOpen(false); }}>
          <header className="ask-head">
            <div>
              <p className="eyebrow">AI assistant · {mode === 'technical' ? 'technical' : 'plain language'}</p>
              {where && <p className="ask-context">Looking at: {where}</p>}
            </div>
            <button type="button" className="icon-btn" onClick={() => setOpen(false)} aria-label="Close assistant">✕</button>
          </header>
          <div className="ask-log" ref={log} aria-live="polite">
            {!messages.length && (
              <div className="ask-empty">
                <p className="muted">Ask about missions, waypoints, equipment or the model. Answers cite the records they used.</p>
                {SUGGESTIONS[mode].map(s => <button key={s} type="button" className="chip" onClick={() => ask(s)}>{s}</button>)}
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`msg msg-${m.role}${m.error ? ' msg-error' : ''}`}>
                <p>{m.text}</p>
                {m.citations?.length > 0 && (
                  <ul className="citations" aria-label="Sources">
                    {m.citations.slice(0, 8).map(c => <li key={c.id} title={c.title}>{c.id}</li>)}
                  </ul>
                )}
              </div>
            ))}
            {busy && <div className="msg msg-ai"><p className="typing">Thinking…</p></div>}
          </div>
          <form className="ask-form" onSubmit={e => { e.preventDefault(); ask(question); }}>
            <input ref={input} value={question} onChange={e => setQuestion(e.target.value)} placeholder="Ask a question…" aria-label="Question" maxLength={2000} />
            <button type="submit" className="btn btn-accent btn-sm" disabled={busy || !question.trim()}>Ask</button>
          </form>
        </section>
      )}
      <button type="button" className="ask-fab" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-label={open ? 'Close AI assistant' : 'Open AI assistant'}>AI</button>
    </div>
  );
}
