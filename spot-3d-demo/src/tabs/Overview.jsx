import React, { Suspense, lazy, useMemo, useRef, useState } from 'react';
import { asset, useApi } from '../api.js';
import { Async, Badge, Bars, Section, Segmented, Stat } from '../components/ui.jsx';
import InclinedMap from '../components/InclinedMap.jsx';
import { formatTime, num, pct, reading, severityTone, titleCase, tone } from '../lib/format.js';

const SpotViewer = lazy(() => import('../SpotViewer.jsx'));

const PART_ORDER = ['thermal_camera', 'ptz_camera', 'microphone', 'legs_and_body_cameras', 'radio', 'battery'];
const PART_LABELS = { thermal_camera: 'Thermal camera', ptz_camera: 'Visual camera', microphone: 'Acoustic sensor', legs_and_body_cameras: 'Mobility & stereo', radio: 'Radio & comms', battery: 'Battery' };
const PART_IMAGES = {
  thermal_camera: 'thermal_pump_bearing_01.jpg', ptz_camera: 'visual_pump_motor_01.jpg',
  microphone: 'acoustic_valve_01.jpg', legs_and_body_cameras: 'pipe_gallery_01.jpg',
};

function partTone(p) {
  if (!p) return 'muted';
  if (p.status_counts?.action) return 'bad';
  if (p.status_counts?.watch) return 'warn';
  return 'ok';
}

function PartPanel({ id, onClose }) {
  const state = useApi(id ? `/parts/${id}` : null);
  return (
    <aside className="part-panel" aria-live="polite" aria-label="Selected part">
      <button type="button" className="icon-btn part-close" onClick={onClose} aria-label="Back to the whole robot">✕</button>
      <Async state={state}>
        {p => (
          <>
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
                <img src={asset(`/static/inspection-images/${PART_IMAGES[id]}`)} alt={`Reference image for the ${p.name}`} loading="lazy" />
                <figcaption>Reference image from the challenge kit</figcaption>
              </figure>
            )}
          </>
        )}
      </Async>
    </aside>
  );
}

function WaypointPanel({ id, waypoints, floor, onSelect }) {
  const state = useApi(id ? `/waypoints/${id}` : null);
  if (!id) return (
    <div className="waypoint-directory">
      <p className="eyebrow">Floor {floor} · Inspection points</p>
      <h3>Select a location</h3>
      <p className="muted">Open a waypoint to review readings, evidence, and follow-up actions.</p>
      <ul>
        {waypoints.filter(w => w.floor === floor).map(w => (
          <li key={w.id}><button type="button" onClick={() => onSelect(w.id)}>
            <span className={`dot tone-${tone(w.status)}`} aria-hidden="true" />
            <code>{w.id}</code><span>{w.name}</span><span className="sr-only">{w.status}</span><span aria-hidden="true">↗</span>
          </button></li>
        ))}
      </ul>
    </div>
  );
  return (
    <Async state={state}>
      {w => {
        const recent = [...w.records].sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 6);
        return (
          <div className="wp-detail">
            <p className="eyebrow">{w.id} · Floor {w.floor} · {titleCase(w.zone_type)}</p>
            <h3>{w.name}</h3>
            <p><Badge tone={tone(w.status)}>{w.status}</Badge> <span className="muted">{w.status_basis}</span></p>
            <div className="stat-row">
              <Stat label="Failed" value={pct(w.failure_pct)} sub={`of ${w.actions} actions`} />
              <Stat label="V1 → V2" value={`${pct(w.by_configuration?.V1?.failure_pct, 0)} → ${pct(w.by_configuration?.V2?.failure_pct, 0)}`} />
              <Stat label="Open issues" value={w.open_issues ?? '—'} />
            </div>
            <h4>Latest readings</h4>
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
          </div>
        );
      }}
    </Async>
  );
}

