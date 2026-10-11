import test from 'node:test';
import assert from 'node:assert/strict';
import { kpiLabel, nextStatuses, num, pct, reading, reportFilename, sortRows, tone } from '../src/lib/format.js';

test('numbers and percentages', () => {
  assert.equal(pct(77.24), '77.2%');
  assert.equal(pct(null), '—');
  assert.equal(num(3), '3');
  assert.equal(num(0.4444, 3), '0.444');
  assert.equal(num(2.5), '2.5');
  assert.equal(num(null), '—');
  // Rounding to whole numbers must not eat the zeros of the integer part.
  assert.equal(num(59.53, 0), '60');
  assert.equal(num(70.4, 0), '70');
  assert.equal(num(100.04, 1), '100');
  assert.equal(num(2.50, 2), '2.5');
});

test('readings carry their unit', () => {
  assert.equal(reading({ value: 41.4, unit: 'C' }), '41.4°C');
  assert.equal(reading({ value: 64.7, unit: 'pct' }), '64.7%');
  assert.equal(reading(null), '—');
});

test('status tones', () => {
  assert.equal(tone('normal'), 'ok');
  assert.equal(tone('watch'), 'warn');
  assert.equal(tone('action'), 'bad');
});

test('KPI labels from compare keys', () => {
  assert.equal(kpiLabel('action_success_pct'), 'Action success');
  assert.equal(kpiLabel('failure_pct_by_waypoint.WP05'), 'Failure rate · WP05');
  assert.equal(kpiLabel('anomalies_by_type.ABNORMAL_TEMPERATURE'), 'Anomalies · abnormal temperature');
});

test('issue transitions follow the backend rules', () => {
  assert.deepEqual(nextStatuses('OPEN', 'operator'), ['ACKNOWLEDGED', 'IN_PROGRESS', 'RESOLVED', 'FALSE_ALARM']);
  assert.deepEqual(nextStatuses('RESOLVED', 'operator'), []);
  assert.deepEqual(nextStatuses('FALSE_ALARM', 'supervisor'), ['OPEN']);
});

test('sorting puts blanks last and compares numbers numerically', () => {
  const rows = [{ v: 10 }, { v: null }, { v: 9 }, { v: 100 }];
  assert.deepEqual(sortRows(rows, r => r.v).map(r => r.v), [9, 10, 100, null]);
  assert.deepEqual(sortRows(rows, r => r.v, 'desc').map(r => r.v), [100, 10, 9, null]);
  assert.deepEqual(sortRows([{ v: 'WP10' }, { v: 'WP2' }], r => r.v).map(r => r.v), ['WP2', 'WP10']);
});

test('report filename is timestamped', () => {
  assert.equal(reportFilename(new Date('2026-10-11T08:30:00Z')), 'spot-report-2026-10-11T08-30.pdf');
});

test('measurement codes read as words', async () => {
  const { measurementLabel } = await import('../src/lib/format.js');
  assert.equal(measurementLabel('TEMPERATURE_C'), 'Temperature');
  assert.equal(measurementLabel('SOMETHING_NEW'), 'something new');
});
