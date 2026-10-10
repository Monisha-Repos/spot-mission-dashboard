import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { asset as assetUrl, useApi } from '../api.js';
import { Async, Badge, Section, Segmented, Stat } from '../components/ui.jsx';
import { humanize, reading, tone } from '../lib/format.js';
import {
  RESULT, buildTimeline, clockAt, dayLabel, didWhat, doingWhat, elapsed, nextFindingAfter, nextWhat, stateAt,
} from '../lib/replay.js';

// Playback speed: how many seconds of the real run pass per second on screen.
const SPEEDS = [[30, '30×'], [60, '60×'], [120, '120×']];
const SPEED_WORDS = { 30: '30 seconds', 60: 'one minute', 120: 'two minutes' };
const FLOORS = [1, 2];
const findingsOf = m => (m.status_counts?.watch || 0) + (m.status_counts?.action || 0);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/* ---------- run picker ---------- */

function RunRail({ missions, selected, onSelect }) {
  const rail = useRef(null);
  const latest = missions[missions.length - 1]?.mission_id;
  // Keep the selected run in view by scrolling the rail only (never the page).
  useEffect(() => {
    const r = rail.current;
    const el = r?.querySelector('[aria-pressed="true"]');
    if (el) r.scrollTo({ left: el.offsetLeft - r.clientWidth / 2 + el.clientWidth / 2, behavior: 'smooth' });
  }, [selected, missions.length]);

  return (
    <div className="runs">
      <div className="runs-head">
        <p className="eyebrow">Pick a run · {missions.length} recorded</p>
        <ul className="legend" aria-label="Colour key">
          <li><span className="dot tone-ok" />All good</li>
          <li><span className="dot tone-warn" />Keep an eye on</li>
          <li><span className="dot tone-bad" />Needs action</li>
        </ul>
      </div>
      <ol className="run-rail" ref={rail} aria-label="Recorded runs">
        {missions.map(m => {
          const n = findingsOf(m);
          const failed = m.mission_status === 'FAILED';
          return (
            <li key={m.mission_id}>
              <button
                type="button"
                className={`run${failed ? ' is-failed' : ''}`}
                aria-pressed={selected === m.mission_id}
                onClick={() => onSelect(m.mission_id)}
                aria-label={`${m.mission_id}, ${dayLabel(m.start_time)} at ${m.start_time.slice(11, 16)}, ${n ? plural(n, 'finding') : 'no findings'}${failed ? ', stopped early' : ''}`}
              >
                <span className="run-top">
                  <b>{m.mission_id}</b>
                  {m.mission_id === latest ? <span className="run-tag">Latest</span> : <span className="run-cfg">{m.configuration_version}</span>}
                </span>
                <span className="run-when">{dayLabel(m.start_time)} · {m.start_time.slice(11, 16)}</span>
                <span className="run-bar" aria-hidden="true">
                  {['action', 'watch', 'normal'].map(s => (m.status_counts?.[s]
                    ? <i key={s} className={`sev-${tone(s)}`} style={{ flexGrow: m.status_counts[s] }} /> : null))}
                </span>
                <span className="run-foot">
                  {failed ? <span className="tone-bad">Stopped early</span> : n ? plural(n, 'finding') : 'No findings'}
                  <span>{m.duration_min} min</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/* ---------- map: both floors, Spot's walked path and live position ---------- */

/** Consecutive stops on one floor become one polyline, so floor changes don't draw lines across. */
function runsOnFloor(points, floor) {
  const runs = [];
  let run = [];
  for (const p of points) {
    if (p.floor === floor) run.push(p);
    else if (run.length) { runs.push(run); run = []; }
  }
  if (run.length) runs.push(run);
  return runs.filter(r => r.length > 1).map(r => r.map(p => `${p.x},${100 - p.y}`).join(' '));
}

function ReplayMap({ waypoints, tl, now, at }) {
  const visited = tl.stops.filter(s => s.start <= at);
  const statusAt = {};
  const RANK = { normal: 0, watch: 1, action: 2 };
  for (const s of tl.stops) {
    if (!statusAt[s.loc.id]) statusAt[s.loc.id] = 'pending';
    if (s.revealAt <= at) {
      const prev = statusAt[s.loc.id];
      if (prev === 'pending' || RANK[s.status] > RANK[prev]) statusAt[s.loc.id] = s.status;
    }
  }
  const planned = tl.stops.map(s => s.loc);
  const walked = [...visited.map(s => s.loc), ...(now.position && now.phase === 'walking' ? [now.position] : [])];
  const floorOf = now.position?.floor ?? 1;

  return (
    <div className="rmap">
      {FLOORS.map(f => {
        const wps = waypoints.filter(w => w.floor === f);
        const here = now.position && now.position.floor === f;
        return (
          <div key={f} className={`rmap-floor${floorOf === f ? ' is-active' : ''}`}>
            <span className="rmap-tag">Floor {f}{floorOf === f && <b> · Spot is here</b>}</span>
            <div className="plane rmap-plane">
              <svg className="plane-grid" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                <defs>
                  <pattern id={`rp-minor-${f}`} width="5" height="5" patternUnits="userSpaceOnUse"><path d="M5 0H0V5" fill="none" className="grid-minor" /></pattern>
                  <pattern id={`rp-major-${f}`} width="25" height="25" patternUnits="userSpaceOnUse"><rect width="25" height="25" fill={`url(#rp-minor-${f})`} /><path d="M25 0H0V25" fill="none" className="grid-major" /></pattern>
                </defs>
                <rect width="100" height="100" fill={`url(#rp-major-${f})`} />
                {runsOnFloor(planned, f).map((pts, i) => <polyline key={`p${i}`} points={pts} className="rmap-planned" />)}
                {runsOnFloor(walked, f).map((pts, i) => <polyline key={`w${i}`} points={pts} className="rmap-walked" />)}
              </svg>
              {wps.map(w => {
                const st = statusAt[w.id];
                const cls = !st ? 'is-off' : st === 'pending' ? 'is-pending' : `is-seen sev-${tone(st)}`;
                return (
                  <span key={w.id} className={`rmap-wp ${cls}`} style={{ left: `${w.x}%`, top: `${100 - w.y}%` }} title={`${w.id} ${w.name}`}>
                    <i aria-hidden="true" /><span>{w.id}</span>
                  </span>
                );
              })}
              {here && (
                <span
                  className={`rmap-spot${now.phase === 'inspecting' ? ' is-working' : ''}`}
                  style={{ left: `${now.position.x}%`, top: `${100 - now.position.y}%` }}
                  aria-hidden="true"
                >
                  <i />
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- what Spot is doing right now ---------- */

function batteryTone(pct) { return pct === null ? 'muted' : pct < 20 ? 'bad' : pct < 35 ? 'warn' : 'ok'; }

function NowCard({ tl, now, at, mission, onRestart }) {
  const n = tl.stops.length;
  const s = now.current;
  const r = s?.record;
  const shown = s && s.revealAt <= at && now.phase !== 'walking' && now.phase !== 'starting';
  const done = now.phase === 'done';
  const stoppedEarly = tl.endType === 'FAILED';
  const phaseLabel = {
    starting: 'Starting the run',
    walking: `On the way to stop ${s ? s.index + 1 : ''} of ${n}`,
    inspecting: `Stop ${s ? s.index + 1 : ''} of ${n} · ${shown ? 'checked' : 'in progress'}`,
    finishing: 'Heading back',
    done: stoppedEarly ? 'Run stopped early' : 'Run finished',
  }[now.phase];

  return (
    <div className={`now${shown && s.finding && !done ? ` now-finding sev-${tone(s.status)}` : ''}`}>
      <div className="now-clock">
        <span className="now-time">{clockAt(tl.startIso, at)}</span>
        <span className="muted">{elapsed(at)} into the run · {elapsed(tl.duration)} total</span>
      </div>

      <p className="eyebrow now-phase">{phaseLabel}</p>
      {done ? (
        <>
          <h3>{tl.findings.length ? plural(tl.findings.length, 'finding') : 'No findings'}</h3>
          <p className="now-what">
            Spot made {plural(n, 'stop')} in {elapsed(tl.duration)}.{' '}
            {stoppedEarly ? 'The run did not finish, so some checks may be missing.' : tl.findings.length ? 'Review the findings below.' : 'Everything it checked looked normal.'}
          </p>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onRestart}>Watch again</button>
        </>
      ) : r ? (
        <>
          <h3>{r.location.name}</h3>
          <p className="now-where muted">{r.location.id} · Floor {r.location.floor}</p>
          <p className="now-what">{now.phase === 'walking' || now.phase === 'starting' ? `Next: ${nextWhat(r.action_type, r.asset.name)}` : now.phase === 'inspecting' && !shown ? `${doingWhat(r.action_type, r.asset.name)}…` : didWhat(r.action_type, r.asset.name)}</p>
          {shown && (
            <div className="now-result">
              <p><Badge tone={tone(s.status)}>{RESULT[s.status]}</Badge>{r.reading && <span className="now-reading">{r.reading.label} {reading(r.reading)}</span>}</p>
              {s.finding && (
                <>
                  <p>{r.explanation}</p>
                  <p className="next-step">Next step: {r.recommended_action}</p>
                </>
              )}
            </div>
          )}
        </>
      ) : <p className="muted">No stops recorded for this run.</p>}

      <div className="now-meters">
        <div className={`meter sev-${batteryTone(now.battery)}`}>
          <span className="meter-label">Battery</span>
          <span className="meter-track"><span style={{ width: `${now.battery ?? 0}%` }} /></span>
          <span className="meter-value">{now.battery ?? '—'}%</span>
        </div>
        <div className="now-count">
          <span><b>{now.revealed}</b> / {n} stops checked</span>
          <span className={now.findingsSoFar ? 'tone-warn' : 'muted'}><b>{now.findingsSoFar}</b> {now.findingsSoFar === 1 ? 'finding' : 'findings'} so far</span>
        </div>
      </div>
      {mission.hidden_failures && done && !stoppedEarly && (
        <p className="note now-note">The run is marked finished, but {plural(mission.failed_actions, 'check')} did not complete.</p>
      )}
    </div>
  );
}

/* ---------- transport + timeline track with timestamped findings ---------- */

function Track({ tl, at, onSeek }) {
  const p = v => `${(v / tl.duration) * 100}%`;
  const stopNo = tl.stops.filter(s => s.start <= at).length;
  return (
    <div className="track">
      <div className="track-flags" aria-label="Findings on this run">
        {tl.findings.map((s, i) => {
          const pos = s.revealAt / tl.duration;
          const r = s.record;
          return (
            <button
              key={s.id}
              type="button"
              className={`flag sev-${tone(s.status)}${i % 2 ? ' is-low' : ''}${pos > 0.8 ? ' is-right' : pos < 0.2 ? ' is-left' : ''}${s.revealAt <= at ? ' is-seen' : ''}`}
              style={{ left: p(s.revealAt) }}
              onClick={() => onSeek(s.revealAt, true)}
              aria-label={`Finding at ${clockAt(tl.startIso, s.revealAt)}: ${RESULT[s.status]}, ${r?.asset.name || ''} at ${r?.location.name || s.loc.id}. Jump here.`}
            >
              <span className="flag-label">
                <span className="flag-time">{clockAt(tl.startIso, s.revealAt)}</span>
                <span className="flag-what">{r ? (r.anomaly ? humanize(r.anomaly.type) : r.failure_type ? humanize(r.failure_type) : r.asset.name) : s.loc.id}</span>
              </span>
            </button>
          );
        })}
      </div>
      <div className="track-scrub">
        <div className="track-lane" aria-hidden="true">
          {tl.stops.map(s => (
            <span
              key={s.id}
              className={`track-stop sev-${tone(s.status)}${s.start <= at ? ' is-past' : ''}`}
              style={{ left: p(s.start), width: `max(4px, ${p(s.end - s.start)})` }}
            />
          ))}
          <span className="track-progress" style={{ width: p(at) }} />
          <span className="track-head" style={{ left: p(at) }} />
        </div>
        <input
          type="range"
          className="track-range"
          min={0}
          max={tl.duration}
          step={1000}
          value={Math.round(at)}
          onChange={e => onSeek(Number(e.target.value), true)}
          aria-label="Replay position"
          aria-valuetext={`${clockAt(tl.startIso, at)}, ${elapsed(at)} into the run, stop ${stopNo} of ${tl.stops.length}`}
        />
      </div>
      <div className="track-axis" aria-hidden="true">
        <span>{clockAt(tl.startIso, 0)} · start</span>
        <span>{clockAt(tl.startIso, tl.duration / 2)}</span>
        <span>{tl.endType === 'FAILED' ? 'stopped' : 'end'} · {clockAt(tl.startIso, tl.duration)}</span>
      </div>
    </div>
  );
}

const Icon = ({ d }) => <svg viewBox="0 0 24 24" aria-hidden="true"><path d={d} /></svg>;

/* ---------- stop-by-stop list ---------- */

function StopList({ tl, at, filter, onSeek }) {
  const stops = filter === 'findings' ? tl.findings : tl.stops;
  if (!stops.length) return <p className="muted">No findings on this run. Every stop looked normal.</p>;
  return (
    <ol className="stops">
      {stops.map(s => {
        const r = s.record;
        const state = at >= s.end && s.revealAt <= at ? 'done' : at >= s.start ? 'now' : 'next';
        if (!r) return null;
        return (
          <li key={s.id} className={`stop stop-${state} sev-${tone(s.status)}${s.finding ? ' is-finding' : ''}`}>
            <div className="stop-time">
              <time dateTime={r.timestamp}>{clockAt(tl.startIso, s.start)}</time>
              <span>+{elapsed(s.start)}</span>
            </div>
            <span className="stop-node" aria-hidden="true" />
            <div className="stop-body">
              <button type="button" className="stop-head" onClick={() => onSeek(s.finding ? s.revealAt : s.start, true)}>
                <span className="stop-n">Stop {s.index + 1}</span>
                <strong>{r.location.name}</strong>
                <span className="muted">{r.location.id} · Floor {r.location.floor}</span>
                <span className="sr-only">. Jump the replay here.</span>
              </button>
              <p className="stop-what">{didWhat(r.action_type, r.asset.name)}</p>
              <div className="stop-result">
                <Badge tone={tone(s.status)}>{RESULT[s.status]}</Badge>
                {r.reading && <span>{r.reading.label}: <b>{reading(r.reading)}</b></span>}
                {state === 'now' && <span className="stop-live">Happening now</span>}
                {state === 'next' && <span className="muted">Coming up</span>}
              </div>
              {s.finding ? (
                <div className="stop-finding">
                  <div>
                    <p className="stop-found">Found at <time>{clockAt(tl.startIso, s.revealAt)}</time></p>
                    <p>{r.explanation}</p>
                    <p className="next-step">Next step: {r.recommended_action}</p>
                  </div>
                  {r.evidence_image && (
                    <figure className="evidence stop-evidence">
                      <img src={assetUrl(r.evidence_image)} alt={`Reference picture for ${r.asset.name}`} loading="lazy" />
                      <figcaption>Reference image</figcaption>
                    </figure>
                  )}
                </div>
              ) : <p className="stop-note muted">{r.explanation}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/* ---------- the tab ---------- */

export default function Replay({ missionId, onMission }) {
  const missions = useApi('/missions');
  const list = missions.data || [];
  const id = list.some(m => m.mission_id === missionId) ? missionId : list[list.length - 1]?.mission_id;
  const detail = useApi(id ? `/missions/${id}` : null);
  const events = useApi(id ? `/missions/${id}/replay` : null);
  const waypoints = useApi('/waypoints');

  useEffect(() => { if (id && id !== missionId) onMission(id); }, [id, missionId, onMission]);

  // Only combine the two responses once both belong to the selected run.
  const tl = useMemo(() => {
    const d = detail.data, ev = events.data;
    if (!d || !ev || d.mission_id !== id) return null;
    const first = d.records[0]?.action_id;
    if (first && !ev.some(e => e.action_id === first)) return null;
    return buildTimeline(ev, d.records);
  }, [detail.data, events.data, id]);

  const [at, setAtState] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(60);
  const [pauseOnFindings, setPauseOnFindings] = useState(true);
  const [filter, setFilter] = useState('all');
  const atRef = useRef(0);
  const setAt = useCallback(v => { atRef.current = v; setAtState(v); }, []);

  // New run: rewind and wait for Play.
  useEffect(() => { setAt(0); setPlaying(false); }, [id, setAt]);

  const duration = tl?.duration || 0;
  useEffect(() => {
    if (!playing || !tl) return undefined;
    let raf, last = performance.now();
    const tick = now => {
      const prev = atRef.current;
      let next = Math.min(prev + (now - last) * speed, duration);
      last = now;
      let stop = next >= duration;
      const f = pauseOnFindings ? nextFindingAfter(tl, prev) : null;
      if (f && next >= f.revealAt) { next = f.revealAt; stop = true; }
      setAt(next);
      if (stop) setPlaying(false);
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, duration, pauseOnFindings, tl, setAt]);

  const seek = useCallback((v, pause = false) => {
    setAt(Math.max(0, Math.min(v, duration)));
    if (pause) setPlaying(false);
  }, [duration, setAt]);

  function togglePlay() {
    if (!tl) return;
    if (!playing && atRef.current >= duration) setAt(0);
    setPlaying(p => !p);
  }
  function stepStop(dir) {
    if (!tl) return;
    const cur = atRef.current;
    if (dir < 0) {
      const prev = [...tl.stops].reverse().find(s => s.start < cur - 1500);
      seek(prev ? prev.start : 0, true);
    } else {
      const next = tl.stops.find(s => s.start > cur + 1);
      seek(next ? next.start : duration, true);
    }
  }

  const now = tl ? stateAt(tl, at) : null;
  const mission = detail.data && detail.data.mission_id === id ? detail.data : list.find(m => m.mission_id === id);
  const announce = now ? `${now.phase === 'done' ? 'Run finished' : now.current ? `${now.phase === 'walking' ? 'Walking to' : 'At'} ${now.current.record?.location.name || now.current.loc.id}` : ''}` : '';

  return (
    <>
      <header className="page-head">
        <div>
          <p className="eyebrow">Mission replay</p>
          <h1>Replay a run</h1>
          <p className="lead">Pick a run and press play to follow Spot stop by stop. Anything it found is pinned to the timeline with the time it happened.</p>
        </div>
      </header>

      <Section className="replay-runs" id="replay-runs">
        <Async state={missions} empty="No runs recorded yet. They appear here as soon as Spot sends one.">
          {ms => <RunRail missions={ms} selected={id} onSelect={onMission} />}
        </Async>
      </Section>

      {mission && (
        <Section eyebrow={`${mission.mission_id} · ${mission.configuration_version === 'V2' ? 'Improved setup (V2)' : 'Baseline setup (V1)'}`} title={mission.mission_name} id="replay-run">
          <div className="stat-grid replay-stats">
            <Stat label="Started" value={mission.start_time.slice(11, 16)} sub={dayLabel(mission.start_time)} />
            <Stat label="Length" value={`${mission.duration_min} min`} sub={plural(mission.actions, 'stop')} />
            <Stat
              label="Findings"
              value={findingsOf(mission)}
              sub={mission.status_counts?.action ? `${mission.status_counts.action} need action` : findingsOf(mission) ? 'Keep an eye on' : 'All good'}
              tone={mission.status_counts?.action ? 'bad' : findingsOf(mission) ? 'warn' : 'ok'}
            />
            <Stat label="Battery" value={`${mission.start_battery_pct}% → ${mission.end_battery_pct}%`} sub={`${mission.start_battery_pct - mission.end_battery_pct}% used`} />
            <Stat label="Result" value={mission.mission_status === 'FAILED' ? 'Stopped early' : 'Finished'} tone={mission.mission_status === 'FAILED' ? 'bad' : undefined} />
          </div>

          {!tl ? (
            (detail.error || events.error)
              ? <Async state={detail.error ? detail : events}>{() => null}</Async>
              : <div className="skeleton player-skeleton" aria-busy="true" aria-label="Loading replay" />
          ) : (
            <div className="player">
              <div className="player-map">
                <Async state={waypoints}>{wps => <ReplayMap waypoints={wps} tl={tl} now={now} at={at} />}</Async>
              </div>
              <div className="player-now" aria-label="What Spot is doing">
                <NowCard tl={tl} now={now} at={at} mission={mission} onRestart={() => { setAt(0); setPlaying(true); }} />
              </div>

              <div className="player-transport">
                <div className="controls" role="group" aria-label="Replay controls">
                  <button type="button" className="icon-btn" onClick={() => seek(0, true)} aria-label="Back to the start" title="Back to the start">
                    <Icon d="M5 5v14M19 5 8 12l11 7z" />
                  </button>
                  <button type="button" className="icon-btn" onClick={() => stepStop(-1)} aria-label="Previous stop" title="Previous stop">
                    <Icon d="M16 5 7 12l9 7z" />
                  </button>
                  <button type="button" className={`hex-play${playing ? ' is-playing' : ''}`} onClick={togglePlay} aria-label={playing ? 'Pause' : at >= duration ? 'Play again' : 'Play'}>
                    <svg viewBox="0 0 56 56" aria-hidden="true">
                      <polygon className="hex" points="14,3 42,3 55,28 42,53 14,53 1,28" />
                      {playing ? <path className="glyph" d="M22 19v18M34 19v18" /> : <path className="glyph glyph-fill" d="M23 18l15 10-15 10z" />}
                    </svg>
                  </button>
                  <button type="button" className="icon-btn" onClick={() => stepStop(1)} aria-label="Next stop" title="Next stop">
                    <Icon d="M8 5l9 7-9 7z" />
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => seek(duration, true)}>Show full run</button>
                  <div className="controls-right">
                    <Segmented label="Speed" options={SPEEDS} value={speed} onChange={setSpeed} />
                    <label className="check">
                      <input type="checkbox" checked={pauseOnFindings} onChange={e => setPauseOnFindings(e.target.checked)} />
                      Pause at each finding
                    </label>
                  </div>
                </div>
                <p className="controls-hint muted">{speed}× speed: every second on screen is {SPEED_WORDS[speed]} of the real run. Click a flag to jump to that finding.</p>
                <Track tl={tl} at={at} onSeek={seek} />
              </div>
              <p className="sr-only" aria-live="polite">{announce}</p>
            </div>
          )}
        </Section>
      )}

      {tl && (
        <Section
          eyebrow="Stop by stop"
          title="What Spot did"
          id="replay-stops"
          actions={<Segmented label="Show" options={[['all', 'All stops'], ['findings', `Findings only (${tl.findings.length})`]]} value={filter} onChange={setFilter} />}
        >
          <StopList tl={tl} at={at} filter={filter} onSeek={seek} />
        </Section>
      )}
    </>
  );
}
