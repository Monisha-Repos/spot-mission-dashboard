/**
 * Pure live-event reducer. It receives only events, never archived data.
 * Source timestamps remain unchanged. Input order breaks equal-time ties.
 * Extension events are application-defined: READING_CAPTURED / ANOMALY_DETECTED.
 */
import { classifyAction, recommendNextStep } from './engine.js';

const TYPES = new Set(['MISSION_STARTED', 'MISSION_COMPLETED', 'ACTION_STARTED', 'ACTION_COMPLETED', 'ACTION_FAILED', 'READING_CAPTURED', 'ANOMALY_DETECTED']);
const TERMINAL = new Set(['SUCCESS', 'FAILED']);
const QUALITIES = new Set(['GOOD', 'QUESTIONABLE', 'UNSPECIFIED']);
const SEVERITIES = new Set(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
const isString = value => typeof value === 'string' && value.trim().length > 0;
const stableJson = value => value === null || typeof value !== 'object' ? JSON.stringify(value)
  : Array.isArray(value) ? `[${value.map(stableJson).join(',')}]`
    : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;

// Unzoned timestamps use a neutral UTC axis for ordering only; no source zone is asserted.
const timeValue = timestamp => Date.parse(/[zZ]$|[+-]\d{2}:?\d{2}$/.test(timestamp) ? timestamp : `${timestamp}Z`);
const laterThan = (left, right) => !right || timeValue(left) > timeValue(right);
const olderThan = (left, right) => Boolean(right) && timeValue(left) < timeValue(right);

function validTimestamp(timestamp) {
  const match = timestamp.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[zZ]|[+-](\d{2}):?(\d{2}))?$/);
  if (!match || timestamp !== timestamp.trim()) return false;
  const [, year, month, day, hour, minute, second, offsetHour = '00', offsetMinute = '00'] = match.map((value, index) => index === 0 ? value : Number(value || 0));
  if (year < 1 || month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysInMonth[month - 1] && Number.isFinite(timeValue(timestamp));
}

function invalidReason(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return 'Event must be an object.';
  for (const field of ['event_id', 'mission_id', 'timestamp', 'event_type']) if (!isString(event[field])) return `Missing or invalid ${field}.`;
  if (!validTimestamp(event.timestamp)) return 'Timestamp must be a valid ISO date and time.';
  if (!TYPES.has(event.event_type)) return `Unsupported event type ${event.event_type}.`;
  const details = event.details;
  if (!details || typeof details !== 'object' || Array.isArray(details)) return 'details must be an object.';
  if (event.synthetic !== undefined && typeof event.synthetic !== 'boolean') return 'synthetic must be a Boolean when supplied.';
  if (!event.event_type.startsWith('MISSION_') && !isString(details.action_id)) return 'Missing action_id.';
  for (const field of ['asset_id', 'location_id', 'action_id', 'action_type', 'reading_id', 'anomaly_id', 'measurement_type', 'unit', 'anomaly_type', 'description']) if (details[field] !== undefined && !isString(details[field])) return `Invalid ${field}.`;
  if (details.failure_type !== undefined && typeof details.failure_type !== 'string') return 'failure_type must be a string.';
  if (details.battery_pct !== undefined && (!Number.isFinite(details.battery_pct) || details.battery_pct < 0 || details.battery_pct > 100)) return 'battery_pct must be between 0 and 100.';
  if (details.end_battery_pct !== undefined && (!Number.isFinite(details.end_battery_pct) || details.end_battery_pct < 0 || details.end_battery_pct > 100)) return 'end_battery_pct must be between 0 and 100.';
  if (event.event_type === 'ACTION_COMPLETED' && details.status !== undefined && details.status !== 'SUCCESS') return 'ACTION_COMPLETED status must be SUCCESS when supplied.';
  if (event.event_type === 'ACTION_FAILED' && details.status !== undefined && details.status !== 'FAILED') return 'ACTION_FAILED status must be FAILED when supplied.';
  if (event.event_type === 'MISSION_COMPLETED' && details.status !== undefined && !['COMPLETED', 'FAILED'].includes(details.status)) return 'MISSION_COMPLETED status must be COMPLETED or FAILED.';
  if (event.event_type === 'READING_CAPTURED') {
    for (const field of ['reading_id', 'measurement_type', 'unit']) if (!isString(details[field])) return `Missing or invalid ${field}.`;
    if (!Number.isFinite(details.value)) return 'Reading value must be a finite number.';
    if (!QUALITIES.has(details.quality)) return 'Reading quality must be GOOD, QUESTIONABLE or UNSPECIFIED.';
  }
  if (event.event_type === 'ANOMALY_DETECTED') {
    for (const field of ['anomaly_id', 'anomaly_type', 'description']) if (!isString(details[field])) return `Missing or invalid ${field}.`;
    if (!SEVERITIES.has(details.severity)) return 'Anomaly severity must be LOW, MEDIUM, HIGH or CRITICAL.';
    if (typeof details.operator_review_required !== 'boolean') return 'operator_review_required must be a Boolean.';
  }
  return null;
}

