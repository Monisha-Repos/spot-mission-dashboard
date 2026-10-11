import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../api.js';
import { humanize, measurementLabel, reading } from '../lib/format.js';
import { useLive } from './LiveContext.jsx';

/**
 * A floating bubble (bottom left) while a live run is on, on every tab. Opened, it shows the stream itself: where
 * each event travels (Spot to the ingest API to the lakehouse to every dashboard, or Spot to this tab in the sandbox),
 * with a dot sent down the pipe for every event, the mission's route step by step, and the latest events.
 */

const PACKET_MS = 1800;
const KIND = {
  MISSION_STARTED: 'start', ACTION_STARTED: 'step', READING_RECORDED: 'reading', ANOMALY_DETECTED: 'finding',
  ACTION_COMPLETED: 'ok', ACTION_FAILED: 'failed', MISSION_COMPLETED: 'saved',
};

function shortText(e) {
  const d = e.details || {};
  switch (e.type) {
    case 'MISSION_STARTED': return `${d.mission_id} started · ${d.action_count} steps`;
    case 'ACTION_STARTED': return `${d.location_id} · ${humanize(d.action_type)}`;
    case 'READING_RECORDED': return `${measurementLabel(d.measurement_type)} ${reading(d)}`;
    case 'ANOMALY_DETECTED': return `${d.severity?.toLowerCase()} ${humanize(d.anomaly_type)}${e.alarm ? ' · needs a decision' : ''}`;
    case 'ACTION_COMPLETED': return `${humanize(d.action_type)} done`;
    case 'ACTION_FAILED': return `${humanize(d.action_type)} failed: ${humanize(d.failure_type) || 'unknown'}`;
    case 'MISSION_COMPLETED': return `${d.mission_id} complete · battery ${d.end_battery_pct}%`;
    default: return e.type;
  }
}

/** Step outcomes of the mission in progress, from the feed (newest first). */
function routeSteps(run) {
  const steps = {};
  for (const e of run.feed) {
    if (e.mission_id !== run.mission_id) continue;
    const seq = e.details?.sequence;
    if (!seq) continue;
    if (e.type === 'ACTION_FAILED') steps[seq] = steps[seq] || 'failed';
    else if (e.type === 'ACTION_COMPLETED') steps[seq] = steps[seq] || 'ok';
  }
  return steps;
}

