// Turns GET /missions/{id}/replay events + the mission's Inspection Records into a playable timeline.
// Pure functions, so the Replay tab only has to move a time cursor (ms since the mission started).

const ms = iso => Date.parse(iso);

/** Plain-language verb for what Spot did at a stop. */
const DOING = {
  NAVIGATION: 'Walked to',
  VISUAL_INSPECTION: 'Photographed',
  THERMAL_INSPECTION: 'Checked the temperature of',
  ACOUSTIC_INSPECTION: 'Listened to',
  GAUGE_READING: 'Read the gauge on',
};
const DOING_NOW = {
  NAVIGATION: 'Walking to',
  VISUAL_INSPECTION: 'Photographing',
  THERMAL_INSPECTION: 'Checking the temperature of',
  ACOUSTIC_INSPECTION: 'Listening to',
  GAUGE_READING: 'Reading the gauge on',
};
const NEXT = {
  NAVIGATION: 'Walk to',
  VISUAL_INSPECTION: 'Photograph',
  THERMAL_INSPECTION: 'Check the temperature of',
  ACOUSTIC_INSPECTION: 'Listen to',
  GAUGE_READING: 'Read the gauge on',
};
export const didWhat = (actionType, asset) => `${DOING[actionType] || 'Inspected'} ${asset}`;
export const nextWhat = (actionType, asset) => `${NEXT[actionType] || 'Inspect'} ${asset}`;
export const doingWhat = (actionType, asset) => `${DOING_NOW[actionType] || 'Inspecting'} ${asset}`;

/** Operator wording for a record status. */
export const RESULT = { normal: 'All good', watch: 'Keep an eye on it', action: 'Needs action' };

/**
 * events: replay events (sorted by t). records: the mission's Inspection Records.
 * Returns { startIso, duration, stops[], findings[], battery[], endType }.
 * Each stop: { index, id, record, start, end, revealAt, finding, status, loc }, times in ms from the start.
 */
export function buildTimeline(events, records) {
  if (!events?.length) return null;
  const startIso = events[0].t;
  const t0 = ms(startIso);
  const byAction = new Map((records || []).map(r => [r.action_id, r]));
  const stops = [];
  const open = new Map();
  const battery = [{ at: 0, pct: events[0].battery_pct }];

  for (const e of events) {
    const at = ms(e.t) - t0;
    if (e.type === 'ACTION_STARTED') {
      const record = byAction.get(e.action_id);
      const stop = {
        index: stops.length, id: e.action_id, record, start: at, end: at, revealAt: at,
        anomalyAt: null, status: record?.status || e.status || 'normal',
        loc: { id: e.location_id, x: e.x, y: e.y, floor: e.floor },
      };
      stops.push(stop);
      open.set(e.action_id, stop);
      if (e.battery_pct !== null && e.battery_pct !== undefined) battery.push({ at, pct: e.battery_pct });
    } else if (e.type === 'ANOMALY_DETECTED') {
      const stop = open.get(e.action_id);
      if (stop) stop.anomalyAt = at;
    } else if (e.type === 'ACTION_COMPLETED' || e.type === 'ACTION_FAILED') {
      const stop = open.get(e.action_id);
      if (stop) {
        stop.end = Math.max(at, stop.start);
        stop.revealAt = stop.anomalyAt ?? stop.end;
        if (!stop.record) stop.status = e.status || stop.status;
      }
    }
  }
  const last = events[events.length - 1];
  const duration = Math.max(ms(last.t) - t0, ...stops.map(s => s.end), 1);
  if (last.battery_pct !== null && last.battery_pct !== undefined) battery.push({ at: duration, pct: last.battery_pct });
  for (const s of stops) s.finding = s.status !== 'normal';

  return {
    startIso, duration, stops, battery,
    findings: stops.filter(s => s.finding),
    endType: String(last.type || '').startsWith('MISSION_') ? last.type.slice(8) : 'COMPLETED',
  };
}

function lerp(a, b, f) { return a + (b - a) * f; }

/** Where Spot is and what it is doing at `at` ms. */
export function stateAt(tl, at) {
  const { stops } = tl;
  let i = -1;
  for (let k = 0; k < stops.length; k++) if (stops[k].start <= at) i = k;

  let phase, current, position;
  if (at >= tl.duration && i !== -1) {
    phase = 'done';
    current = stops[i];
    position = current.loc;
  } else if (i === -1) {
    phase = stops.length ? 'starting' : 'done';
    current = stops[0] || null;
    position = current?.loc || null;
  } else if (at <= stops[i].end) {
    // Inclusive end: seeking to a finding (revealed at the stop's end) shows that stop and its result.
    phase = 'inspecting';
    current = stops[i];
    position = current.loc;
  } else if (i < stops.length - 1) {
    // Between stops: walk in a straight line on the same floor, switch floors halfway otherwise.
    phase = 'walking';
    const from = stops[i], to = stops[i + 1];
    current = to;
    const span = Math.max(to.start - from.end, 1);
    const f = Math.min(1, Math.max(0, (at - from.end) / span));
    position = from.loc.floor === to.loc.floor
      ? { floor: from.loc.floor, x: lerp(from.loc.x, to.loc.x, f), y: lerp(from.loc.y, to.loc.y, f) }
      : (f < 0.5 ? from.loc : to.loc);
  } else {
    phase = 'finishing';
    current = stops[i];
    position = current.loc;
  }

  return {
    phase, current, position,
    battery: batteryAt(tl.battery, at),
    revealed: stops.filter(s => s.revealAt <= at).length,
    findingsSoFar: tl.findings.filter(s => s.revealAt <= at).length,
  };
}

export function batteryAt(points, at) {
  if (!points.length) return null;
  let prev = points[0];
  for (const p of points) {
    if (p.at >= at) {
      if (p.at === prev.at) return p.pct;
      return Math.round(lerp(prev.pct, p.pct, (at - prev.at) / (p.at - prev.at)));
    }
    prev = p;
  }
  return prev.pct;
}

/** The next finding revealed strictly after `at`, or null. */
export const nextFindingAfter = (tl, at) => tl.findings.find(s => s.revealAt > at) || null;

const pad = n => String(n).padStart(2, '0');

/** Elapsed time as "+MM:SS" (or "+H:MM:SS"). */
export function elapsed(msValue) {
  const total = Math.max(0, Math.floor(msValue / 1000));
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** Wall-clock "HH:MM:SS" for the mission start plus an offset. Timestamps are plant-local with no zone. */
export function clockAt(startIso, offset = 0) {
  const d = new Date(ms(startIso) + offset);
  return Number.isNaN(d.getTime()) ? '—' : `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function dayLabel(iso) {
  const d = new Date(ms(iso));
  // English to match the rest of the UI copy, and short enough to fit one line on a run tile.
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}
