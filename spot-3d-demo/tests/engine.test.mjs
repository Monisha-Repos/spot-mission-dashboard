import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  createIndex, missionSnapshot, summarize, buildQueue, compareConfigurations,
  locationSummary, assessReading, formatTimestamp, buildHandover, reliabilityInsights,
} from '../src/lib/engine.js';

const data = JSON.parse(await readFile(new URL('../public/data/mission-data.json', import.meta.url), 'utf8'));
const close = (value, expected, tolerance = 0.00001) => assert.ok(Math.abs(value - expected) < tolerance, `${value} != ${expected}`);

test('all supplied counts and source references survive normalization', () => {
  assert.deepEqual(data.metadata.counts, { missions: 27, actions: 270, readings: 220, anomalies: 40, locations: 15, assets: 20, replay: 500 });
  assert.equal(data.actions[0].source.file, 'actions.csv');
  assert.equal(data.actions[0].source.row, 2);
  assert.equal(data.actions[0].battery_pct, 75);
  assert.equal(data.actions[0].synthetic, true);
  assert.equal(data.anomalies.find(row => row.anomaly_id === 'AN014').operator_review_required, true);
  assert.equal(data.readings.find(row => row.reading_id === 'R0002').value, 136.8);
  assert.equal(data.readings.find(row => row.reading_id === 'R0002').unit, 'psi');
});

test('joins preserve exact IDs and source row counts', () => {
  const index = createIndex(data);
  const snapshot = missionSnapshot(data, 'M020');
  assert.equal(index.actions.size, 270);
  assert.equal(snapshot.actions.length, 10);
  assert.equal(snapshot.actions.find(action => action.action_id === 'A0194').anomalies[0].anomaly_id, 'AN014');
  assert.equal(snapshot.actions.find(action => action.action_id === 'A0194').location.location_id, 'WP07');
  assert.equal(snapshot.actions.find(action => action.action_id === 'A0194').asset.asset_id, 'HX-204');
});

test('completed mission stays distinct from failed inspection actions', () => {
  const snapshot = missionSnapshot(data, 'M020');
  assert.equal(snapshot.missionStatus, 'COMPLETED');
  assert.equal(snapshot.summary.successfulActions, 9);
  assert.equal(snapshot.summary.failedActions, 1);
  assert.equal(snapshot.summary.anomalyCount, 3);
  assert.equal(snapshot.summary.criticalAnomalies, 1);
  assert.equal(snapshot.summary.successRate, 90);
});

test('all-data metrics match independent supplied validation counts', () => {
  const summary = summarize(data);
  assert.equal(summary.totalActions, 270);
  assert.equal(summary.successfulActions, 221);
  assert.equal(summary.failedActions, 49);
  assert.equal(summary.readingsCount, 220);
  assert.equal(summary.questionableReadings, 42);
  assert.equal(summary.anomalyCount, 40);
  assert.equal(summary.criticalAnomalies, 4);
  assert.equal(summary.highAnomalies, 11);
  assert.equal(summary.locationMismatchCount, 61);
});

test('configuration comparison uses distinct sample sizes and percentage points', () => {
  const comparison = compareConfigurations(data);
  assert.equal(comparison.baseline.missionCount, 18);
  assert.equal(comparison.improved.missionCount, 9);
  assert.equal(comparison.baseline.totalActions, 180);
  assert.equal(comparison.improved.totalActions, 90);
  close(comparison.baseline.successRate, 139 / 180 * 100);
  close(comparison.improved.successRate, 82 / 90 * 100);
  close(comparison.actionSuccessDeltaPp, 13.888888888888886);
  assert.match(comparison.caveat, /does not establish causality/);
});

test('replay before first event has no observations or future outcome', () => {
  const snapshot = missionSnapshot(data, 'M020', null, { replay: true, eventIndex: -1 });
  assert.equal(snapshot.missionStatus, 'NOT_STARTED');
  assert.equal(snapshot.actions.length, 0);
  assert.equal(snapshot.readings.length, 0);
  assert.equal(snapshot.anomalies.length, 0);
  assert.equal(snapshot.batteryPct, null);
  assert.equal(snapshot.mission.mission_status, 'NOT_STARTED');
  assert.equal(snapshot.mission.end_time, null);
});

