import test from 'node:test';
import assert from 'node:assert/strict';
import { liveSnapshot, validateLiveEvent } from '../src/lib/live-engine.js';

let serial = 0;
const event = (event_type, details = {}, timestamp = '2026-10-10T12:00:00', mission_id = 'LIVE-M1', event_id = `EV-${++serial}`) => ({ event_id, mission_id, timestamp, event_type, details });
const startMission = () => event('MISSION_STARTED', { battery_pct: 80 });
const context = { action_id: 'LIVE-A1', location_id: 'WP03', asset_id: 'HX-208', action_type: 'THERMAL_INSPECTION', battery_pct: 78 };
const startAction = (timestamp = '2026-10-10T12:01:00') => event('ACTION_STARTED', { ...context }, timestamp);
const reading = (overrides = {}, timestamp = '2026-10-10T12:01:10') => event('READING_CAPTURED', { action_id: 'LIVE-A1', reading_id: 'LIVE-R1', measurement_type: 'TEMPERATURE_C', value: 71.4, unit: 'degC', quality: 'GOOD', ...overrides }, timestamp);
const anomaly = (overrides = {}, timestamp = '2026-10-10T12:01:11') => event('ANOMALY_DETECTED', { action_id: 'LIVE-A1', anomaly_id: 'LIVE-AN1', anomaly_type: 'ABNORMAL_TEMPERATURE', severity: 'HIGH', operator_review_required: true, description: 'Synthetic demonstration flag.', ...overrides }, timestamp);

test('empty stream has no inferred missions, archive values or healthy state', () => {
  const snapshot = liveSnapshot([]);
  assert.equal(snapshot.missions.length, 0);
  assert.equal(snapshot.summary.actions, 0);
  assert.equal(snapshot.summary.readings, 0);
  assert.equal(snapshot.lastTimestamp, null);
});

test('received readings and anomalies become readable evidence without archive enrichment', () => {
  const snapshot = liveSnapshot([startMission(), startAction(), reading(), anomaly(), event('ACTION_COMPLETED', { action_id: 'LIVE-A1', status: 'SUCCESS' }, '2026-10-10T12:01:20')]);
  const mission = snapshot.missions[0];
  const action = mission.actions[0];
  assert.equal(mission.status, 'IN_PROGRESS');
  assert.equal(mission.batteryPct, 78);
  assert.equal(action.status, 'SUCCESS');
  assert.equal(action.readings[0].value, 71.4);
  assert.equal(action.readings[0].unit, 'degC');
  assert.equal(action.readings[0].reconstructed, false);
  assert.equal(action.readings[0].numericConfidence, null);
  assert.equal(action.readings[0].threshold, null);
  assert.equal(action.anomalies[0].severity, 'HIGH');
  assert.equal(action.classification.requiresAttention, true);
  assert.equal(mission.summary.attention, 1);
  assert.equal(mission.summary.readings, 1);
  assert.equal(snapshot.issues.length, 0);
});

test('a kit-like action ID does not cause historical readings to appear', () => {
  const snapshot = liveSnapshot([event('MISSION_STARTED', {}, '2026-09-08T02:00:00', 'M020'), event('ACTION_COMPLETED', { action_id: 'A0194', status: 'SUCCESS' }, '2026-09-08T02:08:00', 'M020')]);
  const action = snapshot.missions[0].actions[0];
  assert.equal(action.readings.length, 0);
  assert.equal(action.anomalies.length, 0);
  assert.equal(action.classification.requiresAttention, true);
  assert.ok(action.gaps.length);
});

test('evidence arriving before lifecycle creates an unknown placeholder and later fills context', () => {
  const partial = liveSnapshot([reading()]);
  assert.equal(partial.missions[0].status, 'UNKNOWN');
  assert.equal(partial.missions[0].actions[0].status, 'UNKNOWN');
  assert.equal(partial.missions[0].actions[0].classification.requiresAttention, true);
  const complete = liveSnapshot([reading(), startMission(), startAction()]);
  const action = complete.missions[0].actions[0];
  assert.equal(action.status, 'RUNNING');
  assert.equal(action.readings[0].asset_id, 'HX-208');
  assert.equal(action.readings[0].location_id, 'WP03');
  assert.deepEqual(action.gaps, []);
});

test('equal timestamp events apply in received order and never infer a future terminal state', () => {
  const start = startAction();
  const finish = event('ACTION_FAILED', { action_id: 'LIVE-A1', failure_type: 'SENSOR_TIMEOUT' }, start.timestamp);
  assert.equal(liveSnapshot([start]).missions[0].actions[0].status, 'RUNNING');
  assert.equal(liveSnapshot([start, finish]).missions[0].actions[0].status, 'FAILED');
  assert.equal(liveSnapshot([finish, start]).missions[0].actions[0].status, 'RUNNING');
  assert.equal(liveSnapshot([finish, start]).missions[0].actions[0].attempt, 2);
});

