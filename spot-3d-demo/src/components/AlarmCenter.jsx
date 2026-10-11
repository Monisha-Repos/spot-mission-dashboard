import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api, asset, useApi, useApp } from '../api.js';
import { useLive } from '../live/LiveContext.jsx';
import { FloorPlane } from './InclinedMap.jsx';
import LoginForm from '../modules/ops/LoginForm.jsx';
import { formatTime, humanize, measurementLabel, num, reading, titleCase } from '../lib/format.js';

const IMAGES = {
  ABNORMAL_TEMPERATURE: 'thermal_pump_bearing_01.jpg', ABNORMAL_VIBRATION: 'acoustic_valve_01.jpg',
  GAUGE_OUT_OF_RANGE: 'gauge_pressure_01.jpg', VISUAL_DEFECT: 'visual_pump_motor_01.jpg',
};
const imageFor = type => `/static/inspection-images/${IMAGES[type] || 'pipe_gallery_01.jpg'}`;

/** A waiting alarm from GET /ops/alerts (an enriched issue). */
function fromIssue(i) {
  return {
    anomaly_id: i.source_id, severity: i.severity, type: i.anomaly?.type, mission_id: i.mission_id,
    asset: i.asset_name || i.asset_id, criticality: i.asset_criticality, location_id: i.location_id,
    location_name: i.location_name, floor: i.floor, reading: i.reading, at: i.alert_at || i.timestamp,
    image: i.evidence_image || imageFor(i.anomaly?.type), detail: i.explanation,
  };
}

/** An alert pushed live (raw anomaly + its readings), before the backend has the mission. */
function fromEvent(a, waypoints, assets) {
  const w = waypoints.find(x => x.id === a.location_id);
  const as = assets.find(x => x.id === a.asset_id);
  const r = a.readings?.[0];
  return {
    anomaly_id: a.anomaly_id, severity: a.severity, type: a.anomaly_type, mission_id: a.mission_id,
    asset: as ? `${as.name} (${as.id})` : a.asset_id, criticality: as?.criticality || null, location_id: a.location_id,
    location_name: w?.name, floor: w?.floor,
    reading: r ? { label: measurementLabel(r.measurement_type), value: Number(r.value), unit: r.unit, quality: r.quality } : null,
    at: a.timestamp || new Date().toISOString(), image: imageFor(a.anomaly_type), detail: a.description,
    sandbox: Boolean(a.sandbox), test: Boolean(a.test),
  };
}