/** Same constrained schema used before imported/SSE events reach the display. */
export function validateLiveEvent(event) {
  const error = invalidReason(event);
  return { valid: error === null, error };
}

function newMission(event, order) {
  return {
    mission_id: event.mission_id, status: 'UNKNOWN', batteryPct: null,
    timestamp: event.timestamp, lastTimestamp: event.timestamp, lastOrder: order,
    started: false, completed: false, startTimestamp: null, endTimestamp: null,
    lastLifecycleTimestamp: null, lastBatteryTimestamp: null,
    actions: new Map(), sourceEventIds: [], issues: [],
  };
}

function newAction(event, order) {
  return {
    action_id: event.details.action_id, mission_id: event.mission_id,
    status: 'UNKNOWN', location_id: null, asset_id: null, action_type: null,
    timestamp: event.timestamp, lastTimestamp: event.timestamp, lastOrder: order,
    failure_type: '', battery_pct: null, attempt: 1, started: false,
    lastLifecycleTimestamp: null, attemptStartTimestamp: null,
    readings: [], anomalies: [], priorReadings: [], sourceEventIds: [], issues: [],
    attemptHistory: [{ attempt: 1, startTimestamp: null, endTimestamp: null, status: 'UNKNOWN' }],
  };
}

function summaryOf(actions) {
  return {
    actions: actions.length,
    successful: actions.filter(action => action.status === 'SUCCESS').length,
    failed: actions.filter(action => action.status === 'FAILED').length,
    running: actions.filter(action => action.status === 'RUNNING').length,
    unknown: actions.filter(action => action.status === 'UNKNOWN').length,
    readings: actions.reduce((sum, action) => sum + action.readings.length + action.priorReadings.length, 0),
    currentReadings: actions.reduce((sum, action) => sum + action.readings.length, 0),
    anomalies: actions.reduce((sum, action) => sum + action.anomalies.length, 0),
    attention: actions.filter(action => action.classification.requiresAttention).length,
  };
}

