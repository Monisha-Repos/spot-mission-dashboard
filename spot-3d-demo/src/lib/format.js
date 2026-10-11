// Small display helpers shared by every view. Pure functions, unit-tested in tests/format.test.mjs.

export const humanize = code => (code ? String(code).replace(/_/g, ' ').toLowerCase() : '');
export const titleCase = code => humanize(code).replace(/\b\w/g, c => c.toUpperCase());

export function pct(value, digits = 1) {
  return value === null || value === undefined || Number.isNaN(value) ? '—' : `${Number(value).toFixed(digits)}%`;
}

export function num(value, digits = 2) {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  if (Number.isNaN(n)) return String(value);
  return Number.isInteger(n) ? String(n) : n.toFixed(digits).replace(/\.?0+$/, '');
}

const UNITS = { C: '°C', pct: '%', psi: ' psi', dB: ' dB', db: ' dB', score: '/100' };
export const unit = u => UNITS[u] ?? (u ? ` ${u}` : '');
const MEASUREMENTS = {
  TEMPERATURE_C: 'Temperature', PRESSURE_PSI: 'Pressure', SOUND_DB: 'Sound level',
  VISUAL_SCORE: 'Visual condition score', LOCALIZATION_CONFIDENCE_PCT: 'Localization confidence',
};
export const measurementLabel = code => MEASUREMENTS[code] || humanize(code);
export const reading = r => (r ? `${num(r.value)}${unit(r.unit)}` : '—');

export function formatTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** "WP05 navigation" style KPI keys from the compare endpoints, in plain words. */
export function kpiLabel(key) {
  const [head, tail] = String(key).split('.');
  const base = {
    action_success_pct: 'Action success', mission_completion_pct: 'Mission completion',
    anomalies_per_mission: 'Anomalies per mission', avg_battery_drain_pct: 'Avg battery drain',
    avg_end_battery_pct: 'Avg end battery', avg_predicted_failure_risk: 'Avg predicted failure risk',
    hidden_failure_missions: 'Missions with hidden failures', reading_good_pct: 'Good readings',
    serious_anomalies: 'Serious anomalies', avg_duration_min: 'Avg duration (min)',
    action_success_pct_by_type: 'Success', failure_pct_by_waypoint: 'Failure rate',
    navigation_failure_pct_by_waypoint: 'Navigation failure', anomalies_by_severity: 'Anomalies',
    anomalies_by_type: 'Anomalies', status_counts: 'Records',
  }[head] || humanize(head);
  return tail ? `${base} · ${tail.includes('_') ? humanize(tail) : tail}` : base;
}

/** Battery % → level: red up to 30%, yellow up to 60%, green above. 'none' when unknown. */
export function batteryLevel(value) {
  if (value === null || value === undefined || value === '' || Number.isNaN(Number(value))) return 'none';
  const n = Number(value);
  return n <= 30 ? 'low' : n <= 60 ? 'mid' : 'high';
}

/** Status of a waypoint / record → CSS tone. */
export const tone = status => ({ normal: 'ok', watch: 'warn', action: 'bad' }[status] || 'muted');
export const severityTone = s => ({ LOW: 'muted', MEDIUM: 'warn', HIGH: 'bad', CRITICAL: 'bad' }[s] || 'muted');

/** Which transitions an operator can pick from an issue's current status. */
export function nextStatuses(status, role) {
  if (status === 'RESOLVED' || status === 'FALSE_ALARM') return role === 'supervisor' ? ['OPEN'] : [];
  return ['OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS', 'RESOLVED', 'FALSE_ALARM'].filter(s => s !== status);
}

/** Sort rows by a column accessor; numbers numerically, everything else as text. */
export function sortRows(rows, get, dir = 'asc') {
  const sign = dir === 'desc' ? -1 : 1;
  return [...rows].sort((a, b) => {
    const x = get(a), y = get(b);
    if (x === y) return 0;
    if (x === null || x === undefined || x === '') return 1;
    if (y === null || y === undefined || y === '') return -1;
    if (typeof x === 'number' && typeof y === 'number') return (x - y) * sign;
    return String(x).localeCompare(String(y), undefined, { numeric: true }) * sign;
  });
}

export function reportFilename(date = new Date()) {
  return `spot-report-${date.toISOString().slice(0, 16).replace(':', '-')}.pdf`;
}
