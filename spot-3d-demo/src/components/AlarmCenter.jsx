import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api, asset, INGEST_URL, useApi, useApp } from '../api.js';
import { FloorPlane } from './InclinedMap.jsx';
import { ZoomImg } from './ui.jsx';
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

/** An alert pushed by the ingest API (raw anomaly + its readings), before the backend has caught up. */
function fromEvent(a, event, waypoints) {
  const w = waypoints.find(x => x.id === a.location_id);
  const r = a.readings?.[0];
  return {
    anomaly_id: a.anomaly_id, severity: a.severity, type: a.anomaly_type, mission_id: a.mission_id || event.mission_id,
    asset: a.asset_id, criticality: null, location_id: a.location_id, location_name: w?.name, floor: w?.floor,
    reading: r ? { label: measurementLabel(r.measurement_type), value: Number(r.value), unit: r.unit, quality: r.quality } : null,
    at: a.timestamp || new Date().toISOString(), image: imageFor(a.anomaly_type), detail: a.description,
  };
}

export default function AlarmCenter({ siren, muted, onMute, onActive, onStream }) {
  const { session, bump, notify } = useApp();
  const pending = useApi('/ops/alerts?pending=true');
  const waypoints = useApi('/waypoints');
  const [live, setLive] = useState({});
  const [done, setDone] = useState(() => new Set());
  const [index, setIndex] = useState(0);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [stream, setStream] = useState('connecting');
  const box = useRef(null);
  const wpRef = useRef([]);
  wpRef.current = waypoints.data || [];

  // Live missions from the Java ingest API. Every event refreshes all data views.
  useEffect(() => {
    if (typeof EventSource === 'undefined') return;
    const es = new EventSource(`${INGEST_URL}/events`);
    let timer = 0;
    es.onopen = () => setStream('live');
    es.onerror = () => setStream('offline');
    es.addEventListener('mission_ingested', e => {
      let event;
      try { event = JSON.parse(e.data); } catch { return; }
      setLive(prev => {
        const next = { ...prev };
        for (const a of event.alerts || []) next[a.anomaly_id] = fromEvent(a, event, wpRef.current);
        return next;
      });
      bump();
      // The backend reloads through its webhook; refresh again once it has.
      clearTimeout(timer);
      timer = setTimeout(bump, 2500);
    });
    return () => { clearTimeout(timer); es.close(); };
  }, [bump]);

  const queue = useMemo(() => {
    const byId = new Map(Object.values(live).map(a => [a.anomaly_id, a]));
    for (const i of pending.data || []) if (i.source_type === 'ANOMALY') byId.set(i.source_id, fromIssue(i));
    return [...byId.values()].filter(a => !done.has(a.anomaly_id));
  }, [live, pending.data, done]);

  const current = queue[Math.min(index, queue.length - 1)];
  const active = Boolean(current);

  useEffect(() => { onActive?.(active); }, [active, onActive]);
  useEffect(() => { onStream?.(stream); }, [stream, onStream]);
  useEffect(() => {
    if (active && siren && !muted) siren.start();
    else siren?.stop();
  }, [active, siren, muted]);
  useEffect(() => () => siren?.stop(), [siren]);
  useEffect(() => { if (active) box.current?.focus(); }, [active, current?.anomaly_id]);
  useEffect(() => { setNote(''); setError(''); }, [current?.anomaly_id]);

  if (!current) return null;

  async function decide(decision) {
    setBusy(true);
    setError('');
    try {
      await api(`/ops/alerts/${current.anomaly_id}/decision`, { method: 'POST', body: { decision, note }, token: session?.token });
      notify(decision === 'DANGER' ? 'Marked as danger' : 'Alarm overridden');
      setDone(d => new Set(d).add(current.anomaly_id));
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
          <span className="alarm-count">{queue.length > 1 ? `${Math.min(index, queue.length - 1) + 1} of ${queue.length}` : 'Live alarm'}</span>
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
              <ZoomImg src={asset(current.image)} alt={`Reference image for ${humanize(current.type)}`} />
              <figcaption>Reference image (not a live capture) · click to enlarge</figcaption>
            </figure>
          </div>
        </div>

        {session ? (
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