export default function AlarmCenter({ siren, muted, onMute, onActive }) {
  const { session, bump } = useApp();
  const live = useLive();
  const pending = useApi('/ops/alerts?pending=true');
  const waypoints = useApi('/waypoints');
  const assets = useApi('/assets');
  const [done, setDone] = useState(() => new Set());
  const [index, setIndex] = useState(0);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const box = useRef(null);

  const queue = useMemo(() => {
    const byId = new Map(Object.values(live.alerts).map(a => [a.anomaly_id, fromEvent(a, waypoints.data || [], assets.data || [])]));
    // The backend's version is richer once the mission has been saved; until then keep the live one.
    for (const i of pending.data || []) {
      if (i.source_type === 'ANOMALY' && (!byId.has(i.source_id) || i.location_name)) byId.set(i.source_id, fromIssue(i));
    }
    return [...byId.values()].filter(a => !done.has(a.anomaly_id));
  }, [live.alerts, pending.data, waypoints.data, assets.data, done]);

  const current = queue[Math.min(index, queue.length - 1)];
  const active = Boolean(current);
  const shared = queue.some(a => !a.sandbox);

  // Someone may decide a shared alarm in another tab: check every few seconds while one is showing here.
  const { dismiss } = live;
  useEffect(() => {
    if (!shared) return undefined;
    const timer = setInterval(() => {
      api('/ops/alerts?pending=false').then(rows => {
        const decided = rows.filter(i => i.decided_at).map(i => i.source_id);
        if (decided.length) {
          dismiss(decided);
          setDone(d => { const n = new Set(d); decided.forEach(x => n.add(x)); return n; });
        }
      }, () => {});
    }, 3000);
    return () => clearInterval(timer);
  }, [shared, dismiss]);

  useEffect(() => { onActive?.(active); }, [active, onActive]);
  useEffect(() => {
    if (active && siren && !muted) siren.start();
    else siren?.stop();
  }, [active, siren, muted]);
  useEffect(() => () => siren?.stop(), [siren]);
  useEffect(() => { if (active) box.current?.focus(); }, [active, current?.anomaly_id]);
  useEffect(() => { setNote(''); setError(''); }, [current?.anomaly_id]);

  if (!current) return null;

  async function decide(decision) {
    if (current.sandbox) {
      live.resolveLocal(current.anomaly_id);
      setIndex(0);
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api(`/ops/alerts/${current.anomaly_id}/decision`, { method: 'POST', body: { decision, note }, token: session?.token });
      setDone(d => new Set(d).add(current.anomaly_id));
      live.dismiss([current.anomaly_id]);
      setIndex(0);
      bump();
    } catch (e) {
      if (e.status === 409) { setDone(d => new Set(d).add(current.anomaly_id)); bump(); }
      else setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const floorWps = (waypoints.data || []).filter(w => w.floor === current.floor);
  const r = current.reading;
  return (
    <div className="alarm-backdrop">
      <div
        className="alarm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="alarm-title"
        aria-describedby="alarm-detail"
        tabIndex={-1}
        ref={box}
        onKeyDown={e => { if (e.key === 'Escape') e.preventDefault(); }}
      >
        <header className="alarm-head">
          <span className="alarm-count">{queue.length > 1 ? `${Math.min(index, queue.length - 1) + 1} of ${queue.length}` : current.test ? 'Practice alarm' : current.sandbox ? 'Sandbox alarm' : 'Live alarm'}</span>
          {queue.length > 1 && (
            <span className="alarm-nav">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setIndex(i => (i - 1 + queue.length) % queue.length)}>Previous</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setIndex(i => (i + 1) % queue.length)}>Next</button>
            </span>
          )}
          {siren
            ? <button type="button" className="btn btn-ghost btn-sm" onClick={onMute} aria-pressed={muted}>{muted ? 'Unmute siren' : 'Mute siren'}</button>
            : <span className="muted">Siren not armed</span>}
        </header>
        <h2 id="alarm-title">{current.severity} · {humanize(current.type).toUpperCase()}</h2>
        <div className="alarm-grid">
          <div id="alarm-detail" className="alarm-facts">
            <dl>
              <dt>Equipment</dt><dd>{current.asset}{current.criticality ? ` · ${titleCase(current.criticality)} criticality` : ''}</dd>
              <dt>Where</dt><dd>{current.location_id} {current.location_name || ''}{current.floor ? ` · Floor ${current.floor}` : ''}</dd>
              <dt>Reading</dt>
              <dd>{r ? <><strong className="alarm-reading">{reading(r)}</strong> {r.label}{r.usual_range ? ` · usual ${num(r.usual_range.low)}–${num(r.usual_range.high)}` : ''}{r.quality && r.quality !== 'GOOD' ? ` · ${humanize(r.quality)}` : ''}</> : '—'}</dd>
              <dt>When</dt><dd>{formatTime(current.at)} · mission {current.mission_id}</dd>
            </dl>
            {current.detail && <p>{current.detail}</p>}
          </div>
          <div className="alarm-visuals">
            {current.floor && (
              <div className="alarm-map" aria-label={`Floor ${current.floor} plan with ${current.location_id} highlighted`}>
                <FloorPlane waypoints={floorWps} pulse={current.location_id} compact />
              </div>
            )}
            <figure className="evidence evidence-sm">
              <img src={asset(current.image)} alt={`Reference image for ${humanize(current.type)}`} />
              <figcaption>Reference image (not a live capture)</figcaption>
            </figure>
          </div>
        </div>

        {current.sandbox ? (
          <div className="alarm-actions">
            <p className="muted">{current.test ? 'Practice alarm on this screen only.' : 'Sandbox: your decision stays in this browser and the replay carries on.'}</p>
            <div className="alarm-buttons">
              <button type="button" className="btn btn-ghost" onClick={() => decide('OVERRIDE')}>✅ Not a problem (override)</button>
              <button type="button" className="btn btn-danger" onClick={() => decide('DANGER')}>🚨 Mark as danger</button>
            </div>
          </div>
        ) : session ? (
          <div className="alarm-actions">
            <label className="field">
              <span className="field-label">Reason / note (required for “Not a problem”)</span>
              <input value={note} onChange={e => setNote(e.target.value)} maxLength={1000} placeholder={`Decision by ${session.name}`} />
            </label>
            <div className="alarm-buttons">
              <button type="button" className="btn btn-ghost" disabled={busy || !note.trim()} onClick={() => decide('OVERRIDE')}>✅ Not a problem (override)</button>
              <button type="button" className="btn btn-danger" disabled={busy} onClick={() => decide('DANGER')}>🚨 Mark as danger</button>
            </div>
          </div>
        ) : (
          <div className="alarm-actions">
            <p><strong>Sign in to decide.</strong> This alarm stays up until a signed-in operator responds.</p>
            <LoginForm compact />
          </div>
        )}
        {error && <p className="note note-error" role="alert">{error}</p>}
      </div>
    </div>
  );
}
