import React, { useMemo, useState } from 'react';
import { api, useApi, useApp } from '../api.js';
import { Badge, Battery, Section, Segmented, Stat } from '../components/ui.jsx';
import { humanize, measurementLabel, num, reading } from '../lib/format.js';
import { SPEEDS, useLive } from './LiveContext.jsx';

const STATE_LABEL = {
  running: 'Running', paused: 'Paused', waiting_for_decision: 'Waiting for an alarm decision', saving: 'Saving mission',
  finished: 'Finished', idle: 'Idle', resetting: 'Resetting',
};
const STATE_TONE = { running: 'ok', paused: 'warn', waiting_for_decision: 'bad', saving: 'accent', finished: 'muted', idle: 'muted', resetting: 'warn' };
const speedOptions = SPEEDS.map(s => [String(s), `×${s}`]);
const clock = iso => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '');

/** Top-bar pill: the live mission while one runs, otherwise whether the live stream is connected. */
export function LiveBadge() {
  const { stream, active, mode, run, status } = useLive();
  if (active) {
    const hold = status.state !== 'running' && status.state !== 'saving';
    return (
      <span className={`live live-run${hold ? ' live-hold' : ''}`} title={status.message}>
        <i aria-hidden="true" />
        {mode === 'sandbox' ? 'Sandbox' : 'Live'}{run.mission_id ? ` · ${run.mission_id}` : ''}
        {run.location_id ? ` · ${run.location_id}` : ''}{run.battery_pct != null ? ` · ${run.battery_pct}%` : ''}
        {status.state === 'waiting_for_decision' ? ' · alarm' : hold ? ' · paused' : ''}
      </span>
    );
  }
  return (
    <span className={`live live-${stream}`} title={`Live ingest stream: ${stream}`}>
      <i aria-hidden="true" />{stream === 'live' ? 'Live' : stream === 'offline' ? 'Offline' : '…'}
    </span>
  );
}

function useNames() {
  const waypoints = useApi('/waypoints');
  const assets = useApi('/assets');
  return useMemo(() => ({
    wp: Object.fromEntries((waypoints.data || []).map(w => [w.id, w])),
    asset: Object.fromEntries((assets.data || []).map(a => [a.id, a])),
  }), [waypoints.data, assets.data]);
}

function riskText(risk) {
  if (!risk) return null;
  return <span className={`live-risk${risk.flagged ? ' is-flagged' : ''}`}>AI risk {Math.round(risk.value * 100)}%{risk.flagged ? ' · flagged' : ''}</span>;
}

/** One line of the live ticker. */
function TickerItem({ e, names, risks, mode }) {
  const d = e.details || {};
  const where = names.wp[d.location_id];
  const what = names.asset[d.asset_id]?.name || d.asset_id;
  let icon = '•', tone = '', body;
  switch (e.type) {
    case 'MISSION_STARTED':
      icon = '▶'; tone = 'accent';
      body = <><strong>{d.mission_id} started</strong> · {d.mission_name} · {d.action_count} steps · battery {d.battery_pct}%</>;
      break;
    case 'ACTION_STARTED':
      body = <>{d.location_id} {where?.name || ''} · {humanize(d.action_type)} of {what} {riskText(risks[d.action_id])}</>;
      break;
    case 'READING_RECORDED':
      icon = '◆';
      body = <>{measurementLabel(d.measurement_type)} <strong>{reading(d)}</strong>{d.quality && d.quality !== 'GOOD' ? ` · ${humanize(d.quality)}` : ''}</>;
      break;
    case 'ANOMALY_DETECTED':
      icon = '⚠'; tone = e.alarm ? 'bad' : 'warn';
      body = <><Badge tone={e.alarm ? 'bad' : 'warn'}>{d.severity}</Badge> {humanize(d.anomaly_type)} on {what}{e.alarm ? ' · alarm raised' : ''}</>;
      break;
    case 'ACTION_COMPLETED':
      icon = '✓'; tone = 'ok';
      body = <>{humanize(d.action_type)} done{d.duration_sec ? ` in ${d.duration_sec} s` : ''}</>;
      break;
    case 'ACTION_FAILED': {
      icon = '✗'; tone = 'bad';
      const r = risks[d.action_id];
      body = <>{humanize(d.action_type)} failed: {humanize(d.failure_type) || 'unknown'}{r ? (r.flagged ? ' · the AI had flagged it' : ` · AI risk was ${Math.round(r.value * 100)}%`) : ''}</>;
      break;
    }
    case 'MISSION_COMPLETED':
      icon = '■'; tone = 'accent';
      body = <><strong>{d.mission_id} complete</strong> · battery {d.end_battery_pct}% · {mode === 'sandbox' ? 'not saved (sandbox)' : 'saved to the lakehouse'}</>;
      break;
    default:
      body = e.type;
  }
  return (
    <li className={`ticker-item${tone ? ` tone-${tone}` : ''}`}>
      <span className="ticker-icon" aria-hidden="true">{icon}</span>
      <span className="ticker-body">{body}</span>
      <time className="ticker-time" dateTime={e.live_at}>{clock(e.live_at)}</time>
    </li>
  );
}