test('older action start received after terminal enriches context without reopening the action', () => {
  const snapshot = liveSnapshot([event('ACTION_FAILED', { action_id: 'LIVE-A1', failure_type: 'SENSOR_TIMEOUT' }, '2026-10-10T12:02:00'), startAction()]);
  const action = snapshot.missions[0].actions[0];
  assert.equal(action.status, 'FAILED');
  assert.equal(action.asset_id, 'HX-208');
  assert.equal(action.attempt, 1);
  assert.equal(action.attempts[0].startTimestamp, '2026-10-10T12:01:00');
  assert.equal(action.gaps.length, 0);
  assert.ok(snapshot.issues.some(issue => issue.code === 'OUT_OF_ORDER_LIFECYCLE'));
});

test('retry clears current readings but preserves prior evidence and unresolved anomaly', () => {
  const snapshot = liveSnapshot([startMission(), startAction(), reading(), anomaly(), event('ACTION_FAILED', { action_id: 'LIVE-A1', failure_type: 'READING_UNRELIABLE' }, '2026-10-10T12:02:00'), startAction('2026-10-10T12:03:00')]);
  const action = snapshot.missions[0].actions[0];
  assert.equal(action.attempt, 2);
  assert.equal(action.status, 'RUNNING');
  assert.equal(action.failure_type, '');
  assert.equal(action.readings.length, 0);
  assert.equal(action.priorReadings.length, 1);
  assert.equal(action.priorReadings[0].currentAttempt, false);
  assert.equal(action.anomalies.length, 1);
  assert.equal(action.anomalies[0].currentAttempt, false);
  assert.equal(action.classification.requiresAttention, true);
  assert.equal(snapshot.summary.readings, 1);
  assert.equal(snapshot.summary.currentReadings, 0);
});

test('late reading from an earlier attempt cannot become the current retry measurement', () => {
  const snapshot = liveSnapshot([startAction(), event('ACTION_FAILED', { action_id: 'LIVE-A1' }, '2026-10-10T12:02:00'), startAction('2026-10-10T12:03:00'), reading()]);
  const action = snapshot.missions[0].actions[0];
  assert.equal(action.readings.length, 0);
  assert.equal(action.priorReadings.length, 1);
  assert.equal(action.priorReadings[0].attempt, 1);
});

test('older terminal outcome cannot overwrite a later running retry', () => {
  const snapshot = liveSnapshot([startAction(), event('ACTION_FAILED', { action_id: 'LIVE-A1' }, '2026-10-10T12:02:00'), startAction('2026-10-10T12:03:00'), event('ACTION_COMPLETED', { action_id: 'LIVE-A1' }, '2026-10-10T12:02:30')]);
  assert.equal(snapshot.missions[0].actions[0].status, 'RUNNING');
  assert.ok(snapshot.issues.some(issue => issue.code === 'OUT_OF_ORDER_LIFECYCLE'));
});

test('identical retransmissions are idempotent', () => {
  const recorded = reading();
  const snapshot = liveSnapshot([startAction(), recorded, structuredClone(recorded), { ...recorded, event_id: 'RETRANSMITTED-WITH-NEW-ID' }]);
  assert.equal(snapshot.summary.readings, 1);
  assert.equal(snapshot.duplicateCount, 2);
  assert.equal(snapshot.issues.length, 0);
});

test('event ID conflict retains first accepted data and raises an issue', () => {
  const original = reading();
  const conflict = { ...original, details: { ...original.details, value: 99 } };
  const snapshot = liveSnapshot([startAction(), original, conflict]);
  assert.equal(snapshot.missions[0].actions[0].readings[0].value, 71.4);
  assert.ok(snapshot.issues.some(issue => issue.code === 'EVENT_ID_CONFLICT'));
});

test('reading ID conflict cannot silently replace measurements', () => {
  const snapshot = liveSnapshot([startAction(), reading(), reading({ value: 99 })]);
  assert.equal(snapshot.summary.readings, 1);
  assert.equal(snapshot.missions[0].actions[0].readings[0].value, 71.4);
  assert.ok(snapshot.issues.some(issue => issue.code === 'READING_ID_CONFLICT'));
  assert.equal(snapshot.missions[0].actions[0].classification.requiresAttention, true);
});

test('anomaly ID conflict preserves severity and never downgrades a received flag', () => {
  const snapshot = liveSnapshot([startAction(), anomaly(), anomaly({ severity: 'LOW' })]);
  assert.equal(snapshot.summary.anomalies, 1);
  assert.equal(snapshot.missions[0].actions[0].anomalies[0].severity, 'HIGH');
  assert.ok(snapshot.issues.some(issue => issue.code === 'ANOMALY_ID_CONFLICT'));
});

test('action identity cannot be silently reassigned between missions', () => {
  const conflicting = { ...startAction('2026-10-10T13:00:00'), mission_id: 'LIVE-M2' };
  const snapshot = liveSnapshot([startAction(), conflicting]);
  assert.equal(snapshot.summary.actions, 1);
  assert.ok(snapshot.issues.some(issue => issue.code === 'ACTION_ID_CONFLICT'));
});

