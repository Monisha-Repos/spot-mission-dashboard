import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { api, INGEST_URL, useApp } from '../api.js';

/**
 * Everything live, in one place, for both modes:
 * - presenter: the Java ingest API plays the IMPROVED missions for every open dashboard (GET /events), and a signed-in
 *   operator drives it from the Operator Console. Missions are saved, decisions are shared, KPIs really change.
 * - sandbox: this browser plays the same events from GET /live/script on its own timer. Nothing is saved and no one
 *   else sees it; decisions stay in this tab.
 * Both feed the same reducer, so the top bar, Overview panel, 3D Spot, map, stream bubble and decision card look
 * identical in either mode.
 *
 * `alerts` holds the anomalies waiting for a person's decision (alarm-level: HIGH / CRITICAL or flagged for review),
 * keyed by anomaly_id; `sandbox: true` marks ones decided in this browser only.
 */
const LiveContext = createContext(null);
export const useLive = () => useContext(LiveContext);

const MAX_FEED = 40;
const ACTIVE = new Set(['running', 'paused', 'waiting_for_decision', 'saving']);
const MAX_GAP_MS = 5000;
const MISSION_GAP_MS = 3000;
export const SPEEDS = [30, 60, 120, 300];

const EMPTY_TALLY = { missions: 0, actions: 0, failed: 0, readings: 0, anomalies: 0, alarms: 0 };
const EMPTY_RUN = {
  mission_id: null, mission_name: null, location_id: null, battery_pct: null, action_sequence: 0, action_count: null,
  current_action: null, feed: [], tally: EMPTY_TALLY, risks: {},
};

function runReducer(run, action) {
  switch (action.type) {
    case 'reset': return EMPTY_RUN;
    case 'risk': return { ...run, risks: { ...run.risks, [action.id]: action.risk } };
    case 'event': {
      const e = action.event;
      const d = e.details || {};
      const next = { ...run, feed: [{ ...e, key: `${e.mission_id}-${run.tally.actions}-${run.feed.length}-${e.type}-${e.offset_sec}`, seen_at: Date.now() }, ...run.feed].slice(0, MAX_FEED) };
      const t = { ...run.tally };
      switch (e.type) {
        case 'MISSION_STARTED':
          Object.assign(next, { mission_id: d.mission_id, mission_name: d.mission_name, battery_pct: d.battery_pct,
            action_count: d.action_count, action_sequence: 0, location_id: null, current_action: null });
          break;
        case 'ACTION_STARTED':
          Object.assign(next, { location_id: d.location_id, battery_pct: d.battery_pct, action_sequence: d.sequence, current_action: d });
          break;
        case 'ACTION_COMPLETED':
        case 'ACTION_FAILED':
          t.actions += 1;
          if (e.type === 'ACTION_FAILED') t.failed += 1;
          next.current_action = null;
          break;
        case 'READING_RECORDED': t.readings += 1; break;
        case 'ANOMALY_DETECTED':
          t.anomalies += 1;
          if (e.alarm) t.alarms += 1;
          break;
        case 'MISSION_COMPLETED':
          t.missions += 1;
          Object.assign(next, { battery_pct: d.end_battery_pct, current_action: null });
          break;
        default:
      }
      next.tally = t;
      return next;
    }
    default: return run;
  }
}