export default function Overview({ theme, context, setContext, onReplay, onOperator }) {
  const summary = useApi('/summary');
  const waypoints = useApi('/waypoints');
  const parts = useApi('/parts');
  const [stance, setStance] = useState('stand');
  const [autoRotate, setAutoRotate] = useState(false);
  const [wireframe, setWireframe] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const viewer = useRef(null);
  const mapSection = useRef(null);
  const part = context.part || null;
  const floor = context.floor || 1;
  const partStatus = useMemo(() => Object.fromEntries((parts.data || []).map(p => [p.id, partTone(p)])), [parts.data]);
  const setPart = id => setContext(c => ({ ...c, part: id || undefined }));
  const selectWaypoint = id => setContext(c => ({ ...c, waypoint: id || undefined }));
  const locateFinding = r => {
    setContext(c => ({ ...c, floor: r.location.floor, waypoint: r.location.id }));
    mapSection.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
    mapSection.current?.focus({ preventScroll: true });
  };

  const k = summary.data?.kpis;
  const latest = summary.data?.latest_mission;
  return (
    <>
      <header className="page-head overview-head">
        <div>
          <p className="eyebrow">Mission operations</p>
          <h1>Mission overview</h1>
          <p className="lead">Review inspection results and prioritize follow-up.</p>
        </div>
        <div className="page-actions">
          <span className="data-scope">Synthetic dataset</span>
          <button type="button" className="btn btn-accent" onClick={onOperator}>Review issue queue <span aria-hidden="true">↗</span></button>
        </div>
      </header>

      <section className="overview-summary" aria-label="Performance across all missions">
        <div className="summary-caption"><span>Across all missions</span><span>{summary.data?.loaded_at ? `Data loaded ${formatTime(summary.data.loaded_at)}` : summary.error ? 'Data unavailable' : 'Loading mission data'}</span></div>
        <Async state={summary}>
          {s => (
            <div className="stat-grid">
              <Stat label="Open issues" value={s.ops?.open_issues ?? '—'} sub={s.ops ? `${s.ops.pending_alarms} alarms awaiting a decision` : 'Operator console unavailable'} tone={s.ops?.open_issues ? 'warn' : undefined} />
              <Stat label="Action success" value={pct(k.all.action_success_pct)} sub={`V1 ${pct(k.V1?.action_success_pct)} → V2 ${pct(k.V2?.action_success_pct)}`} />
              <Stat label="Mission completion" value={pct(k.all.mission_completion_pct)} sub={`${k.all.missions} recorded missions`} />
              <Stat label="Inspection findings" value={k.all.anomalies} sub={`${k.all.serious_anomalies} high or critical`} />
              <Stat label="Avg. battery used" value={pct(k.all.avg_battery_drain_pct, 0)} sub={`Per mission · V2 ${pct(k.V2?.avg_battery_drain_pct, 0)}`} />
            </div>
          )}
        </Async>
        {latest && <div className="latest-mission">
          <div className="mission-identity"><span className="eyebrow">Latest mission</span><strong>{latest.mission_id}</strong><Badge>{latest.configuration_version}</Badge></div>
          <div className="mission-summary"><span>{latest.headline}</span><time dateTime={latest.end_time}>{formatTime(latest.end_time)} · {latest.duration_min} min</time></div>
          <Badge tone={latest.mission_status === 'FAILED' ? 'bad' : 'muted'}>{titleCase(latest.mission_status)}</Badge>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onReplay(latest.mission_id)}>Replay mission <span aria-hidden="true">→</span></button>
        </div>}
      </section>

      <div className={`overview-workspace${expanded ? ' explorer-expanded' : ''}`}>
        <Section eyebrow="Inspection review" title="Priority findings" id="attention" className="workspace-panel findings-panel" actions={<span className="panel-meta">Highest severity first</span>}>
          <p className="panel-description">Top findings across recorded missions. Track resolution in the issue queue.</p>
          <Async state={summary}>
            {s => s.needs_attention.length ? (
              <ul className="attention">
                {s.needs_attention.map(r => (
                  <li key={r.record_id}>
                    <div className="finding-heading"><Badge tone={severityTone(r.anomaly?.severity)}>{r.anomaly?.severity || 'FAILED'}</Badge><strong>{r.asset.name}</strong><span className="finding-reading">{reading(r.reading)}</span></div>
                    <p className="finding-location">{r.location.id} · {r.location.name} · {r.mission_id}</p>
                    <details className="finding-evidence"><summary>{titleCase(r.anomaly?.type || r.failure_type || r.action_type)}<span>Details</span></summary><p>{r.explanation}</p></details>
                    <div className="finding-action"><p>{r.recommended_action}</p><button type="button" className="text-btn" onClick={() => locateFinding(r)} aria-label={`Locate ${r.asset.name} at ${r.location.id}`}>Locate <span aria-hidden="true">↗</span></button></div>
                  </li>
                ))}
              </ul>
            ) : <p className="empty-state">No priority findings in the recorded missions.</p>}
          </Async>
          <button type="button" className="panel-link" onClick={onOperator}>Open issue queue <span aria-hidden="true">→</span></button>
        </Section>

        <Section eyebrow="Robot & payloads" title="Spot explorer" id="explorer" className="workspace-panel explorer-panel" actions={<button type="button" className="btn btn-ghost btn-sm" aria-expanded={expanded} onClick={() => setExpanded(v => !v)}>{expanded ? 'Compact view' : 'Expand view'}</button>}>
          <div className="stage">
            <Suspense fallback={<div className="skeleton stage-skeleton" aria-label="Loading 3D model" />}>
              <SpotViewer
                ref={viewer}
                theme={theme}
                hotspots
                focusPart={part}
                onPartSelect={setPart}
                partStatus={partStatus}
                stance={stance}
                autoRotate={autoRotate && !part}
                wireframe={wireframe}
              />
            </Suspense>
            <span className="viewer-caption">Interactive 3D · Drag to orbit</span>
          </div>
          <div className="explorer-tools">
            <div className="explorer-instruction"><span>Select a part to inspect its results</span>{part && <button type="button" className="text-btn" onClick={() => setPart(null)}>Reset view</button>}</div>
            <div className="part-picker" role="group" aria-label="Robot parts">
              {PART_ORDER.map(id => {
                const p = parts.data?.find(x => x.id === id);
                return (
                  <button key={id} type="button" className={`chip tone-${partStatus[id] || 'muted'}`} aria-pressed={part === id} onClick={() => setPart(part === id ? null : id)}>
                    <span className="dot" aria-hidden="true" />{PART_LABELS[id]}<span className="sr-only">{p ? `: ${partStatus[id] === 'bad' ? 'Action findings' : partStatus[id] === 'warn' ? 'Watch findings' : 'Normal results'}` : ': Results unavailable'}</span>
                  </button>
                );
              })}
            </div>
            <p className="model-note">Colors reflect inspection results, not robot health.</p>
            <details className="model-options">
              <summary>Model controls</summary>
              <div className="stage-controls">
                <Segmented label="Pose" options={[['stand', 'Stand'], ['sit', 'Sit'], ['walk', 'Walk']]} value={stance} onChange={setStance} />
                <button type="button" className="btn btn-ghost btn-sm" aria-pressed={autoRotate} onClick={() => setAutoRotate(v => !v)}>Rotate</button>
                <button type="button" className="btn btn-ghost btn-sm" aria-pressed={wireframe} onClick={() => setWireframe(v => !v)}>Wireframe</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => viewer.current?.exportGLB()}>Export GLB</button>
              </div>
            </details>
          </div>
          {part && <PartPanel id={part} onClose={() => setPart(null)} />}
        </Section>
      </div>

      <div className="map-target" ref={mapSection} tabIndex={-1} aria-label="Facility inspection map">
        <Section eyebrow="Facility" title="Inspection map" id="map" className="map-section" actions={<span className="panel-meta">Schematic · Status from recent missions</span>}>
          <div className="map-layout">
            <Async state={waypoints}>
              {wps => (
                <InclinedMap
                  waypoints={wps}
                  floor={floor}
                  onFloor={f => setContext(c => ({ ...c, floor: f, waypoint: undefined }))}
                  selected={context.waypoint}
                  onSelect={selectWaypoint}
                />
              )}
            </Async>
            <div className="map-side">
              {context.waypoint && <button type="button" className="text-btn back-locations" onClick={() => selectWaypoint(null)}>← All locations on floor {floor}</button>}
              <WaypointPanel id={context.waypoint} waypoints={waypoints.data || []} floor={floor} onSelect={selectWaypoint} />
            </div>
          </div>
        </Section>
      </div>
    </>
  );
}