/** Overview: what Spot is doing right now, or a way to watch it. */
export function LivePanel() {
  const live = useLive();
  const names = useNames();
  const [speed, setSpeed] = useState('60');
  const [error, setError] = useState('');
  const { run, status, mode, active } = live;

  async function startSandbox() {
    setError('');
    try { await live.startSandbox(Number(speed)); } catch (e) { setError(e.message); }
  }

  if (!mode) {
    return (
      <Section eyebrow="Live" title="Watch Spot work" id="live" className="live-section">
        <div className="live-cta">
          <p className="lead">Replay the nine IMPROVED (V2) missions as if Spot were sending them right now: every step, reading
            and finding as it happens, with the AI's failure-risk estimate before each step and an alarm to answer.</p>
          <div className="live-cta-actions">
            <Segmented label="Speed" options={speedOptions} value={speed} onChange={setSpeed} />
            <button type="button" className="btn btn-accent" onClick={startSandbox}>Try live demo</button>
          </div>
          <p className="muted">Runs in your browser only; nothing is saved and no one else sees it. During a presentation, the
            presenter's live feed appears here for everyone.</p>
          {error && <p className="note note-error" role="alert">{error}</p>}
        </div>
      </Section>
    );
  }

  const wp = names.wp[run.location_id];
  const total = status?.mission_total || 0;
  const index = status?.mission_index || 0;
  const controls = mode === 'sandbox' && (
    <div className="live-controls">
      {status.state === 'running' && <button type="button" className="btn btn-ghost btn-sm" onClick={() => live.sandboxControl('pause')}>Pause</button>}
      {(status.state === 'paused') && <button type="button" className="btn btn-ghost btn-sm" onClick={() => live.sandboxControl('resume')}>Resume</button>}
      {active && <Segmented label="Speed" options={speedOptions} value={String(status.speed)} onChange={v => live.setSandboxSpeed(Number(v))} />}
      {!active && <button type="button" className="btn btn-accent btn-sm" onClick={startSandbox}>Play again</button>}
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => live.sandboxControl('stop')}>{active ? 'Stop' : 'Close'}</button>
    </div>
  );
  const t = run.tally;
  return (
    <Section eyebrow={mode === 'sandbox' ? 'Live · sandbox (only you see this)' : 'Live · presenter feed'}
      title={run.mission_id ? `${run.mission_id} in progress` : 'Live feed'} id="live" className="live-section" actions={controls}>
      <div className="live-grid">
        <div className="live-now">
          <p className="live-state"><Badge tone={STATE_TONE[status?.state] || 'muted'}>{STATE_LABEL[status?.state] || status?.state}</Badge> {status?.message}</p>
          <dl className="live-facts">
            <dt>Mission</dt><dd>{run.mission_id ? `${run.mission_id} · ${index} of ${total}` : '—'}</dd>
            <dt>Step</dt>
            <dd>
              <span className="live-progress" aria-label={`Step ${run.action_sequence || 0} of ${run.action_count || 0}`}>
                <span style={{ width: `${run.action_count ? (100 * (run.action_sequence || 0)) / run.action_count : 0}%` }} />
              </span>
              {run.action_sequence || 0} of {run.action_count || '—'}
            </dd>
            <dt>Where</dt><dd>{run.location_id ? `${run.location_id} ${wp?.name || ''}${wp ? ` · Floor ${wp.floor}` : ''}` : '—'}</dd>
            <dt>Battery</dt><dd>{run.battery_pct != null ? <Battery pct={run.battery_pct} digits={0} /> : '—'}</dd>
          </dl>
          <div className="stat-grid live-tally">
            <Stat label="Steps this run" value={t.actions} sub={`${t.failed} failed`} />
            <Stat label="Readings" value={t.readings} />
            <Stat label="Findings" value={t.anomalies} sub={`${t.alarms} alarm${t.alarms === 1 ? '' : 's'}`} tone={t.alarms ? 'bad' : undefined} />
            <Stat label="Missions done" value={t.missions} sub={mode === 'sandbox' ? 'not saved' : 'saved'} />
          </div>
        </div>
        <ol className="ticker" aria-live="polite" aria-label="Live events, newest first">
          {run.feed.length === 0 && <li className="muted">Waiting for the first event…</li>}
          {run.feed.map(e => <TickerItem key={e.key} e={e} names={names} risks={run.risks} mode={mode} />)}
        </ol>
      </div>
    </Section>
  );
}