test('conflicting waypoint is exposed while preserving the first source context', () => {
  const snapshot = liveSnapshot([startAction(), reading({ location_id: 'WP99' })]);
  const action = snapshot.missions[0].actions[0];
  assert.equal(action.location_id, 'WP03');
  assert.equal(action.readings[0].location_id, 'WP99');
  assert.equal(action.classification.requiresAttention, true);
  assert.ok(snapshot.issues.some(issue => issue.code === 'ACTION_CONTEXT_CONFLICT'));
});

test('mission completion status comes from payload and does not clear action failures', () => {
  const snapshot = liveSnapshot([startMission(), startAction(), event('ACTION_FAILED', { action_id: 'LIVE-A1' }, '2026-10-10T12:02:00'), event('MISSION_COMPLETED', { status: 'FAILED', end_battery_pct: 64 }, '2026-10-10T12:03:00')]);
  assert.equal(snapshot.missions[0].status, 'FAILED');
  assert.equal(snapshot.missions[0].batteryPct, 64);
  assert.equal(snapshot.missions[0].summary.failed, 1);
});

test('completed mission with missing action terminal event exposes the telemetry gap', () => {
  const snapshot = liveSnapshot([startMission(), startAction(), event('MISSION_COMPLETED', { status: 'COMPLETED' }, '2026-10-10T12:03:00')]);
  assert.equal(snapshot.missions[0].status, 'COMPLETED');
  assert.equal(snapshot.missions[0].summary.running, 1);
  assert.match(snapshot.missions[0].gaps.join(' '), /outcomes still missing/);
});

test('newest missions sort first while preserving supplied timezone strings', () => {
  const earlier = event('MISSION_STARTED', {}, '2026-10-10T12:00:00-04:00', 'FIRST');
  const later = event('MISSION_STARTED', {}, '2026-10-10T18:00:00+01:00', 'SECOND');
  const snapshot = liveSnapshot([later, earlier]);
  assert.equal(snapshot.missions[0].mission_id, 'SECOND');
  assert.equal(snapshot.missions[0].lastTimestamp, '2026-10-10T18:00:00+01:00');
  assert.equal(snapshot.lastTimestamp, '2026-10-10T18:00:00+01:00');
});

test('invalid or non-finite measurement events are rejected without phantom evidence', () => {
  const snapshot = liveSnapshot([reading({ value: Number.NaN }), reading({ quality: 'CERTAIN' }), anomaly({ operator_review_required: 'true' })]);
  assert.equal(snapshot.missions.length, 0);
  assert.equal(snapshot.summary.readings, 0);
  assert.equal(snapshot.issues.length, 3);
});

test('displayed event fields have constrained primitive types before rendering', () => {
  const malformed = event('ACTION_FAILED', { action_id: 'LIVE-A1', failure_type: { toString: null } });
  assert.equal(validateLiveEvent(malformed).valid, false);
  assert.match(validateLiveEvent(malformed).error, /failure_type/);
  assert.equal(validateLiveEvent(event('ACTION_STARTED', { ...context, asset_id: {} })).valid, false);
  assert.equal(validateLiveEvent({ ...reading(), synthetic: 'true' }).valid, false);
  assert.deepEqual(validateLiveEvent(reading()), { valid: true, error: null });
  assert.doesNotThrow(() => liveSnapshot([malformed]));
});

test('timestamp validation rejects impossible dates and rollover times', () => {
  for (const timestamp of ['2026-02-30T12:00:00', '2026-02-29T12:00:00', '2026-10-10T24:00:00', '2026-10-10T12:00:00+25:00']) {
    assert.equal(validateLiveEvent(event('MISSION_STARTED', {}, timestamp)).valid, false);
  }
  assert.equal(validateLiveEvent(event('MISSION_STARTED', {}, '2028-02-29T12:00:00')).valid, true);
});

test('success with no measurements does not claim equipment health', () => {
  const snapshot = liveSnapshot([startMission(), startAction(), event('ACTION_COMPLETED', { action_id: 'LIVE-A1' }, '2026-10-10T12:02:00')]);
  const action = snapshot.missions[0].actions[0];
  assert.equal(action.status, 'SUCCESS');
  assert.equal(action.classification.tone, 'info');
  assert.match(action.classification.label, /no measurement received/);
  assert.doesNotMatch(action.classification.label, /healthy|safe|clear/i);
  assert.match(action.recommendation, /no measurement has been received/);
});

test('reduction is pure and deterministic', () => {
  const events = [startMission(), startAction(), reading(), anomaly()];
  const before = JSON.stringify(events);
  const first = liveSnapshot(events);
  const second = liveSnapshot(events);
  assert.equal(JSON.stringify(events), before);
  assert.deepEqual(first, second);
});

