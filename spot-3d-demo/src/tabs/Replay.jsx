import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { asset as assetUrl, useApi } from '../api.js';
import { Async, Badge, Battery, Empty, Section, Segmented, Stat, ZoomImg } from '../components/ui.jsx';
import { batteryLevel, humanize, reading, tone } from '../lib/format.js';
import {
  RESULT, buildTimeline, clockAt, dayLabel, didWhat, doingWhat, elapsed, flagLanes, labelSides, nextFindingAfter, nextWhat, stateAt, stopAt,
} from '../lib/replay.js';
import { isTypingTarget, scrollBehavior, scrollToEl } from '../lib/dom.js';
import { useSessionState } from '../lib/session.js';

// Playback speed: how many seconds of the real run pass per second on screen.
const SPEEDS = [[30, '30×'], [60, '60×'], [120, '120×']];
const SPEED_WORDS = { 30: '30 seconds', 60: 'one minute', 120: 'two minutes' };
const FLOORS = [1, 2];
const findingsOf = m => (m.status_counts?.watch || 0) + (m.status_counts?.action || 0);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const findingWhat = s => {
  const r = s.record;
  return r ? (r.anomaly ? humanize(r.anomaly.type) : r.failure_type ? humanize(r.failure_type) : r.asset.name) : s.loc.id;
};

/* ---------- run picker ---------- */