export function LiveProvider({ children }) {
  const { bump } = useApp();
  const [stream, setStream] = useState('connecting');
  const [presenter, setPresenter] = useState(null); // Java /live/status
  const [sandbox, setSandbox] = useState(null); // { state, speed, mission_index, mission_total, message }
  const [run, dispatch] = useReducer(runReducer, EMPTY_RUN);
  const [alerts, setAlerts] = useState({});
  const player = useRef({ timer: 0, script: null, mi: 0, ei: 0 });
  const sandboxRef = useRef(null);
  sandboxRef.current = sandbox;
  const sandboxActive = Boolean(sandbox && ACTIVE.has(sandbox.state));

  const predict = useCallback(d => {
    if (!d?.action_id) return;
    api('/predict', { method: 'POST', body: {
      action_type: d.action_type, location_id: d.location_id, asset_id: d.asset_id, battery_pct: d.battery_pct ?? 50,
      configuration_version: d.configuration_version || 'V2', sequence: d.sequence || 1,
    } }).then(r => dispatch({ type: 'risk', id: d.action_id, risk: { value: r.failure_risk, flagged: r.flagged } }), () => {});
  }, []);

  const onEvent = useCallback((e, local = false) => {
    dispatch({ type: 'event', event: e });
    if (e.type === 'ACTION_STARTED') predict(e.details);
    if (e.type === 'ANOMALY_DETECTED' && e.alarm) {
      setAlerts(a => ({ ...a, [e.details.anomaly_id]: { ...e.details, mission_id: e.mission_id, sandbox: local, raised_at: Date.now() } }));
    }
  }, [predict]);

  // ---------- presenter mode: the shared stream from the Java ingest API ----------
  useEffect(() => {
    if (typeof EventSource === 'undefined') return undefined;
    const es = new EventSource(`${INGEST_URL}/events`);
    let timer = 0;
    const refreshSoon = () => { bump(); clearTimeout(timer); timer = setTimeout(bump, 2500); };
    es.onopen = () => setStream('live');
    es.onerror = () => setStream('offline');
    const parse = e => { try { return JSON.parse(e.data); } catch { return null; } };
    es.addEventListener('live', e => {
      const event = parse(e);
      if (event && !(sandboxRef.current && ACTIVE.has(sandboxRef.current.state))) onEvent(event);
    });
    es.addEventListener('live_status', e => {
      const s = parse(e);
      if (s) setPresenter(s);
    });
    // A saved mission (live feed or `feed` CLI): refresh every view. Its alerts are ones not already raised live.
    es.addEventListener('mission_ingested', e => {
      const event = parse(e);
      if (event?.alerts?.length) {
        setAlerts(a => {
          const next = { ...a };
          for (const al of event.alerts) next[al.anomaly_id] = { ...al, mission_id: al.mission_id || event.mission_id, sandbox: false, raised_at: Date.now() };
          return next;
        });
      }
      refreshSoon();
    });
    es.addEventListener('live_reset', () => {
      setAlerts(a => Object.fromEntries(Object.entries(a).filter(([, v]) => v.sandbox)));
      if (!(sandboxRef.current && ACTIVE.has(sandboxRef.current.state))) dispatch({ type: 'reset' });
      refreshSoon();
    });
    fetch(`${INGEST_URL}/live/status`).then(r => r.json()).then(setPresenter, () => {});
    return () => { clearTimeout(timer); es.close(); };
  }, [bump, onEvent]);

  // A new presenter run starts with an empty ticker (unless this tab is busy with its own sandbox).
  const presenterWasActive = useRef(false);
  useEffect(() => {
    const now = Boolean(presenter && ACTIVE.has(presenter.state));
    if (now && !presenterWasActive.current && presenter.mission_index <= 1 && !sandboxRef.current) dispatch({ type: 'reset' });
    presenterWasActive.current = now;
  }, [presenter]);

  // ---------- sandbox mode: the same events, played in this browser ----------
  const stepRef = useRef(() => {});
  const schedule = useCallback(delay => {
    clearTimeout(player.current.timer);
    player.current.timer = setTimeout(() => stepRef.current(), delay);
  }, []);

  const step = useCallback(() => {
    const p = player.current;
    const s = sandboxRef.current;
    if (!s || s.state !== 'running' || !p.script) return;
    const mission = p.script.missions[p.mi];
    if (!mission) {
      setSandbox(x => ({ ...x, state: 'finished', message: `Sandbox finished: ${p.script.missions.length} missions played. Nothing was saved.` }));
      return;
    }
    const event = mission.events[p.ei];
    onEvent({ ...event, live_at: new Date().toISOString(), speed: s.speed, sandbox: true }, true);
    if (event.type === 'MISSION_STARTED') setSandbox(x => ({ ...x, mission_index: p.mi + 1, message: `${event.mission_id} started (${p.mi + 1} of ${p.script.missions.length}).` }));
    p.ei += 1;
    if (event.alarm && s.pause_on_alarm) {
      setSandbox(x => ({ ...x, state: 'waiting_for_decision', waiting_for: event.details.anomaly_id,
        message: `Waiting for your decision on ${event.details.anomaly_id}.` }));
      return;
    }
    if (p.ei >= mission.events.length) {
      p.mi += 1;
      p.ei = 0;
      schedule(MISSION_GAP_MS);
      return;
    }
    const gap = (mission.events[p.ei].offset_sec - event.offset_sec) * 1000 / s.speed;
    schedule(Math.min(Math.max(gap, 0), MAX_GAP_MS));
  }, [onEvent, schedule]);
  stepRef.current = step;

  // Resume the player whenever the sandbox goes back to running.
  useEffect(() => {
    if (sandbox?.state === 'running') schedule(300);
    else clearTimeout(player.current.timer);
    return undefined;
  }, [sandbox?.state, schedule]);
  useEffect(() => () => clearTimeout(player.current.timer), []);

  const startSandbox = useCallback(async (speed = 60, pauseOnAlarm = true) => {
    const script = player.current.script || await api('/live/script');
    player.current = { timer: 0, script, mi: 0, ei: 0 };
    dispatch({ type: 'reset' });
    setAlerts(a => Object.fromEntries(Object.entries(a).filter(([, v]) => !v.sandbox)));
    setSandbox({ state: 'running', speed, pause_on_alarm: pauseOnAlarm, waiting_for: null, mission_index: 0,
      mission_total: script.missions.length,
      message: `Sandbox: ${script.missions.length} missions at ×${speed}. Only you see this; nothing is saved.` });
  }, []);

  const sandboxControl = useCallback(action => {
    setSandbox(s => {
      if (!s) return s;
      if (action === 'pause' && s.state === 'running') return { ...s, state: 'paused', message: 'Sandbox paused.' };
      if (action === 'resume' && (s.state === 'paused' || s.state === 'waiting_for_decision')) return { ...s, state: 'running', waiting_for: null, message: 'Sandbox resumed.' };
      if (action === 'stop') return null;
      return s;
    });
    if (action === 'stop') {
      clearTimeout(player.current.timer);
      dispatch({ type: 'reset' });
      setAlerts(a => Object.fromEntries(Object.entries(a).filter(([, v]) => !v.sandbox)));
    }
  }, []);

  const setSandboxSpeed = useCallback(speed => setSandbox(s => (s ? { ...s, speed } : s)), []);

  /** A decision made in this browser (sandbox or practice alert). The sandbox carries on once nothing is waiting. */
  const alertsRef = useRef(alerts);
  alertsRef.current = alerts;
  const resolveLocal = useCallback(id => {
    const rest = Object.entries(alertsRef.current).filter(([k]) => k !== id);
    setAlerts(a => Object.fromEntries(Object.entries(a).filter(([k]) => k !== id)));
    if (!rest.some(([, v]) => v.sandbox)) {
      setSandbox(s => (s && s.state === 'waiting_for_decision'
        ? { ...s, state: 'running', waiting_for: null, message: 'Decision noted. Sandbox resumed.' } : s));
    }
  }, []);

  /** Drop shared alerts that have been decided (here, or by someone in another tab). */
  const dismiss = useCallback(ids => {
    setAlerts(a => {
      const next = { ...a };
      let changed = false;
      for (const id of ids) if (next[id] && !next[id].sandbox) { delete next[id]; changed = true; }
      return changed ? next : a;
    });
  }, []);

  /** A practice decision card on this screen only, built from a real kit anomaly. */
  const testAlert = useCallback(async () => {
    const script = player.current.script || await api('/live/script');
    player.current.script = script;
    const event = script.missions.flatMap(m => m.events).find(e => e.alarm);
    const id = `PRACTICE-${Date.now().toString(36).toUpperCase()}`;
    setAlerts(a => ({ ...a, [id]: { ...event.details, anomaly_id: id, mission_id: event.mission_id, sandbox: true,
      practice: true, raised_at: Date.now() } }));
  }, []);

  const presenterActive = Boolean(presenter && ACTIVE.has(presenter.state));
  const mode = sandboxActive || (sandbox && !presenterActive) ? 'sandbox' : presenterActive ? 'presenter' : null;
  const status = mode === 'sandbox' ? sandbox : presenter;
  const value = useMemo(() => ({
    stream, presenter, sandbox, run, mode, status, alerts,
    active: mode === 'sandbox' ? sandboxActive : presenterActive,
    presenterActive, sandboxActive,
    startSandbox, sandboxControl, setSandboxSpeed, resolveLocal, dismiss, testAlert,
  }), [stream, presenter, sandbox, run, mode, status, alerts, sandboxActive, presenterActive,
    startSandbox, sandboxControl, setSandboxSpeed, resolveLocal, dismiss, testAlert]);
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}
