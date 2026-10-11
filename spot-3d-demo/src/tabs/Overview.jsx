import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { asset, useApi, useApp } from '../api.js';
import { Async, Badge, Bars, Empty, Section, Segmented, Stat, ZoomImg } from '../components/ui.jsx';
import InclinedMap from '../components/InclinedMap.jsx';
import { formatTime, num, pct, reading, severityTone, titleCase, tone } from '../lib/format.js';
import { scrollToEl } from '../lib/dom.js';

const SpotViewer = lazy(() => import('../SpotViewer.jsx'));

const PART_ORDER = ['thermal_camera', 'ptz_camera', 'microphone', 'legs_and_body_cameras', 'lidar', 'battery'];
const PART_IMAGES = {
  thermal_camera: 'thermal_pump_bearing_01.jpg', ptz_camera: 'visual_pump_motor_01.jpg',
  microphone: 'acoustic_valve_01.jpg', legs_and_body_cameras: 'pipe_gallery_01.jpg',
};

/** True on screens wide enough for the hero copy to sit beside the robot. */
function useWide(query = '(min-width: 761px)') {
  const [wide, setWide] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setWide(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [query]);
  return wide;
}

function partTone(p) {
  if (!p) return 'muted';
  if (p.status_counts?.action) return 'bad';
  if (p.status_counts?.watch) return 'warn';
  return 'ok';
}

function PartPanel({ id, onClose }) {
  const state = useApi(id ? `/parts/${id}` : null);
  // While the next part loads, the previous part's numbers stay dimmed so they aren't mistaken for the new one.
  const stale = state.data && state.data.id !== id;
  return (
    <aside className="part-panel" aria-live="polite" aria-label="Selected part">
      <button type="button" className="icon-btn part-close" onClick={onClose} aria-label="Back to the whole robot">✕</button>
      <Async state={state} refresh>
        {p => (
          <div className={stale ? 'is-stale' : undefined}>
            <p className="eyebrow">Spot part</p>
            <h3>{p.name}</h3>
            <p className="lead">{p.summary}</p>
            <div className="stat-row">
              <Stat label="Success" value={pct(p.success_pct)} sub={`${p.actions} actions`} />
              <Stat label="V1 → V2" value={`${pct(p.success_pct_by_configuration?.V1, 0)} → ${pct(p.success_pct_by_configuration?.V2, 0)}`} />
            </div>
            {Object.entries(p.readings || {}).map(([k, r]) => (
              <div key={k} className="reading-card">
                <span className="eyebrow">{r.label}</span>
                <p>Average <strong>{num(r.mean)}{r.unit === 'C' ? '°C' : ` ${r.unit}`}</strong> across {r.count} readings
                  {r.usual_range && <> · usual range {num(r.usual_range.low)}–{num(r.usual_range.high)}</>}
                  {r.questionable ? <> · {r.questionable} questionable</> : null}.</p>
              </div>
            ))}
            <h4>What went wrong</h4>
            <Bars data={p.failures_by_type} tone="bad" />
            <h4>Findings</h4>
            <Bars data={p.anomalies_by_type} tone="warn" />
            {PART_IMAGES[id] && (
              <figure className="evidence">
                <ZoomImg src={asset(`/static/inspection-images/${PART_IMAGES[id]}`)} alt={`Reference image for the ${p.name}`} loading="lazy" />
                <figcaption>Reference image from the challenge kit · click to enlarge</figcaption>
              </figure>
            )}
          </div>
        )}
      </Async>
    </aside>
  );
}

function WaypointPanel({ id, flash }) {
  const state = useApi(id ? `/waypoints/${id}` : null);
  if (!id) return <p className="muted map-hint">Pick a waypoint to see what Spot found there.</p>;
  const stale = state.data && state.data.id !== id;
  return (
    <div id="waypoint-detail" className={`wp-panel${flash ? ' is-flash' : ''}`}>
      <Async state={state} refresh>
        {w => {
          const recent = [...w.records].sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 6);
          return (
            <div className={`wp-detail${stale ? ' is-stale' : ''}`}>
              <p className="eyebrow">{w.id} · Floor {w.floor} · {titleCase(w.zone_type)}</p>
              <h3>{w.name}</h3>
              <p><Badge tone={tone(w.status)}>{w.status}</Badge> <span className="muted">{w.status_basis}</span></p>
              <div className="stat-row">
                <Stat label="Failed" value={pct(w.failure_pct)} sub={`of ${w.actions} actions`} />
                <Stat label="V1 → V2" value={`${pct(w.by_configuration?.V1?.failure_pct, 0)} → ${pct(w.by_configuration?.V2?.failure_pct, 0)}`} />
                <Stat label="Open issues" value={w.open_issues ?? '—'} />
              </div>
              <h4>Latest readings</h4>
              {recent.length ? (
                <ul className="record-list">
                  {recent.map(r => (
                    <li key={r.record_id}>
                      <div className="record-top">
                        <Badge tone={tone(r.status)}>{r.status}</Badge>
                        <span>{r.asset.name}</span>
                        <span className="muted">{r.mission_id} · {formatTime(r.timestamp)}</span>
                      </div>
                      <p>{r.explanation}</p>
                      {r.status !== 'normal' && <p className="next-step">Next step: {r.recommended_action}</p>}
                    </li>
                  ))}
                </ul>
              ) : <Empty>Spot hasn’t inspected anything at this waypoint yet.</Empty>}
            </div>
          );
        }}
      </Async>
    </div>
  );
}