/** Reduce an ordered list of received events without mutating the input. */
export function liveSnapshot(events = []) {
  const missions = new Map();
  const eventIds = new Map();
  const actionOwners = new Map();
  const readingIds = new Map();
  const anomalyIds = new Map();
  const issues = [];
  let duplicateCount = 0;
  let acceptedCount = 0;
  let lastTimestamp = null;

  const issue = (code, message, event, mission, action) => {
    const entry = { code, message, event_id: event?.event_id || null, mission_id: event?.mission_id || null, action_id: event?.details?.action_id || null };
    issues.push(entry);
    if (mission) mission.issues.push(entry);
    if (action) action.issues.push(entry);
  };

  for (const [order, event] of events.entries()) {
    const invalid = invalidReason(event);
    if (invalid) { issue('INVALID_EVENT', invalid, event); continue; }
    const fingerprint = stableJson(event);
    if (eventIds.has(event.event_id)) {
      if (eventIds.get(event.event_id) === fingerprint) duplicateCount += 1;
      else {
        const mission = missions.get(event.mission_id);
        issue('EVENT_ID_CONFLICT', 'The same event ID was received with different content; the first event is retained.', event, mission, mission?.actions.get(event.details.action_id));
      }
      continue;
    }
    eventIds.set(event.event_id, fingerprint);
    if (!missions.has(event.mission_id)) missions.set(event.mission_id, newMission(event, order));
    const mission = missions.get(event.mission_id);
    const details = event.details;
    let action = null;
    if (!event.event_type.startsWith('MISSION_')) {
      const owner = actionOwners.get(details.action_id);
      if (owner && owner !== event.mission_id) {
        issue('ACTION_ID_CONFLICT', `Action ${details.action_id} already belongs to mission ${owner}; the conflicting event is not applied.`, event, mission);
        continue;
      }
      actionOwners.set(details.action_id, event.mission_id);
      if (!mission.actions.has(details.action_id)) mission.actions.set(details.action_id, newAction(event, order));
      action = mission.actions.get(details.action_id);
      for (const field of ['asset_id', 'location_id', 'action_type']) {
        if (!isString(details[field])) continue;
        if (action[field] && action[field] !== details[field]) {
          issue('ACTION_CONTEXT_CONFLICT', `Action ${details.action_id} has conflicting ${field}; its first recorded value is retained.`, event, mission, action);
        } else action[field] = details[field];
      }
      action.sourceEventIds.push(event.event_id);
      if (laterThan(event.timestamp, action.lastTimestamp) || timeValue(event.timestamp) === timeValue(action.lastTimestamp)) {
        action.lastTimestamp = event.timestamp;
        action.lastOrder = order;
      }
    }

    // Evidence IDs are identities, not updates. Conflicts must never silently replace a value.
    if (['READING_CAPTURED', 'ANOMALY_DETECTED'].includes(event.event_type)) {
      const isReading = event.event_type === 'READING_CAPTURED';
      const id = isReading ? details.reading_id : details.anomaly_id;
      const registry = isReading ? readingIds : anomalyIds;
      const evidenceFingerprint = stableJson({ mission_id: event.mission_id, timestamp: event.timestamp, details });
      if (registry.has(id)) {
        if (registry.get(id) === evidenceFingerprint) duplicateCount += 1;
        else issue(isReading ? 'READING_ID_CONFLICT' : 'ANOMALY_ID_CONFLICT', `Evidence ${id} was received with conflicting content; its first value is retained.`, event, mission, action);
        continue;
      }
      registry.set(id, evidenceFingerprint);
    }

    acceptedCount += 1;
    mission.sourceEventIds.push(event.event_id);
    if (laterThan(event.timestamp, lastTimestamp)) lastTimestamp = event.timestamp;
    if (laterThan(event.timestamp, mission.lastTimestamp) || timeValue(event.timestamp) === timeValue(mission.lastTimestamp)) {
      mission.lastTimestamp = event.timestamp;
      mission.lastOrder = order;
    }
    const battery = details.end_battery_pct ?? details.battery_pct;
    if (Number.isFinite(battery) && !olderThan(event.timestamp, mission.lastBatteryTimestamp)) {
      mission.batteryPct = battery;
      mission.lastBatteryTimestamp = event.timestamp;
    }
    if (action && Number.isFinite(details.battery_pct) && !olderThan(event.timestamp, action.lastLifecycleTimestamp)) action.battery_pct = details.battery_pct;

    if (event.event_type === 'MISSION_STARTED') {
      mission.started = true;
      mission.startTimestamp = mission.startTimestamp || event.timestamp;
      if (!olderThan(event.timestamp, mission.lastLifecycleTimestamp)) {
        if (mission.completed) issue('MISSION_ID_REUSED', 'A completed mission ID was started again; use a new mission ID for a new run.', event, mission);
        else mission.status = 'IN_PROGRESS';
        mission.lastLifecycleTimestamp = event.timestamp;
      }
    } else if (event.event_type === 'MISSION_COMPLETED') {
      if (!olderThan(event.timestamp, mission.lastLifecycleTimestamp)) {
        mission.status = details.status || 'COMPLETED';
        mission.completed = true;
        mission.endTimestamp = event.timestamp;
        mission.lastLifecycleTimestamp = event.timestamp;
      } else issue('OUT_OF_ORDER_LIFECYCLE', 'An older mission lifecycle event was retained as provenance without replacing newer state.', event, mission);
    } else if (event.event_type === 'ACTION_STARTED') {
      const older = olderThan(event.timestamp, action.lastLifecycleTimestamp);
      action.started = true;
      if (older) {
        if (!action.attemptHistory[0].startTimestamp) action.attemptHistory[0].startTimestamp = event.timestamp;
        issue('OUT_OF_ORDER_LIFECYCLE', 'An earlier action start arrived after a newer outcome; the outcome is retained.', event, mission, action);
      } else {
        if (TERMINAL.has(action.status)) {
          action.attempt += 1;
          action.priorReadings.push(...action.readings.map(reading => ({ ...reading, currentAttempt: false })));
          action.readings = [];
          action.attemptHistory.push({ attempt: action.attempt, startTimestamp: event.timestamp, endTimestamp: null, status: 'RUNNING' });
        }
        action.attemptStartTimestamp = action.attemptStartTimestamp && action.status === 'RUNNING' ? action.attemptStartTimestamp : event.timestamp;
        action.status = 'RUNNING';
        action.failure_type = '';
        action.lastLifecycleTimestamp = event.timestamp;
        const attempt = action.attemptHistory.at(-1);
        attempt.startTimestamp = attempt.startTimestamp || event.timestamp;
        attempt.status = 'RUNNING';
      }
    } else if (event.event_type === 'ACTION_COMPLETED' || event.event_type === 'ACTION_FAILED') {
      if (!olderThan(event.timestamp, action.lastLifecycleTimestamp)) {
        action.status = event.event_type === 'ACTION_FAILED' ? 'FAILED' : 'SUCCESS';
        action.failure_type = action.status === 'FAILED' ? details.failure_type || 'UNSPECIFIED' : '';
        action.lastLifecycleTimestamp = event.timestamp;
        const attempt = action.attemptHistory.at(-1);
        attempt.endTimestamp = event.timestamp;
        attempt.status = action.status;
      } else issue('OUT_OF_ORDER_LIFECYCLE', 'An older action outcome did not overwrite the current attempt.', event, mission, action);
    } else if (event.event_type === 'READING_CAPTURED' || event.event_type === 'ANOMALY_DETECTED') {
      const attempt = [...action.attemptHistory].reverse().find(row => !row.startTimestamp || !olderThan(event.timestamp, row.startTimestamp)) || action.attemptHistory[0];
      const currentAttempt = attempt.attempt === action.attempt;
      const evidence = {
        ...details, mission_id: event.mission_id, timestamp: event.timestamp,
        asset_id: details.asset_id || action.asset_id, location_id: details.location_id || action.location_id,
        event_id: event.event_id, attempt: attempt.attempt, currentAttempt,
        reconstructed: false, source: 'live event', synthetic: event.synthetic ?? null,
      };
      if (event.event_type === 'READING_CAPTURED') {
        evidence.numericConfidence = null;
        evidence.threshold = null;
        (currentAttempt ? action.readings : action.priorReadings).push(evidence);
      } else action.anomalies.push(evidence);
    }
  }

  const finalized = [...missions.values()].map(mission => {
    const actions = [...mission.actions.values()].map(action => {
      const gaps = [];
      if (!action.started) gaps.push('Action start event has not arrived.');
      if (!action.location_id) gaps.push('Waypoint has not been supplied.');
      if (!action.asset_id) gaps.push('Asset has not been supplied.');
      if (!action.action_type) gaps.push('Action type has not been supplied.');
      if (action.status === 'UNKNOWN') gaps.push('No action outcome or start is known.');
      const resolveEvidence = evidence => ({ ...evidence, asset_id: evidence.asset_id || action.asset_id, location_id: evidence.location_id || action.location_id, currentAttempt: evidence.attempt === action.attempt });
      const readings = action.readings.map(resolveEvidence);
      const anomalies = action.anomalies.map(resolveEvidence);
      const priorReadings = action.priorReadings.map(resolveEvidence);
      const classification = classifyAction(action, readings, anomalies);
      if (!classification.requiresAttention) {
        classification.label = action.status === 'RUNNING' ? 'Awaiting outcome' : action.status === 'UNKNOWN' ? 'Incomplete telemetry' : readings.length ? 'Action succeeded; no source flag' : 'Action succeeded; no measurement received';
        classification.tone = action.status === 'SUCCESS' ? 'info' : 'warning';
      }
      if (gaps.length || action.issues.some(entry => entry.code.includes('CONFLICT'))) {
        classification.requiresAttention = true;
        classification.reasons.push(...gaps);
        if (action.issues.some(entry => entry.code.includes('CONFLICT'))) classification.reasons.push('Conflicting source records need review.');
        if (classification.priority === 'NONE') { classification.priority = 'VERIFY'; classification.rank = 0.8; classification.tone = 'warning'; }
      }
      const finalAction = {
        action_id: action.action_id, mission_id: action.mission_id, status: action.status,
        location_id: action.location_id, asset_id: action.asset_id, action_type: action.action_type,
        timestamp: action.timestamp, lastTimestamp: action.lastTimestamp, failure_type: action.failure_type,
        battery_pct: action.battery_pct, attempt: action.attempt,
        readings, anomalies, priorReadings, classification,
        gaps, issues: action.issues, attempts: action.attemptHistory,
        sourceEventIds: action.sourceEventIds, lastOrder: action.lastOrder,
      };
      finalAction.recommendation = anomalies.length || action.status === 'FAILED' || readings.some(reading => reading.quality === 'QUESTIONABLE')
        ? recommendNextStep(finalAction)
        : gaps.length ? 'Verify the missing event or asset context before relying on this inspection.'
          : action.status === 'RUNNING' ? 'Wait for the action outcome and any measurement events; absence of a flag is not an equipment clearance.'
            : !readings.length ? 'The action outcome has arrived, but no measurement has been received. Review the expected inspection evidence before clearing the asset.'
              : 'Review the received measurement and any later flags using the approved site procedure; no numeric operating limit is supplied by this feed.';
      return finalAction;
    }).sort((a, b) => timeValue(b.lastTimestamp) - timeValue(a.lastTimestamp) || b.lastOrder - a.lastOrder);
    const gaps = [];
    if (!mission.started) gaps.push('Mission start event has not arrived.');
    if (mission.completed && actions.some(action => action.status === 'RUNNING' || action.status === 'UNKNOWN')) gaps.push('Mission ended with action outcomes still missing.');
    return {
      mission_id: mission.mission_id, status: mission.status, batteryPct: mission.batteryPct,
      timestamp: mission.timestamp, lastTimestamp: mission.lastTimestamp,
      startTimestamp: mission.startTimestamp, endTimestamp: mission.endTimestamp,
      actions, summary: summaryOf(actions), gaps, issues: mission.issues,
      sourceEventIds: mission.sourceEventIds, lastOrder: mission.lastOrder,
    };
  }).sort((a, b) => timeValue(b.lastTimestamp) - timeValue(a.lastTimestamp) || b.lastOrder - a.lastOrder);
  return {
    missions: finalized, issues, summary: summaryOf(finalized.flatMap(mission => mission.actions)),
    lastTimestamp, eventCount: acceptedCount, receivedCount: events.length, duplicateCount,
    source: 'live events only',
    note: 'Action success is separate from equipment condition. No archived readings, numeric thresholds or confidence probabilities are assumed.',
  };
}