test('equal-time action-start event cannot leak the following failure, reading or anomaly', () => {
  const snapshot = missionSnapshot(data, 'M001', '2026-09-01T18:03:06', { replay: true, eventIndex: 1 });
  assert.equal(snapshot.actions.length, 1);
  assert.equal(snapshot.actions[0].status, 'RUNNING');
  assert.equal(snapshot.actions[0].failure_type, '');
  assert.equal(snapshot.actions[0].sourceStatus, null);
  assert.equal(snapshot.actions[0].duration_sec, null);
  assert.equal(snapshot.summary.failedActions, 0);
  assert.equal(snapshot.anomalies.length, 0);
  assert.equal(snapshot.readings.length, 0);
  assert.equal(snapshot.missionStatus, 'IN_PROGRESS');
});

test('terminal replay event reveals source-linked evidence only at that point', () => {
  const snapshot = missionSnapshot(data, 'M001', '2026-09-01T18:03:06', { replay: true, eventIndex: 2 });
  assert.equal(snapshot.actions[0].status, 'FAILED');
  assert.equal(snapshot.actions[0].failure_type, 'OBSTACLE_DETECTION');
  assert.equal(snapshot.anomalies[0].anomaly_id, 'AN024');
  assert.equal(snapshot.anomalies[0].reconstructed, true);
  assert.equal(snapshot.summary.failedActions, 1);
});

test('replay completion respects details.status FAILED despite event name MISSION_COMPLETED', () => {
  const snapshot = missionSnapshot(data, 'M017', null, { replay: true });
  assert.equal(snapshot.events.at(-1).event_type, 'MISSION_COMPLETED');
  assert.equal(snapshot.missionStatus, 'FAILED');
  assert.equal(snapshot.mission.mission_status, 'FAILED');
  assert.equal(snapshot.batteryPct, 16);
});

test('truncated M023 never borrows missing action outcomes from archive', () => {
  const snapshot = missionSnapshot(data, 'M023', null, { replay: true });
  assert.equal(snapshot.actions.length, 8);
  assert.equal(snapshot.summary.successfulActions, 7);
  assert.equal(snapshot.summary.runningActions, 1);
  assert.equal(snapshot.currentAction.action_id, 'A0228');
  assert.equal(snapshot.currentAction.status, 'RUNNING');
  assert.equal(snapshot.currentAction.readings.length, 0);
  assert.equal(snapshot.missionStatus, 'IN_PROGRESS');
  assert.equal(snapshot.replayCoverage.coverage, 'partial');
  assert.equal(missionSnapshot(data, 'M023').summary.successfulActions, 10);
});

test('missions absent from replay stay unavailable, while archived reports remain complete', () => {
  const replay = missionSnapshot(data, 'M027', null, { replay: true });
  assert.equal(replay.events.length, 0);
  assert.equal(replay.actions.length, 0);
  assert.equal(replay.missionStatus, 'NOT_STARTED');
  assert.equal(replay.replayCoverage.coverage, 'unavailable');
  assert.equal(missionSnapshot(data, 'M027').actions.length, 10);
});

test('queue, map and handover apply the same replay cursor without future anomalies', () => {
  const options = { missionId: 'M020', replay: true, eventIndex: 2, asOf: '2026-09-08T02:02:00' };
  const queue = buildQueue(data, options);
  assert.ok(!queue.some(item => item.evidenceIds.includes('AN014')));
  assert.equal(summarize(data, options).anomalyCount, 1);
  assert.equal(locationSummary(data, options).reduce((sum, location) => sum + location.summary.anomalyCount, 0), 1);
  assert.doesNotMatch(buildHandover(data, options), /AN014|Abnormal temperature/);
});

test('priority queue consolidates signals per action and retains all evidence IDs', () => {
  const queue = buildQueue(data, { missionId: 'M020' });
  assert.equal(queue[0].id, 'A0194');
  assert.equal(queue[0].priority, 'CRITICAL');
  assert.ok(queue[0].evidenceIds.includes('AN014'));
  assert.equal(new Set(queue.map(item => item.id)).size, queue.length);
  assert.match(queue[0].recommendation, /approved site limits/);
});