function RunRail({ missions, selected, onSelect }) {
  const rail = useRef(null);
  const [edges, setEdges] = useState({ start: true, end: true });
  const latest = missions[missions.length - 1]?.mission_id;
  const measure = useCallback(() => {
    const r = rail.current;
    if (!r) return;
    setEdges({ start: r.scrollLeft <= 2, end: r.scrollLeft + r.clientWidth >= r.scrollWidth - 2 });
  }, []);
  // Keep the selected run in view by scrolling the rail only (never the page).
  useEffect(() => {
    const r = rail.current;
    const el = r?.querySelector('[aria-pressed="true"]');
    if (el) r.scrollTo({ left: el.offsetLeft - r.clientWidth / 2 + el.clientWidth / 2, behavior: scrollBehavior() });
    measure();
  }, [selected, missions.length, measure]);
  useEffect(() => {
    const ro = new ResizeObserver(measure);
    if (rail.current) ro.observe(rail.current);
    return () => ro.disconnect();
  }, [measure]);
  const page = dir => rail.current?.scrollBy({ left: dir * rail.current.clientWidth * 0.8, behavior: scrollBehavior() });

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
      <div className={`rail-wrap${edges.start ? '' : ' has-before'}${edges.end ? '' : ' has-after'}`}>
        <button type="button" className="rail-arrow rail-prev" onClick={() => page(-1)} disabled={edges.start} aria-label="Earlier runs">‹</button>
        <ol className="run-rail" ref={rail} aria-label="Recorded runs" onScroll={measure}>
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
        <button type="button" className="rail-arrow rail-next" onClick={() => page(1)} disabled={edges.end} aria-label="Later runs">›</button>
      </div>
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

function ReplayMap({ waypoints, tl, now, at, onSeek }) {
  const visited = tl.stops.filter(s => s.start <= at);
  const statusAt = {};
  const firstVisit = {};
  const RANK = { normal: 0, watch: 1, action: 2 };
  for (const s of tl.stops) {
    if (!statusAt[s.loc.id]) statusAt[s.loc.id] = 'pending';
    if (!firstVisit[s.loc.id]) firstVisit[s.loc.id] = s;
    if (s.revealAt <= at) {
      const prev = statusAt[s.loc.id];
      if (prev === 'pending' || RANK[s.status] > RANK[prev]) statusAt[s.loc.id] = s.status;
    }
  }
  const planned = tl.stops.map(s => s.loc);
  const walked = [...visited.map(s => s.loc), ...(now.position && now.phase === 'walking' ? [now.position] : [])];
  const floorOf = now.position?.floor ?? 1;
  const sides = useMemo(() => Object.assign({}, ...FLOORS.map(f => labelSides(waypoints.filter(w => w.floor === f)))), [waypoints]);

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
                const cls = `rmap-wp side-${sides[w.id] || 'below'} ${!st ? 'is-off' : st === 'pending' ? 'is-pending' : `is-seen sev-${tone(st)}`}`;
                const style = { left: `${w.x}%`, top: `${100 - w.y}%` };
                const first = firstVisit[w.id];
                const inner = (
                  <>
                    <i aria-hidden="true" />
                    <span className="rmap-id">{w.id}</span>
                    <span className="rmap-name" aria-hidden="true">{w.id} · {w.name}</span>
                  </>
                );
                // Waypoints on this run jump to Spot's first visit; the rest just show their name on hover.
                return first ? (
                  <button
                    key={w.id}
                    type="button"
                    className={cls}
                    style={style}
                    onClick={() => onSeek(first.start, true)}
                    aria-label={`${w.id} ${w.name}${st && st !== 'pending' ? `, ${RESULT[st]}` : ', not checked yet'}. Jump to stop ${first.index + 1}.`}
                  >{inner}</button>
                ) : (
                  <span key={w.id} className={cls} style={style} title={`${w.id} ${w.name} (not on this run)`}>{inner}</span>
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

const PLAY_STATE = {
  playing: ['Playing', 'is-playing'],
  finding: ['Paused at a finding', 'is-finding'],
  paused: ['Paused', 'is-paused'],
  ready: ['Ready to play', 'is-paused'],
  done: ['Finished', 'is-done'],
};

function NowCard({ tl, now, at, mission, playing, playState, onRestart }) {
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
  const [stateLabel, stateCls] = PLAY_STATE[playState];

  return (
    <div className={`now${shown && s.finding && !done ? ` now-finding sev-${tone(s.status)}` : ''}`}>
      <div className="now-clock">
        <div className="now-clock-top">
          <span className="now-time">{clockAt(tl.startIso, at)}</span>
          {/* Whether the playback is moving, separate from what the robot was doing at that moment. */}
          <span className={`play-state ${stateCls}`}><i aria-hidden="true" />{stateLabel}</span>
        </div>
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
        <div className={`meter batt-${batteryLevel(now.battery)}${playing ? ' is-live' : ''}`}>
          <span className="meter-label">Battery</span>
          <span className="meter-track"><span style={{ width: `${now.battery ?? 0}%` }} /></span>
          <span className="meter-value"><Battery pct={now.battery} /></span>
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

const LANE_STEP = 34;

function Track({ tl, at, onSeek }) {
  const p = v => `${(v / tl.duration) * 100}%`;
  const stopNo = tl.stops.filter(s => s.start <= at).length;
  const box = useRef(null);
  const [width, setWidth] = useState(0);
  const [compact, setCompact] = useState(false);
  const [hover, setHover] = useState(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    const set = () => { setWidth(el.clientWidth); setCompact(window.matchMedia('(max-width: 760px)').matches); };
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Estimated label widths (time + short description; time only on small screens) → non-overlapping lanes.
  const lanes = useMemo(() => {
    if (!width) return tl.findings.map((_, i) => i % 2);
    const items = tl.findings.map(s => ({
      pos: s.revealAt / tl.duration,
      w: compact ? 66 : Math.max(66, findingWhat(s).length * 7.4 + 20),
    }));
    return flagLanes(items, width, compact ? 3 : 4);
  }, [tl, width, compact]);
  const laneCount = Math.max(1, ...lanes.map(l => l + 1));
  const step = compact ? 26 : LANE_STEP;

  function preview(e) {
    const r = e.currentTarget.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    setHover(f * tl.duration);
  }
  const hoverStop = hover === null ? null : stopAt(tl, hover);

  return (
    <div className="track" ref={box}>
      <div className="track-flags" aria-label="Findings on this run" style={{ height: 18 + (laneCount - 1) * step + 44 }}>
        {tl.findings.map((s, i) => {
          const pos = s.revealAt / tl.duration;
          const r = s.record;
          return (
            <button
              key={s.id}
              type="button"
              className={`flag sev-${tone(s.status)}${pos > 0.8 ? ' is-right' : pos < 0.2 ? ' is-left' : ''}${s.revealAt <= at ? ' is-seen' : ''}`}
              style={{ left: p(s.revealAt), height: 18 + lanes[i] * step }}
              onClick={() => onSeek(s.revealAt, true)}
              aria-label={`Finding at ${clockAt(tl.startIso, s.revealAt)}: ${RESULT[s.status]}, ${r?.asset.name || ''} at ${r?.location.name || s.loc.id}. Jump here.`}
            >
              <span className="flag-label">
                <span className="flag-time">{clockAt(tl.startIso, s.revealAt)}</span>
                <span className="flag-what">{findingWhat(s)}</span>
              </span>
            </button>
          );
        })}
      </div>
      <div className="track-scrub" onPointerMove={preview} onPointerLeave={() => setHover(null)}>
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
          {hover !== null && <span className="track-ghost" style={{ left: p(hover) }} />}
        </div>
        {hover !== null && (
          <span className={`scrub-tip${hover / tl.duration > 0.85 ? ' is-right' : hover / tl.duration < 0.15 ? ' is-left' : ''}`} style={{ left: p(hover) }} aria-hidden="true">
            <b>{clockAt(tl.startIso, hover)}</b>
            {hoverStop?.record && <span>Stop {hoverStop.index + 1} · {hoverStop.record.location.name}</span>}
          </span>
        )}
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

function PlayButton({ playing, at, duration, onClick, small = false }) {
  return (
    <button type="button" className={`hex-play${playing ? ' is-playing' : ''}${small ? ' hex-play-sm' : ''}`} onClick={onClick} aria-label={playing ? 'Pause' : at >= duration ? 'Play again' : 'Play'}>
      <svg viewBox="0 0 56 56" aria-hidden="true">
        <polygon className="hex" points="14,3 42,3 55,28 42,53 14,53 1,28" />
        {playing ? <path className="glyph" d="M22 19v18M34 19v18" /> : <path className="glyph glyph-fill" d="M23 18l15 10-15 10z" />}
      </svg>
    </button>
  );
}

/** Compact transport that appears once the main player has scrolled out of view. */
function MiniPlayer({ tl, at, playing, playState, onToggle, onBack }) {
  const s = stopAt(tl, at);
  return (
    <div className="mini-player" role="region" aria-label="Replay controls (compact)">
      <PlayButton playing={playing} at={at} duration={tl.duration} onClick={onToggle} small />
      <span className="mini-time">{clockAt(tl.startIso, at)}</span>
      <span className="mini-where muted">{PLAY_STATE[playState][0]} · stop {s ? s.index + 1 : 0} of {tl.stops.length}{s?.record ? ` · ${s.record.location.name}` : ''}</span>
      <span className="mini-progress" aria-hidden="true"><span style={{ width: `${(at / tl.duration) * 100}%` }} /></span>
      <button type="button" className="btn btn-ghost btn-sm" onClick={onBack}>Back to player ↑</button>
    </div>
  );
}

/* ---------- stop-by-stop list ---------- */

function StopList({ tl, at, filter, onSeek, onView, onShowAll }) {
  const stops = filter === 'findings' ? tl.findings : tl.stops;
  if (!stops.length) {
    return (
      <Empty action={<button type="button" className="btn btn-ghost btn-sm" onClick={onShowAll}>Show all stops</button>}>
        No findings on this run. Every stop looked normal.
      </Empty>
    );
  }
  return (
    <ol className="stops">
      {stops.map(s => {
        const r = s.record;
        const state = at >= s.end && s.revealAt <= at ? 'done' : at >= s.start ? 'now' : 'next';
        if (!r) return null;
        const target = s.finding ? s.revealAt : s.start;
        return (
          <li key={s.id} className={`stop stop-${state} sev-${tone(s.status)}${s.finding ? ' is-finding' : ''}`}>
            <div className="stop-time">
              <time dateTime={r.timestamp}>{clockAt(tl.startIso, s.start)}</time>
              <span>+{elapsed(s.start)}</span>
            </div>
            <span className="stop-node" aria-hidden="true" />
            <div className="stop-body">
              <button type="button" className="stop-head" onClick={() => onSeek(target, true)}>
                <span className="stop-n">Stop {s.index + 1}</span>
                <strong>{r.location.name}</strong>
                <span className="muted">{r.location.id} · Floor {r.location.floor}</span>
                <span className="sr-only">. Move the replay here.</span>
              </button>
              <p className="stop-what">{didWhat(r.action_type, r.asset.name)}</p>
              <div className="stop-result">
                <Badge tone={tone(s.status)}>{RESULT[s.status]}</Badge>
                {r.reading && <span>{r.reading.label}: <b>{reading(r.reading)}</b></span>}
                {state === 'now' && <span className="stop-live">Happening now</span>}
                {state === 'next' && <span className="muted">Coming up</span>}
                <button type="button" className="btn btn-ghost btn-sm stop-view" onClick={() => onView(target)}>
                  View in player ↑<span className="sr-only"> (stop {s.index + 1})</span>
                </button>
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
                      <ZoomImg src={assetUrl(r.evidence_image)} alt={`Reference picture for ${r.asset.name}`} loading="lazy" />
                      <figcaption>Reference image · click to enlarge</figcaption>
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
  // Remembered for this visit, so switching tabs and coming back keeps them.
  const [speed, setSpeed] = useSessionState('spot.replay.speed', 60);
  const [pauseOnFindings, setPauseOnFindings] = useSessionState('spot.replay.pauseOnFindings', true);
  const [filter, setFilter] = useSessionState('spot.replay.filter', 'all');
  const [pausedAt, setPausedAt] = useState(null);
  const [playerOut, setPlayerOut] = useState(false);
  const atRef = useRef(0);
  const player = useRef(null);
  const setAt = useCallback(v => { atRef.current = v; setAtState(v); }, []);

  // New run: rewind and wait for Play.
  useEffect(() => { setAt(0); setPlaying(false); setPausedAt(null); }, [id, setAt]);

  const duration = tl?.duration || 0;
  useEffect(() => {
    if (!playing || !tl) return undefined;
    let raf, last = performance.now();
    // Where playback resumed from: a finding we're already paused on must not stop us again.
    const from = atRef.current;
    const tick = now => {
      const prev = atRef.current;
      // rAF timestamps are frame-start times and can be earlier than `last`; never step backwards.
      const dt = Math.max(0, now - last);
      let next = Math.min(prev + dt * speed, duration);
      last = Math.max(last, now);
      let stop = next >= duration;
      const f = pauseOnFindings ? nextFindingAfter(tl, Math.max(prev, from)) : null;
      if (f && next >= f.revealAt) { next = f.revealAt; stop = true; setPausedAt(f); }
      setAt(next);
      if (stop) setPlaying(false);
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, duration, pauseOnFindings, tl, setAt]);

  const seek = useCallback((v, pause = false) => {
    setAt(Math.max(0, Math.min(v, duration)));
    setPausedAt(null);
    if (pause) setPlaying(false);
  }, [duration, setAt]);

  function togglePlay() {
    if (!tl) return;
    if (!playing && atRef.current >= duration) setAt(0);
    setPausedAt(null);
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
  const toPlayer = () => scrollToEl(player.current);
  function viewInPlayer(t) {
    seek(t, true);
    toPlayer();
  }

  // Compact controls once the player has scrolled up out of view.
  useEffect(() => {
    const el = player.current;
    if (!el) { setPlayerOut(false); return undefined; }
    const io = new IntersectionObserver(([e]) => setPlayerOut(!e.isIntersecting && e.boundingClientRect.bottom < 0));
    io.observe(el);
    return () => io.disconnect();
  }, [tl]);

  // Keyboard shortcuts while this tab is open: Space / K play-pause, ← / → previous / next stop.
  // Skipped while typing, inside dialogs, with modifier keys, and Space on a focused button keeps its normal meaning.
  const keys = useRef({});
  keys.current = { togglePlay, stepStop };
  useEffect(() => {
    if (!tl) return undefined;
    const onKey = e => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || isTypingTarget(e.target)) return;
      const onControl = e.target instanceof Element && e.target.closest('button, a, summary');
      if ((e.key === ' ' && !onControl) || e.key === 'k' || e.key === 'K') { e.preventDefault(); keys.current.togglePlay(); }
      else if (e.key === 'ArrowLeft' || e.key === 'j' || e.key === 'J') { e.preventDefault(); keys.current.stepStop(-1); }
      else if (e.key === 'ArrowRight' || e.key === 'l' || e.key === 'L') { e.preventDefault(); keys.current.stepStop(1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tl]);

  const now = tl ? stateAt(tl, at) : null;
  const mission = detail.data && detail.data.mission_id === id ? detail.data : list.find(m => m.mission_id === id);
  const playState = playing ? 'playing' : tl && at >= duration ? 'done' : pausedAt ? 'finding' : at === 0 ? 'ready' : 'paused';
  const announce = now ? `${now.phase === 'done' ? 'Run finished' : now.current ? `${now.phase === 'walking' ? 'Walking to' : 'At'} ${now.current.record?.location.name || now.current.loc.id}` : ''}` : '';
  const failedChecks = mission?.failed_actions || 0;
  const nFindings = mission ? findingsOf(mission) : 0;

  return (
    <>
      <header className="page-head replay-head">
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
        <Section className="replay-run" eyebrow={`${mission.mission_id} · ${mission.configuration_version === 'V2' ? 'Improved setup (V2)' : 'Baseline setup (V1)'}`} title={mission.mission_name} id="replay-run">
          <div className="stat-grid replay-stats">
            <Stat label="Started" value={mission.start_time.slice(11, 16)} sub={dayLabel(mission.start_time)} />
            <Stat label="Length" value={`${mission.duration_min} min`} sub={plural(mission.actions, 'stop')} />
            <Stat
              label="Findings"
              value={nFindings}
              sub={mission.status_counts?.action ? `${mission.status_counts.action} need action` : nFindings ? 'Keep an eye on' : 'All good'}
              tone={mission.status_counts?.action ? 'bad' : nFindings ? 'warn' : 'ok'}
              onClick={nFindings && tl ? () => { setFilter('findings'); scrollToEl('replay-stops'); } : undefined}
              action="Show only the findings in the stop list"
            />
            <Stat label="Battery" value={`${mission.start_battery_pct}% → ${mission.end_battery_pct}%`} sub={`${mission.start_battery_pct - mission.end_battery_pct}% used`} />
            <Stat
              label="Result"
              value={mission.mission_status === 'FAILED' ? 'Stopped early' : 'Finished'}
              sub={failedChecks ? plural(failedChecks, 'failed check') : 'Every check completed'}
              tone={mission.mission_status === 'FAILED' ? 'bad' : failedChecks ? 'warn' : undefined}
            />
          </div>

          {!tl ? (
            (detail.error || events.error)
              ? <Async state={detail.error ? detail : events}>{() => null}</Async>
              : <div className="skeleton player-skeleton" aria-busy="true" aria-label="Loading replay" />
          ) : (
            <div className="player" id="replay-player" ref={player}>
              <div className="player-map">
                <Async state={waypoints}>{wps => <ReplayMap waypoints={wps} tl={tl} now={now} at={at} onSeek={seek} />}</Async>
              </div>
              <div className="player-now" aria-label="What Spot is doing">
                <NowCard tl={tl} now={now} at={at} mission={mission} playing={playing} playState={playState} onRestart={() => { setAt(0); setPausedAt(null); setPlaying(true); }} />
              </div>

              <div className="player-transport">
                {pausedAt && !playing && (
                  <div className={`pause-note sev-${tone(pausedAt.status)}`} role="status">
                    <p>
                      <strong>Paused at a finding</strong>
                      <span className="muted"> · {findingWhat(pausedAt)} at {pausedAt.record?.location.name || pausedAt.loc.id}, {clockAt(tl.startIso, pausedAt.revealAt)}</span>
                    </p>
                    <button type="button" className="btn btn-accent btn-sm" onClick={togglePlay}>Resume ▶</button>
                  </div>
                )}
                <div className="controls" role="group" aria-label="Replay controls">
                  <button type="button" className="icon-btn" onClick={() => seek(0, true)} aria-label="Back to the start" title="Back to the start">
                    <Icon d="M5 5v14M19 5 8 12l11 7z" />
                  </button>
                  <button type="button" className="icon-btn" onClick={() => stepStop(-1)} aria-label="Previous stop" title="Previous stop (←)">
                    <Icon d="M16 5 7 12l9 7z" />
                  </button>
                  <PlayButton playing={playing} at={at} duration={duration} onClick={togglePlay} />
                  <button type="button" className="icon-btn" onClick={() => stepStop(1)} aria-label="Next stop" title="Next stop (→)">
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
                <p className="controls-hint muted">
                  {speed}× speed: every second on screen is {SPEED_WORDS[speed]} of the real run. Click a flag to jump to that finding.
                  <span className="kbd-hint"> Keys: <kbd>Space</kbd> play/pause · <kbd>←</kbd> <kbd>→</kbd> previous/next stop.</span>
                </p>
                <Track tl={tl} at={at} onSeek={seek} />
              </div>
              <p className="sr-only" aria-live="polite">{announce}{pausedAt && !playing ? '. Paused at a finding.' : ''}</p>
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
          <StopList tl={tl} at={at} filter={filter} onSeek={seek} onView={viewInPlayer} onShowAll={() => setFilter('all')} />
        </Section>
      )}

      {tl && playerOut && (
        <MiniPlayer tl={tl} at={at} playing={playing} playState={playState} onToggle={togglePlay} onBack={toPlayer} />
      )}
    </>
  );
}