export default function Overview({ theme, context, setContext, onReplay }) {
  const { go } = useApp();
  const summary = useApi('/summary');
  const waypoints = useApi('/waypoints');
  const parts = useApi('/parts');
  const [stance, setStance] = useState('stand');
  const [autoRotate, setAutoRotate] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const [hoverPart, setHoverPart] = useState(null);
  const [flash, setFlash] = useState(0);
  const wide = useWide();
  const part = context.part || null;
  const floor = context.floor || 1;
  const partStatus = useMemo(() => Object.fromEntries((parts.data || []).map(p => [p.id, partTone(p)])), [parts.data]);

  // Whatever opened the part panel (a chip or a hotspot) gets focus back when it closes.
  const opener = useRef(null);
  const setPart = id => {
    if (id && !part) opener.current = document.activeElement;
    setContext(c => ({ ...c, part: id || undefined }));
  };
  const closePart = () => {
    setPart(null);
    const el = opener.current;
    opener.current = null;
    requestAnimationFrame(() => { if (el?.isConnected) el.focus(); });
  };
  function resetView() {
    setContext(c => ({ ...c, part: undefined }));
    setAutoRotate(false);
    setResetKey(k => k + 1);
  }

  // A waypoint picked from elsewhere (findings list, assistant) shows its own floor.
  useEffect(() => {
    const w = waypoints.data?.find(x => x.id === context.waypoint);
    if (w && w.floor !== floor) setContext(c => ({ ...c, floor: w.floor }));
  }, [context.waypoint, waypoints.data]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clicking a finding selects its waypoint, brings the map + detail into view and briefly highlights the detail.
  function showFinding(r) {
    setContext(c => ({ ...c, floor: r.location.floor, waypoint: r.location.id }));
    // Side by side on wide screens, so the map section; stacked on small ones, so straight to the detail.
    requestAnimationFrame(() => scrollToEl(wide ? 'map' : 'waypoint-detail'));
    setFlash(f => f + 1);
  }
  useEffect(() => {
    if (!flash) return undefined;
    const t = setTimeout(() => setFlash(0), 1600);
    return () => clearTimeout(t);
  }, [flash]);

  const k = summary.data?.kpis;
  return (
    <>
      <section className="hero" aria-label="Spot 3D model">
        <div className="stage">
          <Suspense fallback={<div className="skeleton stage-skeleton" aria-label="Loading 3D model" />}>
            <SpotViewer
              theme={theme}
              hotspots
              focusPart={part}
              onPartSelect={setPart}
              hoverPart={hoverPart}
              onPartHover={setHoverPart}
              partStatus={partStatus}
              stance={stance}
              autoRotate={autoRotate && !part}
              resetKey={resetKey}
              shiftX={wide && !part ? 0.12 : 0}
            />
          </Suspense>
          <div className="hero-copy">
            <p className="eyebrow">Autonomous inspection</p>
            <h1>Spot at work</h1>
            <p className="lead">{summary.data?.latest_mission
              ? <>
                  Latest mission <strong>{summary.data.latest_mission.mission_id}</strong> ({summary.data.latest_mission.configuration_version})
                  <span className="mission-facts">
                    {summary.data.latest_mission.headline.split('·').map(part => {
                      const text = part.trim();
                      const urgent = text.includes('need action') && parseInt(text, 10) > 0;
                      return <span key={text} className={urgent ? 'tone-bad' : undefined}>{text}</span>;
                    })}
                  </span>
                </>
              : 'Click a part of the robot to see what it measured.'}</p>
            {summary.data?.latest_mission && onReplay && (
              <button type="button" className="btn btn-accent btn-sm hero-replay" onClick={() => onReplay(summary.data.latest_mission.mission_id)}>
                Replay this run
              </button>
            )}
            <div className="part-picker" role="group" aria-label="Robot parts">
              {PART_ORDER.map(id => {
                const p = parts.data?.find(x => x.id === id);
                return (
                  <button
                    key={id}
                    type="button"
                    className={`chip${hoverPart === id ? ' is-hover' : ''}`}
                    aria-pressed={part === id}
                    onClick={() => setPart(part === id ? null : id)}
                    onMouseEnter={() => setHoverPart(id)}
                    onMouseLeave={() => setHoverPart(null)}
                    onFocus={() => setHoverPart(id)}
                    onBlur={() => setHoverPart(null)}
                  >
                    <span className={`dot tone-${partStatus[id] || 'muted'}`} aria-hidden="true" />
                    {p ? p.name.split(' (')[0] : titleCase(id)}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="stage-controls">
            <Segmented label="Pose" options={[['stand', 'Stand'], ['sit', 'Sit'], ['walk', 'Walk']]} value={stance} onChange={setStance} />
            <button type="button" className="btn btn-ghost btn-sm" aria-pressed={autoRotate} onClick={() => setAutoRotate(v => !v)}>Rotate</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={resetView}>Reset view</button>
            <span className="stage-hint" aria-hidden="true">Drag to rotate · Scroll to zoom</span>
          </div>
          {part && <PartPanel id={part} onClose={closePart} />}
        </div>
      </section>

      <Section eyebrow="Across all missions" title="How Spot is doing" id="kpis">
        <Async state={summary}>
          {() => (
            <div className="stat-grid">
              <Stat label="Action success" value={pct(k.all.action_success_pct)} sub={`V1 ${pct(k.V1?.action_success_pct)} → V2 ${pct(k.V2?.action_success_pct)}`} tone="accent" />
              <Stat label="Missions completed" value={pct(k.all.mission_completion_pct)} sub={`${k.all.missions} missions`} />
              <Stat
                label="Findings"
                value={k.all.anomalies}
                sub={`${k.all.serious_anomalies} high or critical`}
                onClick={() => scrollToEl('attention')}
                action="Jump to the top findings"
              />
              <Stat label="Battery used per mission" value={pct(k.all.avg_battery_drain_pct, 0)} sub={`V1 ${pct(k.V1?.avg_battery_drain_pct, 0)} → V2 ${pct(k.V2?.avg_battery_drain_pct, 0)}`} />
              {summary.data.ops ? (
                <Stat
                  label="Open issues"
                  value={summary.data.ops.open_issues ?? '—'}
                  sub={`${summary.data.ops.pending_alarms} alarms waiting`}
                  onClick={() => go('operator')}
                  action="Open the issue queue"
                />
              ) : <Stat label="Open issues" value="—" sub="Operator console off" />}
            </div>
          )}
        </Async>
      </Section>

      <Section eyebrow="Facility" title="Where Spot looked" id="map" className="map-section">
        <div className="map-layout">
          <Async state={waypoints}>
            {wps => (
              <InclinedMap
                waypoints={wps}
                floor={floor}
                onFloor={f => setContext(c => ({ ...c, floor: f, waypoint: undefined }))}
                selected={context.waypoint}
                onSelect={id => setContext(c => ({ ...c, waypoint: id || undefined }))}
              />
            )}
          </Async>
          <div className="map-side"><WaypointPanel id={context.waypoint} flash={Boolean(flash)} /></div>
        </div>
      </Section>

      <Section eyebrow="Needs attention" title="Top findings" id="attention">
        <Async state={summary}>
          {s => (s.needs_attention?.length ? (
            <ul className="attention">
              {s.needs_attention.map(r => (
                <li key={r.record_id}>
                  <button type="button" className="attention-item" onClick={() => showFinding(r)}>
                    <Badge tone={severityTone(r.anomaly?.severity)}>{r.anomaly?.severity || 'FAILED'}</Badge>
                    <strong>{r.asset.name}</strong>
                    <span className="muted">{r.location.id} {r.location.name} · {r.mission_id} · {reading(r.reading)}</span>
                    <span className="attention-text">{r.explanation}</span>
                    <span className="attention-go" aria-hidden="true">Show on map →</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="all-clear">
              <span className="dot tone-ok" aria-hidden="true" />
              <p><strong>All clear.</strong> Nothing needs action right now. New findings show up here as soon as Spot reports them.</p>
            </div>
          ))}
        </Async>
      </Section>
    </>
  );
}