export default function StreamBubble() {
  const live = useLive();
  const { go } = useApp();
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(Date.now());
  const { run, mode, status, active } = live;
  const visible = Boolean(mode) && (active || run.feed.length > 0);

  // Re-render a few times a second while visible, so packets leave the pipe and the rate stays current.
  useEffect(() => {
    if (!visible) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 400);
    return () => clearInterval(timer);
  }, [visible]);
  useEffect(() => { if (!visible) setOpen(false); }, [visible]);

  const steps = useMemo(() => routeSteps(run), [run]);
  if (!visible) return null;

  const packets = run.feed.filter(e => now - e.seen_at < PACKET_MS).slice(0, 8);
  const perMinute = run.feed.filter(e => now - e.seen_at < 60000).length;
  const total = run.action_count || 0;
  const doneSteps = Object.keys(steps).length;
  const progress = total ? Math.min(1, doneSteps / total) : 0;
  const sandbox = mode === 'sandbox';
  const waiting = status?.state === 'waiting_for_decision';
  const nodes = sandbox
    ? [['spot', 'Spot (replay)'], ['tab', 'This browser']]
    : [['spot', 'Spot'], ['api', 'Ingest API'], ['lake', 'Lakehouse'], ['screens', 'Every dashboard']];
  const latest = run.feed[0];
  const savedFlash = latest?.type === 'MISSION_COMPLETED' && now - latest.seen_at < PACKET_MS;
  const stateText = waiting ? 'Waiting for a decision' : status?.state === 'paused' ? 'Paused' : status?.state === 'finished' ? 'Finished' : status?.state === 'saving' ? 'Saving' : 'Streaming';

  if (!open) {
    const r = 20, c = 2 * Math.PI * r;
    return (
      <button type="button" className={`stream-bubble${waiting ? ' is-waiting' : ''}`} onClick={() => setOpen(true)}
        aria-label={`${sandbox ? 'Sandbox' : 'Live'} stream: ${run.mission_id || 'starting'}, ${stateText}. Open stream view.`}>
        <span className="stream-ring" aria-hidden="true">
          <svg viewBox="0 0 48 48">
            <circle cx="24" cy="24" r={r} className="ring-track" />
            <circle cx="24" cy="24" r={r} className="ring-fill" strokeDasharray={c} strokeDashoffset={c * (1 - progress)} />
          </svg>
          <span key={latest?.key} className="stream-ping" />
          <span className="stream-core" />
        </span>
        <span className="stream-label">
          <strong>{sandbox ? 'Sandbox' : 'Live'} · {run.mission_id || '…'}</strong>
          <span>{run.location_id || stateText}{run.battery_pct != null ? ` · ${run.battery_pct}%` : ''}</span>
        </span>
      </button>
    );
  }

  return (
    <section className="stream-dialog" role="dialog" aria-label="Live data stream" onKeyDown={e => { if (e.key === 'Escape') setOpen(false); }}>
      <header className="stream-head">
        <div>
          <p className="eyebrow">{sandbox ? 'Sandbox stream · local data' : 'Live stream · everyone sees this'}</p>
          <h2>{run.mission_id ? `${run.mission_id} · ${stateText}` : stateText}</h2>
        </div>
        <button type="button" className="icon-btn" onClick={() => setOpen(false)} aria-label="Minimize stream view">–</button>
      </header>

      <div className={`pipe pipe-${nodes.length}`} aria-label={`Each event travels ${nodes.map(n => n[1]).join(' to ')}`}>
        <div className="pipe-track" aria-hidden="true">
          {packets.map(e => (
            <span key={e.key} className={`packet packet-${KIND[e.type] || 'step'}${e.alarm ? ' packet-alarm' : ''}`}
              style={{ animationDuration: `${PACKET_MS}ms` }} />
          ))}
        </div>
        {nodes.map(([id, label]) => (
          <div key={id} className={`pipe-node node-${id}${id === 'lake' && savedFlash ? ' is-saving' : ''}`}>
            <span className="pipe-icon" aria-hidden="true" />
            <span className="pipe-label">{label}</span>
          </div>
        ))}
      </div>

      <div className="route" aria-label={`Step ${run.action_sequence || 0} of ${total}`}>
        {Array.from({ length: total }, (_, i) => {
          const seq = i + 1;
          const state = steps[seq] || (seq === run.action_sequence && run.current_action ? 'now' : 'todo');
          return <span key={seq} className={`route-step step-${state}`} title={`Step ${seq}: ${state === 'todo' ? 'to do' : state === 'now' ? 'in progress' : state === 'ok' ? 'done' : 'failed'}`} />;
        })}
      </div>

      <dl className="stream-stats">
        <div><dt>Mission</dt><dd>{status?.mission_index || 0} of {status?.mission_total || '—'}</dd></div>
        <div><dt>Where</dt><dd>{run.location_id || '—'}</dd></div>
        <div><dt>Battery</dt><dd>{run.battery_pct != null ? `${run.battery_pct}%` : '—'}</dd></div>
        <div><dt>Events / min</dt><dd>{perMinute}</dd></div>
      </dl>

      <ol className="stream-events" aria-live="polite">
        {run.feed.slice(0, 4).map(e => (
          <li key={e.key} className={`ev ev-${KIND[e.type] || 'step'}${e.alarm ? ' ev-alarm' : ''}`}>
            <span className="ev-dot" aria-hidden="true" />{shortText(e)}
          </li>
        ))}
      </ol>

      <button type="button" className="link-btn stream-more" onClick={() => { setOpen(false); go?.('overview', { scrollTo: 'live' }); }}>
        Open the full live panel
      </button>
    </section>
  );
}
