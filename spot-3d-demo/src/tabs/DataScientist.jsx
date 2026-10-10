import React, { useState } from 'react';
import { useApi } from '../api.js';
import { Async, Badge, Section, Segmented, Stat } from '../components/ui.jsx';
import DataTable from '../components/DataTable.jsx';
import { downloadReport } from '../lib/report.js';
import { kpiLabel, num, severityTone, tone } from '../lib/format.js';

const statusCell = r => <Badge tone={tone(r.status)}>{r.status}</Badge>;

const TABLES = {
  missions: {
    label: 'Missions',
    rowKey: r => r.mission_id,
    columns: [
      { key: 'mission_id', label: 'Mission' },
      { key: 'configuration_version', label: 'Config' },
      { key: 'scenario', label: 'Scenario' },
      { key: 'mission_status', label: 'Status' },
      { key: 'start_time', label: 'Start' },
      { key: 'duration_min', label: 'Min', num: true },
      { key: 'start_battery_pct', label: 'Batt start', num: true },
      { key: 'end_battery_pct', label: 'Batt end', num: true },
      { key: 'actions', label: 'Actions', num: true },
      { key: 'failed_actions', label: 'Failed', num: true },
      { key: 'anomalies', label: 'Anomalies', num: true },
      { key: 'needs_action', label: 'Need action', num: true, get: r => r.status_counts?.action ?? 0 },
    ],
    filters: [
      { key: 'configuration_version', label: 'Config', get: r => r.configuration_version },
      { key: 'mission_status', label: 'Status', get: r => r.mission_status },
    ],
  },
  actions: {
    label: 'Actions',
    rowKey: r => r.action_id,
    columns: [
      { key: 'action_id', label: 'Action' },
      { key: 'mission_id', label: 'Mission' },
      { key: 'sequence', label: 'Seq', num: true },
      { key: 'action_type', label: 'Type' },
      { key: 'location', label: 'Waypoint', get: r => r.location.id },
      { key: 'asset', label: 'Asset', get: r => r.asset.id },
      { key: 'outcome', label: 'Outcome' },
      { key: 'failure_type', label: 'Failure type' },
      { key: 'battery_pct', label: 'Battery', num: true },
      { key: 'duration_sec', label: 'Sec', num: true },
      { key: 'predicted_failure_risk', label: 'Risk', num: true, render: r => num(r.predicted_failure_risk, 3) },
      { key: 'status', label: 'Status', render: statusCell },
    ],
    filters: [
      { key: 'configuration_version', label: 'Config', get: r => r.configuration_version },
      { key: 'action_type', label: 'Type', get: r => r.action_type },
      { key: 'outcome', label: 'Outcome', get: r => r.outcome },
      { key: 'location', label: 'Waypoint', get: r => r.location.id },
      { key: 'status', label: 'Status', get: r => r.status },
    ],
  },
  readings: {
    label: 'Readings',
    rowKey: r => r.reading.reading_id,
    select: records => records.filter(r => r.reading),
    columns: [
      { key: 'reading_id', label: 'Reading', get: r => r.reading.reading_id },
      { key: 'action_id', label: 'Action' },
      { key: 'mission_id', label: 'Mission' },
      { key: 'measurement_type', label: 'Measurement', get: r => r.reading.measurement_type },
      { key: 'value', label: 'Value', num: true, get: r => r.reading.value },
      { key: 'unit', label: 'Unit', get: r => r.reading.unit },
      { key: 'quality', label: 'Quality', get: r => r.reading.quality },
      { key: 'range', label: 'Usual range', get: r => (r.reading.usual_range ? `${num(r.reading.usual_range.low)}–${num(r.reading.usual_range.high)}` : null) },
      { key: 'position', label: 'Position', get: r => r.reading.position },
      { key: 'location', label: 'Waypoint', get: r => r.location.id },
    ],
    filters: [
      { key: 'measurement_type', label: 'Measurement', get: r => r.reading.measurement_type },
      { key: 'quality', label: 'Quality', get: r => r.reading.quality },
      { key: 'position', label: 'Position', get: r => r.reading.position },
      { key: 'configuration_version', label: 'Config', get: r => r.configuration_version },
    ],
  },
  anomalies: {
    label: 'Anomalies',
    rowKey: r => r.anomaly.anomaly_id,
    select: records => records.filter(r => r.anomaly),
    columns: [
      { key: 'anomaly_id', label: 'Anomaly', get: r => r.anomaly.anomaly_id },
      { key: 'action_id', label: 'Action' },
      { key: 'mission_id', label: 'Mission' },
      { key: 'type', label: 'Type', get: r => r.anomaly.type },
      { key: 'severity', label: 'Severity', get: r => r.anomaly.severity, render: r => <Badge tone={severityTone(r.anomaly.severity)}>{r.anomaly.severity}</Badge> },
      { key: 'review', label: 'Review', get: r => (r.anomaly.operator_review_required ? 'yes' : 'no') },
      { key: 'location', label: 'Waypoint', get: r => r.location.id },
      { key: 'asset', label: 'Asset', get: r => r.asset.id },
      { key: 'criticality', label: 'Criticality', get: r => r.asset.criticality },
    ],
    filters: [
      { key: 'type', label: 'Type', get: r => r.anomaly.type },
      { key: 'severity', label: 'Severity', get: r => r.anomaly.severity },
      { key: 'configuration_version', label: 'Config', get: r => r.configuration_version },
    ],
  },
};