test('asset registry mismatch is disclosed without relocating the observation', () => {
  const action = missionSnapshot(data, 'M020').actions.find(row => row.action_id === 'A0194');
  assert.equal(action.location_id, 'WP07');
  assert.equal(action.location.location_id, 'WP07');
  assert.equal(action.asset.location_id, 'WP05');
  assert.equal(action.locationMismatch, true);
  const map = locationSummary(data, { missionId: 'M020' });
  assert.ok(map.find(location => location.location_id === 'WP07').actions.some(row => row.action_id === 'A0194'));
  assert.ok(!map.find(location => location.location_id === 'WP05').actions.some(row => row.action_id === 'A0194'));
});

test('reading assessment does not fabricate limits or confidence percentages', () => {
  const questionable = data.readings.find(row => row.quality === 'QUESTIONABLE');
  const assessment = assessReading(questionable);
  assert.equal(assessment.needsVerification, true);
  assert.equal(assessment.numericConfidence, null);
  assert.equal(assessment.threshold, null);
  assert.equal(assessment.thresholdStatus, 'NOT_PROVIDED');
  const localization = assessReading(data.readings.find(row => row.measurement_type === 'LOCALIZATION_CONFIDENCE_PCT'));
  assert.match(localization.explanation, /localization confidence only/);
});

test('timestamp display preserves source-local hour without inventing time zone', () => {
  assert.equal(formatTimestamp('2026-09-08T02:08:00'), 'Sep 8, 2026 · 02:08');
  assert.equal(formatTimestamp('2026-09-08T02:08:34', { date: false, seconds: true }), '02:08:34');
});

test('live events support unknown IDs and never assume absent measurement data', () => {
  const events = [
    { event_id: 'LIVE1', mission_id: 'LIVE-M1', timestamp: '2026-10-10T10:00:00', event_type: 'MISSION_STARTED', details: { battery_pct: 88 } },
    { event_id: 'LIVE2', mission_id: 'LIVE-M1', timestamp: '2026-10-10T10:01:00', event_type: 'ACTION_STARTED', details: { action_id: 'LIVE-A1', location_id: 'WP03', asset_id: 'HX-208', action_type: 'THERMAL_INSPECTION', battery_pct: 87 } },
    { event_id: 'LIVE3', mission_id: 'LIVE-M1', timestamp: '2026-10-10T10:01:30', event_type: 'ACTION_COMPLETED', details: { action_id: 'LIVE-A1', status: 'SUCCESS' } },
  ];
  const snapshot = missionSnapshot(data, 'LIVE-M1', null, { replay: true, events, reconstruct: false });
  assert.equal(snapshot.actions[0].status, 'SUCCESS');
  assert.equal(snapshot.actions[0].location.location_id, 'WP03');
  assert.equal(snapshot.summary.readingsCount, 0);
  assert.equal(snapshot.summary.anomalyCount, 0);
  assert.equal(snapshot.reconstructed, false);
  assert.equal(snapshot.missionStatus, 'IN_PROGRESS');
});

test('event-index replay still gates later CSV observations by the observed timestamp', () => {
  const cloned = structuredClone(data);
  cloned.readings.push({ reading_id: 'TEST-DELAYED', action_id: 'A0001', mission_id: 'M001', timestamp: '2026-09-01T18:04:00', quality: 'GOOD', value: 123, unit: 'test' });
  const snapshot = missionSnapshot(cloned, 'M001', null, { replay: true, eventIndex: 2 });
  assert.ok(!snapshot.readings.some(row => row.reading_id === 'TEST-DELAYED'));
});

test('waypoint navigation rate matches source validation and shows denominator', () => {
  const insights = reliabilityInsights(data);
  assert.equal(insights.waypoint05Navigation.total, 25);
  assert.equal(insights.waypoint05Navigation.failed, 7);
  assert.equal(insights.waypoint05Navigation.failureRate, 28);
  assert.equal(insights.batteryBands.reduce((sum, band) => sum + band.total, 0), 270);
});

test('empty data returns unavailable rates rather than misleading zero or NaN', () => {
  const empty = { missions: [], actions: [], readings: [], anomalies: [], locations: [], assets: [], replay: [] };
  const summary = summarize(empty);
  assert.equal(summary.successRate, null);
  assert.equal(summary.coverageRate, null);
  assert.equal(summary.missionCompletionRate, null);
  assert.deepEqual(buildQueue(empty), []);
});

