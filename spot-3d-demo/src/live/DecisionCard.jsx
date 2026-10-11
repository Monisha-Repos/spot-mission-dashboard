import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api, asset, useApi, useApp } from '../api.js';
import { FloorPlane } from '../components/InclinedMap.jsx';
import LoginForm from '../modules/ops/LoginForm.jsx';
import { humanize, measurementLabel, num, reading } from '../lib/format.js';
import { chime } from '../lib/chime.js';
import { useLive } from './LiveContext.jsx';

/**
 * A finding that needs a person's decision: urgent, but calm. It docks at the top right instead of taking over the
 * screen, uses amber (attention) rather than red (error), says what is going on in plain words, and offers two clear
 * choices. "Later" tucks it into a small chip so it can't be lost; a soft chime (optional) announces new ones.
 */

const IMAGES = {
  ABNORMAL_TEMPERATURE: 'thermal_pump_bearing_01.jpg', ABNORMAL_VIBRATION: 'acoustic_valve_01.jpg',
  GAUGE_OUT_OF_RANGE: 'gauge_pressure_01.jpg', VISUAL_DEFECT: 'visual_pump_motor_01.jpg',
};
const imageFor = type => `/static/inspection-images/${IMAGES[type] || 'pipe_gallery_01.jpg'}`;

/** "Heat Exchanger 04 is running hot": what the finding means, not its code. */
const HEADLINE = {
  ABNORMAL_TEMPERATURE: 'is running hot', ABNORMAL_VIBRATION: 'is vibrating more than usual',
  GAUGE_OUT_OF_RANGE: 'has a gauge reading out of range', VISUAL_DEFECT: 'shows a visible defect',
  SIGNAL_DEGRADATION: 'had a weak network signal nearby', NAVIGATION_OBSTRUCTION: 'has its path blocked',
  LOCALIZATION_ISSUE: 'is where Spot lost its position',
};
const SOUND_KEY = 'spot.chime';

function soundOn() {
  try { return localStorage.getItem(SOUND_KEY) !== 'off'; } catch { return true; }
}

function ago(ms) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 10) return 'just now';
  if (s < 60) return `${s} s ago`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
}

/** One alert from the live stream, filled in with names from the reference data. */
function fromLive(a, wps, assets) {
  const w = wps[a.location_id];
  const as = assets[a.asset_id];
  const r = a.readings?.[0];
  return {
    id: a.anomaly_id, severity: a.severity, type: a.anomaly_type, mission_id: a.mission_id,
    equipment: as?.name || a.asset_id, equipment_id: a.asset_id, criticality: as?.criticality,
    location_id: a.location_id, location_name: w?.name, floor: w?.floor,
    reading: r ? { label: measurementLabel(r.measurement_type), value: Number(r.value), unit: r.unit, quality: r.quality } : null,
    detail: a.description, image: imageFor(a.anomaly_type), raised_at: a.raised_at || Date.now(),
    sandbox: Boolean(a.sandbox), practice: Boolean(a.practice),
  };
}

/** One waiting alarm from the backend (GET /ops/alerts), e.g. raised before this page was opened. */
function fromIssue(i) {
  return {
    id: i.source_id, severity: i.severity, type: i.anomaly?.type, mission_id: i.mission_id,
    equipment: i.asset_name || i.asset_id, equipment_id: i.asset_id, criticality: i.asset_criticality,
    location_id: i.location_id, location_name: i.location_name, floor: i.floor, reading: i.reading,
    detail: i.explanation, image: i.evidence_image || imageFor(i.anomaly?.type),
    raised_at: Date.parse(i.alert_at || i.created_at) || Date.now(), sandbox: false, practice: false,
  };
}