const WAYPOINT_COLUMNS = [
  { key: 'id', label: 'Waypoint' },
  { key: 'name', label: 'Name' },
  { key: 'floor', label: 'Floor', num: true },
  { key: 'actions', label: 'Actions', num: true },
  { key: 'failure_pct', label: 'Failed %', num: true },
  { key: 'v1', label: 'V1 %', num: true, get: w => w.by_configuration?.V1?.failure_pct ?? null },
  { key: 'v2', label: 'V2 %', num: true, get: w => w.by_configuration?.V2?.failure_pct ?? null },
  { key: 'anomalies', label: 'Anomalies', num: true },
  { key: 'top', label: 'Failure types', get: w => Object.entries(w.top_failures || {}).map(([k, v]) => `${k} ×${v}`).join(', ') },
  { key: 'predicted_failure_risk', label: 'Risk', num: true },
  { key: 'status', label: 'Status', render: statusCell },
];

function Outcomes({ compare }) {
  const { V1, V2, tests, summary, changes } = compare;
  const headline = ['action_success_pct', 'mission_completion_pct', 'anomalies_per_mission', 'avg_battery_drain_pct', 'avg_end_battery_pct', 'reading_good_pct', 'hidden_failure_missions', 'avg_predicted_failure_risk'];
  const verdict = Object.fromEntries(changes.map(c => [c.kpi, c.verdict]));
  return (
    <>
      <p className="lead">{summary}</p>
      <div className="table-scroll">
        <table>
          <caption className="sr-only">BASELINE (V1) vs IMPROVED (V2)</caption>
          <thead><tr><th scope="col">KPI</th><th scope="col" className="num">V1 · {V1.missions} missions</th><th scope="col" className="num">V2 · {V2.missions} missions</th><th scope="col" className="num">Δ</th></tr></thead>
          <tbody>
            {headline.map(k => {
              const d = V2[k] - V1[k];
              const v = verdict[k];
              return (
                <tr key={k}>
                  <th scope="row">{kpiLabel(k)}</th>
                  <td className="num">{num(V1[k])}</td>
                  <td className="num">{num(V2[k])}</td>
                  <td className={`num delta ${v === 'improved' ? 'tone-ok' : v === 'degraded' ? 'tone-bad' : ''}`}>{v === 'improved' ? '▲' : v === 'degraded' ? '▼' : ''} {d > 0 ? '+' : ''}{num(d)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <h3>Significance</h3>
      <div className="table-scroll">
        <table>
          <thead><tr><th scope="col">Test</th><th scope="col" className="num">V1</th><th scope="col" className="num">V2</th><th scope="col" className="num">p-value</th><th scope="col">Method</th></tr></thead>
          <tbody>
            {Object.entries(tests).map(([k, t]) => (
              <tr key={k}><th scope="row">{k.replace(/_/g, ' ')}</th><td className="num">{t.V1}</td><td className="num">{t.V2}</td><td className={`num ${t.p_value < 0.05 ? 'tone-ok' : ''}`}>{t.p_value}</td><td>{t.method}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3>Success rate by action type</h3>
      <div className="table-scroll">
        <table>
          <thead><tr><th scope="col">Action type</th><th scope="col" className="num">V1 %</th><th scope="col" className="num">V2 %</th></tr></thead>
          <tbody>
            {Object.keys(V1.action_success_pct_by_type).map(t => (
              <tr key={t}><th scope="row">{t}</th><td className="num">{num(V1.action_success_pct_by_type[t])}</td><td className="num">{num(V2.action_success_pct_by_type?.[t])}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function ModelMetrics({ m }) {
  const t = m.test, cm = t.confusion_matrix;
  const rows = [['Random forest (selected)', t], ...Object.entries(m.baselines || {}).map(([k, b]) => [k === 'battery_rule' ? `Rule: ${b.rule}` : k.replace(/_/g, ' '), b])];
  return (
    <>
      <p className="lead">{m.target}. Split: {m.split.method} — {m.split.train_actions} train / {m.split.test_actions} test actions ({m.split.test_failures} test failures). Threshold {m.decision_threshold}.</p>
      <div className="stat-grid">
        <Stat label="Precision" value={num(t.precision, 3)} />
        <Stat label="Recall" value={num(t.recall, 3)} />
        <Stat label="F1" value={num(t.f1, 3)} tone="accent" />
        <Stat label="PR-AUC" value={num(t.pr_auc, 3)} />
        <Stat label="ROC-AUC" value={num(t.roc_auc, 3)} />
      </div>
      <div className="two-col">
        <div>
          <h3>Confusion matrix (test)</h3>
          <table className="confusion">
            <thead><tr><th /><th scope="col">Predicted success</th><th scope="col">Predicted failure</th></tr></thead>
            <tbody>
              <tr><th scope="row">Actual success</th><td>{cm.true_negative}<small>TN</small></td><td className="tone-warn">{cm.false_positive}<small>FP</small></td></tr>
              <tr><th scope="row">Actual failure</th><td className="tone-bad">{cm.false_negative}<small>FN</small></td><td className="tone-ok">{cm.true_positive}<small>TP</small></td></tr>
            </tbody>
          </table>
        </div>
        <div>
          <h3>Cross-validation</h3>
          <p className="muted">{m.cross_validation.method}; selected by {m.cross_validation.selected_by}.</p>
          <table>
            <thead><tr><th scope="col">Model</th><th scope="col" className="num">PR-AUC</th><th scope="col" className="num">F1</th></tr></thead>
            <tbody>
              {Object.entries(m.cross_validation.candidates).map(([k, c]) => (
                <tr key={k}><th scope="row">{k.replace(/_/g, ' ')}{k === m.cross_validation.selected ? ' ★' : ''}</th>
                  <td className="num">{num(c.pr_auc_mean, 3)} ± {num(c.pr_auc_std, 3)}</td><td className="num">{num(c.f1_mean, 3)} ± {num(c.f1_std, 3)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <h3>Against simple baselines (test set)</h3>
      <div className="table-scroll">
        <table>
          <thead><tr><th scope="col">Approach</th><th scope="col" className="num">Precision</th><th scope="col" className="num">Recall</th><th scope="col" className="num">F1</th><th scope="col" className="num">PR-AUC</th><th scope="col" className="num">Accuracy</th></tr></thead>
          <tbody>
            {rows.map(([name, r]) => (
              <tr key={name}><th scope="row">{name}</th><td className="num">{num(r.precision, 3)}</td><td className="num">{num(r.recall, 3)}</td><td className="num">{num(r.f1, 3)}</td><td className="num">{num(r.pr_auc, 3)}</td><td className="num">{num(r.accuracy, 3)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted">Accuracy is shown for completeness only: always predicting “success” scores {num(m.baselines?.always_predict_success?.accuracy, 2)} with zero recall.</p>
      {m.feature_importance && (
        <>
          <h3>Permutation feature importance</h3>
          <table>
            <tbody>{m.feature_importance.map(f => <tr key={f.feature}><th scope="row">{f.feature}</th><td className="num">{num(f.importance, 4)}</td></tr>)}</tbody>
          </table>
        </>
      )}
    </>
  );
}

export default function DataScientist() {
  const [table, setTable] = useState('actions');
  const [busy, setBusy] = useState(false);
  const [pdfError, setPdfError] = useState('');
  const missions = useApi('/missions');
  const records = useApi('/records?limit=5000');
  const compare = useApi('/compare');
  const metrics = useApi('/metrics');
  const waypoints = useApi('/waypoints');
  const summary = useApi('/summary');
  const insights = useApi('/insights');
  const spec = TABLES[table];
  const tableState = table === 'missions' ? missions : { ...records, data: records.data && (spec.select ? spec.select(records.data.records) : records.data.records) };

  async function pdf() {
    setBusy(true);
    setPdfError('');
    try {
      await downloadReport({
        title: 'Spot mission report', subtitle: 'Every mission, waypoint and finding, with what needs attention and how the failure-risk model performs.',
        kpis: summary.data.kpis, compare: compare.data, metrics: metrics.data, waypoints: waypoints.data, ops: summary.data.ops,
        missions: missions.data, insights: insights.data, attention: summary.data.needs_attention,
      });
    } catch (e) {
      setPdfError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <header className="page-head">
        <div>
          <p className="eyebrow">Performance & evidence</p>
          <h1>Mission analytics</h1>
          <p className="lead">Compare configurations, investigate failures, and export mission data.</p>
        </div>
        <div className="page-actions">
          <button type="button" className="btn btn-accent" onClick={pdf} disabled={busy || !summary.data}>{busy ? 'Building PDF…' : 'Export PDF report'}</button>
          {pdfError && <p className="note note-error" role="alert">{pdfError}</p>}
        </div>
      </header>

      <Section eyebrow="Outcomes" title="Baseline (V1) vs improved (V2)" id="ds-compare">
        <Async state={compare}>{c => <Outcomes compare={c} />}</Async>
      </Section>

      <Section eyebrow="Outcomes" title="Failures per waypoint" id="ds-waypoints">
        <Async state={waypoints}>{w => <DataTable rows={w} columns={WAYPOINT_COLUMNS} caption="Waypoints" rowKey={r => r.id} />}</Async>
      </Section>

      <Section eyebrow="Failure-risk model" title="Model performance" id="ds-model">
        <Async state={metrics}>{m => <ModelMetrics m={m} />}</Async>
      </Section>

      <Section
        eyebrow="Raw data"
        title={spec.label}
        id="ds-tables"
        actions={<Segmented label="Table" options={Object.entries(TABLES).map(([k, t]) => [k, t.label])} value={table} onChange={setTable} />}
      >
        <Async state={tableState}>
          {rows => <DataTable key={table} rows={rows} columns={spec.columns} filters={spec.filters} caption={spec.label} rowKey={spec.rowKey} />}
        </Async>
      </Section>
    </>
  );
}