/** Operator Console: drives the shared presenter feed (needs sign-in; reset needs a supervisor). */
export function PresenterControls() {
  const live = useLive();
  const { session, setSession, bump } = useApp();
  const health = useApi('/health');
  const [speed, setSpeed] = useState('60');
  const [pauseOnAlarm, setPauseOnAlarm] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const p = live.presenter;
  const state = p?.state || (live.stream === 'offline' ? 'offline' : 'idle');
  const running = ['running', 'paused', 'waiting_for_decision', 'saving'].includes(state);
  const usage = health.data?.ask_usage;

  async function call(action, body) {
    if (action === 'reset' && !window.confirm('Reset the demo? The lakehouse goes back to the 18 BASELINE missions and the Operator Console starts fresh (issues, decisions and snapshots are cleared).')) return;
    setBusy(action);
    setError('');
    try {
      await api(`/ops/live/${action}`, { method: 'POST', body, token: session?.token });
      bump();
    } catch (e) {
      if (e.status === 401) setSession(null);
      setError(e.message);
    } finally {
      setBusy('');
    }
  }

  return (
    <Section eyebrow="Presenter" title="Live demo feed" id="ops-live">
      <p className="lead">Streams the nine IMPROVED (V2) missions through the Java ingest API to <strong>every open dashboard</strong>, event by event.
        Missions are saved as they finish, alarms go to everyone, and the KPIs and snapshot history climb.</p>
      <p className="live-state">
        <Badge tone={STATE_TONE[state] || 'muted'}>{state === 'offline' ? 'Ingest API offline' : STATE_LABEL[state] || state}</Badge>{' '}
        {p?.message}{p?.mission_total ? ` · ${p.missions_saved} of ${p.mission_total} saved` : ''}
      </p>
      {!session && <p className="note">Sign in above to control the feed.</p>}
      {session && (
        <div className="live-controls">
          {!running && (
            <>
              <Segmented label="Speed" options={speedOptions} value={speed} onChange={setSpeed} />
              <label className="check"><input type="checkbox" checked={pauseOnAlarm} onChange={e => setPauseOnAlarm(e.target.checked)} /> Pause on alarms</label>
              <button type="button" className="btn btn-accent btn-sm" disabled={Boolean(busy) || state === 'offline'}
                onClick={() => call('start', { speed: Number(speed), pause_on_alarm: pauseOnAlarm })}>Start live feed</button>
            </>
          )}
          {running && (
            <>
              <Segmented label="Speed" options={speedOptions} value={String(p.speed)} onChange={v => call('speed', { speed: Number(v) })} />
              {state === 'running' && <button type="button" className="btn btn-ghost btn-sm" disabled={Boolean(busy)} onClick={() => call('pause')}>Pause</button>}
              {(state === 'paused' || state === 'waiting_for_decision') && <button type="button" className="btn btn-ghost btn-sm" disabled={Boolean(busy)} onClick={() => call('resume')}>Resume</button>}
              <button type="button" className="btn btn-ghost btn-sm" disabled={Boolean(busy)} onClick={() => call('stop')}>Stop</button>
            </>
          )}
          {session.role === 'supervisor' && (
            <button type="button" className="btn btn-danger btn-sm" disabled={Boolean(busy) || state === 'offline'} onClick={() => call('reset')}>Reset to baseline</button>
          )}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => live.testAlarm()}>Test alarm (this screen)</button>
        </div>
      )}
      {error && <p className="note note-error" role="alert">{error}</p>}
      <p className="muted">
        {state === 'waiting_for_decision' && 'The feed carries on once every alarm has a decision. '}
        {usage ? `AI assistant: ${usage.model || usage.provider} · about $${num(usage.spent_usd, 3)} of $${num(usage.budget_usd, 2)} used this month (${usage.calls} paid answers).` : ''}
      </p>
    </Section>
  );
}