export default function DecisionCard() {
  const live = useLive();
  const { session, bump, notify } = useApp();
  const pending = useApi('/ops/alerts?pending=true');
  const waypoints = useApi('/waypoints');
  const assets = useApi('/assets');
  const [done, setDone] = useState(() => new Set());
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState(true);
  const [details, setDetails] = useState(false);
  const [why, setWhy] = useState(null); // reason text while choosing "It's fine"
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sound, setSound] = useState(soundOn);
  const [blocked, setBlocked] = useState(false); // the browser hasn't allowed sound yet (no click on the page)
  const [, tick] = useState(0);
  const heard = useRef(new Set());
  const card = useRef(null);

  const wps = useMemo(() => Object.fromEntries((waypoints.data || []).map(w => [w.id, w])), [waypoints.data]);
  const assetMap = useMemo(() => Object.fromEntries((assets.data || []).map(a => [a.id, a])), [assets.data]);
  const queue = useMemo(() => {
    const byId = new Map(Object.values(live.alerts).map(a => [a.anomaly_id, fromLive(a, wps, assetMap)]));
    for (const i of pending.data || []) {
      // The backend's copy is richer once the mission is saved; until then keep the live one.
      if (i.source_type === 'ANOMALY' && (!byId.has(i.source_id) || i.location_name)) byId.set(i.source_id, fromIssue(i));
    }
    return [...byId.values()].filter(a => !done.has(a.id)).sort((a, b) => a.raised_at - b.raised_at);
  }, [live.alerts, pending.data, wps, assetMap, done]);
  const current = queue[Math.min(index, queue.length - 1)];

  // New decisions re-open the card and play the chime once.
  useEffect(() => {
    const fresh = queue.filter(a => !heard.current.has(a.id));
    if (!fresh.length) return;
    fresh.forEach(a => heard.current.add(a.id));
    setOpen(true);
    if (sound) chime().then(ok => setBlocked(!ok));
  }, [queue, sound]);
  useEffect(() => { setWhy(null); setError(''); setDetails(false); }, [current?.id]);
  // Keep "2 min ago" fresh, and drop shared alarms someone decided in another tab.
  const shared = queue.some(a => !a.sandbox);
  const { dismiss } = live;
  useEffect(() => {
    const timer = setInterval(() => {
      tick(n => n + 1);
      if (!shared) return;
      api('/ops/alerts?pending=false').then(rows => {
        const decided = rows.filter(i => i.decided_at).map(i => i.source_id);
        if (decided.length) { dismiss(decided); setDone(d => new Set([...d, ...decided])); }
      }, () => {});
    }, 4000);
    return () => clearInterval(timer);
  }, [shared, dismiss]);

  if (!current) return null;

  function toggleSound() {
    // Blocked: this click is the permission the browser was waiting for, so play instead of switching off.
    if (sound && blocked) { chime().then(ok => setBlocked(!ok)); return; }
    const next = !sound;
    setSound(next);
    try { localStorage.setItem(SOUND_KEY, next ? 'on' : 'off'); } catch { /* lasts this visit */ }
    if (next) chime().then(ok => setBlocked(!ok));
  }

  async function decide(decision, note = '') {
    const label = decision === 'DANGER' ? 'Sent for a technician to check' : 'Noted as not a problem';
    if (current.sandbox) {
      live.resolveLocal(current.id);
      setDone(d => new Set(d).add(current.id));
      setIndex(0);
      notify?.(`${label}${current.practice ? ' (practice)' : ' (sandbox)'}`);
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api(`/ops/alerts/${current.id}/decision`, { method: 'POST', body: { decision, note }, token: session?.token });
      setDone(d => new Set(d).add(current.id));
      live.dismiss([current.id]);
      setIndex(0);
      notify?.(label);
      bump();
    } catch (e) {
      if (e.status === 409) { setDone(d => new Set(d).add(current.id)); live.dismiss([current.id]); bump(); }
      else setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const count = queue.length;
  if (!open) {
    return (
      <button type="button" className="decision-chip" onClick={() => setOpen(true)} aria-label={`${count} decision${count === 1 ? '' : 's'} waiting. Open.`}>
        <span className="decision-dot" aria-hidden="true" />
        {count} decision{count === 1 ? '' : 's'} waiting
      </button>
    );
  }

  const r = current.reading;
  const where = `${current.location_id}${current.location_name ? ` ${current.location_name}` : ''}${current.floor ? ` · Floor ${current.floor}` : ''}`;
  const canDecide = current.sandbox || Boolean(session);
  return (
    <section className={`decision sev-${(current.severity || '').toLowerCase()}`} role="alertdialog" aria-modal="false"
      aria-labelledby="decision-title" aria-describedby="decision-facts" ref={card} tabIndex={-1}>
      <header className="decision-head">
        <span className="decision-kicker">
          <span className="decision-dot" aria-hidden="true" />
          {current.practice ? 'Practice' : 'Needs a decision'}{count > 1 ? ` · ${Math.min(index, count - 1) + 1} of ${count}` : ''}
        </span>
        <span className="decision-tools">
          {count > 1 && <button type="button" className="link-btn" onClick={() => setIndex(i => (i + 1) % count)}>Next</button>}
          <button type="button" className="link-btn" onClick={toggleSound} aria-pressed={sound} title="Soft chime when a new decision arrives">
            {sound && blocked ? 'Tap to enable sound' : `Sound ${sound ? 'on' : 'off'}`}
          </button>
          <button type="button" className="link-btn" onClick={() => setOpen(false)}>Later</button>
        </span>
      </header>

      <h2 id="decision-title">
        <span className="decision-sev">{current.severity}</span>
        {current.equipment} {HEADLINE[current.type] || humanize(current.type)}
      </h2>

      <dl id="decision-facts" className="decision-facts">
        <dt>Where</dt><dd>{where}</dd>
        {r && <><dt>Reading</dt><dd><strong>{reading(r)}</strong> {r.label}{r.usual_range ? <span className="muted"> · usually {num(r.usual_range.low)}–{num(r.usual_range.high)}</span> : null}</dd></>}
        <dt>Found</dt><dd>{ago(current.raised_at)} · mission {current.mission_id}{current.sandbox && !current.practice ? ' · sandbox' : ''}</dd>
      </dl>
      {current.detail && <p className="decision-detail">{current.detail}</p>}

      <button type="button" className="link-btn decision-more" aria-expanded={details} onClick={() => setDetails(v => !v)}>
        {details ? 'Hide map and photo' : 'Show map and photo'}
      </button>
      {details && (
        <div className="decision-visuals">
          {current.floor && (
            <div className="decision-map" aria-label={`Floor ${current.floor} plan with ${current.location_id} highlighted`}>
              <FloorPlane waypoints={(waypoints.data || []).filter(w => w.floor === current.floor)} pulse={current.location_id} compact />
            </div>
          )}
          <figure className="evidence evidence-sm">
            <img src={asset(current.image)} alt={`Reference image for ${humanize(current.type)}`} />
            <figcaption>Reference image, not a live capture</figcaption>
          </figure>
        </div>
      )}

      {canDecide ? (
        why === null ? (
          <div className="decision-actions">
            <button type="button" className="btn btn-accent" disabled={busy} onClick={() => decide('DANGER')}>Send someone to check</button>
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setWhy('')}>It's fine</button>
          </div>
        ) : (
          <form className="decision-why" onSubmit={e => { e.preventDefault(); if (why.trim()) decide('OVERRIDE', why.trim()); }}>
            <label className="field">
              <span className="field-label">Why is it fine?</span>
              <input autoFocus value={why} onChange={e => setWhy(e.target.value)} maxLength={300} placeholder="e.g. known sensor glitch, checked yesterday" />
            </label>
            <div className="decision-actions">
              <button type="submit" className="btn btn-accent" disabled={busy || !why.trim()}>Confirm</button>
              <button type="button" className="btn btn-ghost" onClick={() => setWhy(null)}>Back</button>
            </div>
          </form>
        )
      ) : (
        <div className="decision-signin">
          <p className="muted">Sign in to decide. Everyone watching sees this until someone does.</p>
          <LoginForm compact />
        </div>
      )}
      {error && <p className="note note-error" role="alert">{error}</p>}
    </section>
  );
}
