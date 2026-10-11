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
  // Trim trailing zeros after the decimal point only, so num(59.53, 0) stays "60".
  return Number.isInteger(n) ? String(n) : n.toFixed(digits).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
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

/** "ACOUSTIC_INSPECTION" → "Acoustic inspection". Leaves blanks blank. */
export function sentence(code) {
  const h = humanize(code);
  return h ? h.charAt(0).toUpperCase() + h.slice(1) : '';
}

/** Unit of a KPI key from the compare endpoints: '%' for percentages, ' min' for durations, '' otherwise. */
export function kpiUnit(key) {
  const head = String(key).split('.')[0];
  if (/(^|_)pct($|_)/.test(head)) return '%';
  if (head.endsWith('_min')) return ' min';
  return '';
}

/** A KPI value with its unit, e.g. 77.2%. */
export const kpiValue = (key, v) => (v === null || v === undefined ? '—' : `${num(v)}${kpiUnit(key)}`);

/** A KPI change with sign and unit. Percentages change by percentage points (pp), not percent. */
export function kpiDelta(key, d) {
  if (d === null || d === undefined || Number.isNaN(Number(d))) return '—';
  const u = kpiUnit(key);
  const sign = d > 0 ? '+' : d < 0 ? '−' : '';
  return `${sign}${num(Math.abs(d))}${u === '%' ? ' pp' : u}`;
}

/** Arrow for the actual direction of a change (up = went up), independent of whether that is good. */
export const deltaArrow = d => (d > 0 ? '▲' : d < 0 ? '▼' : '•');

/** Plain-language help for the technical terms shown in the dashboard. */
export const GLOSSARY = {
  predicted_failure_risk: 'Chance (0–1) the failure-risk model gives that this action fails. Higher means more likely to fail.',
  avg_predicted_failure_risk: 'Average of the model’s failure chance (0–1) across actions. Lower is better.',
  precision: 'Of the actions the model flagged as failing, the share that really failed.',
  recall: 'Of the actions that really failed, the share the model caught.',
  f1: 'Balance of precision and recall in one number (0–1). Higher is better.',
  pr_auc: 'Area under the precision–recall curve (0–1): how well the model ranks failures above successes, focused on the rare failures.',
  roc_auc: 'Area under the ROC curve (0–1): the chance a random failure gets a higher risk score than a random success. 0.5 is guessing.',
  hidden_failure_missions: 'Missions marked completed even though at least one check failed during the run.',
  p_value: 'How likely a difference this large is by chance alone. Below 0.05 is usually treated as a real difference.',
  avg_battery_drain_pct: 'Average battery percentage used from start to end of a mission. Lower is better.',
  pp: 'Percentage points: the plain difference between two percentages (e.g. 70% → 75% is +5 pp).',
};

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
