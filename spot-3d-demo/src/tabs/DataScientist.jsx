import React, { useState } from 'react';
import { api, useApi, useApp } from '../api.js';
import { useLive } from '../live/LiveContext.jsx';
import { Async, Badge, Hint, Section, Segmented, Stat } from '../components/ui.jsx';
import DataTable from '../components/DataTable.jsx';
import { downloadReport } from '../lib/report.js';
import {
  GLOSSARY, deltaArrow, formatTime, humanize, kpiDelta, kpiLabel, kpiValue, measurementLabel, num, sentence, severityTone, tone,
} from '../lib/format.js';
import { scrollToEl } from '../lib/dom.js';

const statusCell = r => <Badge tone={tone(r.status)}>{r.status}</Badge>;
const asText = v => sentence(v);
const RISK_HINT = GLOSSARY.predicted_failure_risk;

const TABLES = {
  missions: {
    label: 'Missions',
    rowKey: r => r.mission_id,
    columns: [
      { key: 'mission_id', label: 'Mission' },
      { key: 'configuration_version', label: 'Config' },
      { key: 'scenario', label: 'Scenario', show: asText },
      { key: 'mission_status', label: 'Status', show: asText },
      { key: 'start_time', label: 'Start', show: v => formatTime(v) },
      { key: 'duration_min', label: 'Min', num: true },
      { key: 'start_battery_pct', label: 'Batt start %', num: true },
      { key: 'end_battery_pct', label: 'Batt end %', num: true },
      { key: 'actions', label: 'Actions', num: true },
      { key: 'failed_actions', label: 'Failed', num: true },
      { key: 'anomalies', label: 'Anomalies', num: true },
      { key: 'needs_action', label: 'Need action', num: true, get: r => r.status_counts?.action ?? 0 },
    ],
    filters: [
      { key: 'configuration_version', label: 'Config', get: r => r.configuration_version },
      { key: 'mission_status', label: 'Status', get: r => r.mission_status, show: asText },
    ],
  },
  actions: {
    label: 'Actions',
    rowKey: r => r.action_id,
    columns: [
      { key: 'action_id', label: 'Action' },
      { key: 'mission_id', label: 'Mission' },
      { key: 'sequence', label: 'Seq', num: true },
      { key: 'action_type', label: 'Type', show: asText },
      { key: 'location', label: 'Waypoint', get: r => r.location.id },
      { key: 'asset', label: 'Asset', get: r => r.asset.id },
      { key: 'outcome', label: 'Outcome', show: asText },
      { key: 'failure_type', label: 'Failure type', show: asText },
      { key: 'battery_pct', label: 'Battery %', num: true },
      { key: 'duration_sec', label: 'Sec', num: true },
      { key: 'predicted_failure_risk', label: 'Risk', num: true, hint: RISK_HINT, render: r => num(r.predicted_failure_risk, 3) },
      { key: 'status', label: 'Status', render: statusCell },
    ],
    filters: [
      { key: 'configuration_version', label: 'Config', get: r => r.configuration_version },
      { key: 'action_type', label: 'Type', get: r => r.action_type, show: asText },
      { key: 'outcome', label: 'Outcome', get: r => r.outcome, show: asText },
      { key: 'location', label: 'Waypoint', get: r => r.location.id },
      { key: 'status', label: 'Status', get: r => r.status, show: asText },
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
      { key: 'measurement_type', label: 'Measurement', get: r => r.reading.measurement_type, show: v => measurementLabel(v) },
      { key: 'value', label: 'Value', num: true, get: r => r.reading.value },
      { key: 'unit', label: 'Unit', get: r => r.reading.unit },
      { key: 'quality', label: 'Quality', get: r => r.reading.quality, show: asText },
      { key: 'range', label: 'Usual range', get: r => (r.reading.usual_range ? `${num(r.reading.usual_range.low)}–${num(r.reading.usual_range.high)}` : null) },
      { key: 'position', label: 'Position', get: r => r.reading.position, show: asText },
      { key: 'location', label: 'Waypoint', get: r => r.location.id },
    ],
    filters: [
      { key: 'measurement_type', label: 'Measurement', get: r => r.reading.measurement_type, show: v => measurementLabel(v) },
      { key: 'quality', label: 'Quality', get: r => r.reading.quality, show: asText },
      { key: 'position', label: 'Position', get: r => r.reading.position, show: asText },
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
      { key: 'type', label: 'Type', get: r => r.anomaly.type, show: asText },
      { key: 'severity', label: 'Severity', get: r => r.anomaly.severity, render: r => <Badge tone={severityTone(r.anomaly.severity)}>{r.anomaly.severity}</Badge> },
      { key: 'review', label: 'Review', get: r => (r.anomaly.operator_review_required ? 'yes' : 'no') },
      { key: 'location', label: 'Waypoint', get: r => r.location.id },
      { key: 'asset', label: 'Asset', get: r => r.asset.id },
      { key: 'criticality', label: 'Criticality', get: r => r.asset.criticality, show: asText },
    ],
    filters: [
      { key: 'type', label: 'Type', get: r => r.anomaly.type, show: asText },
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
  { key: 'top', label: 'Failure types', get: w => Object.entries(w.top_failures || {}).map(([k, v]) => `${humanize(k)} ×${v}`).join(', ') },
  { key: 'predicted_failure_risk', label: 'Risk', num: true, hint: RISK_HINT },
  { key: 'status', label: 'Status', render: statusCell },
];

const signed = v => `${v > 0 ? '+' : ''}${num(v, 1)}`;
const range = ci => `${signed(ci[0])} to ${signed(ci[1])}`;

/** How sure we are that V2 is better, and how much of it is the configuration itself. */
function Evidence({ detail }) {
  if (!detail?.available) return null;
  const { raw, gap, adjusted, avg_battery_at_action_pct: battery } = detail;
  return (
    <>
      <h3>How sure are we?</h3>
      <p>{detail.summary}</p>
      <div className="table-scroll">
        <table>
          <caption className="sr-only">Action success with 95% ranges, raw and like for like</caption>
          <thead><tr><th scope="col">Comparison</th><th scope="col" className="num">V1</th><th scope="col" className="num">V2</th><th scope="col" className="num">Gap (points)</th><th scope="col" className="num">95% range</th></tr></thead>
          <tbody>
            <tr>
              <th scope="row">Action success, as observed</th>
              <td className="num">{num(raw.V1.success_pct, 1)}% <small>({num(raw.V1.ci95[0], 1)}–{num(raw.V1.ci95[1], 1)})</small></td>
              <td className="num">{num(raw.V2.success_pct, 1)}% <small>({num(raw.V2.ci95[0], 1)}–{num(raw.V2.ci95[1], 1)})</small></td>
              <td className={`num ${gap.ci95[0] > 0 ? 'tone-ok' : ''}`}>{signed(gap.points)}</td>
              <td className="num">{range(gap.ci95)}</td>
            </tr>
            {adjusted && (
              <tr>
                <th scope="row">Like for like ({adjusted.controls.join(', ')} held the same)</th>
                <td className="num">{num(adjusted.success_pct_if_all_v1, 1)}%</td>
                <td className="num">{num(adjusted.success_pct_if_all_v2, 1)}%</td>
                <td className={`num ${adjusted.ci95[0] > 0 ? 'tone-ok' : ''}`}>{signed(adjusted.points)}</td>
                <td className="num">{range(adjusted.ci95)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="muted">Average battery when a step started: V1 {num(battery.V1, 0)}%, V2 {num(battery.V2, 0)}%. {detail.method}</p>
    </>
  );
}

const SECTIONS = [['ds-compare', 'Comparison'], ['ds-waypoints', 'Waypoints'], ['ds-model', 'Model'], ['ds-tables', 'Raw data']];

/** "Improved ▼ −27.9 pp": the arrow is the real direction, the word says whether that is good. */
function Change({ k, d, verdict }) {
  const cls = verdict === 'improved' ? 'tone-ok' : verdict === 'degraded' ? 'tone-bad' : '';
  return (
    <td className={`num delta ${cls}`}>
      {verdict === 'improved' || verdict === 'degraded' ? <span className="verdict">{verdict === 'improved' ? 'Improved' : 'Worse'}</span> : null}
      <span aria-hidden="true">{deltaArrow(d)}</span> {kpiDelta(k, d)}
    </td>
  );
}

function Outcomes({ compare }) {
  const { V1, V2, tests, summary, changes } = compare;
  if (!V1 || !V2) {
    return <p className="note" role="status">{summary}</p>;
  }
  const headline = ['action_success_pct', 'mission_completion_pct', 'anomalies_per_mission', 'avg_battery_drain_pct', 'avg_end_battery_pct', 'reading_good_pct', 'hidden_failure_missions', 'avg_predicted_failure_risk'];
  const verdict = Object.fromEntries(changes.map(c => [c.kpi, c.verdict]));
  return (
    <>
      <p className="lead">{summary}</p>
      <Evidence detail={compare.detail} />
      <h3>Key numbers</h3>
      <div className="table-scroll">
        <table>
          <caption className="sr-only">BASELINE (V1) vs IMPROVED (V2)</caption>
          <thead><tr><th scope="col">KPI</th><th scope="col" className="num">V1 · {V1.missions} missions</th><th scope="col" className="num">V2 · {V2.missions} missions</th><th scope="col" className="num">Change V1 → V2</th></tr></thead>
          <tbody>
            {headline.map(k => (
              <tr key={k}>
                <th scope="row">{kpiLabel(k)}{GLOSSARY[k] && <Hint text={GLOSSARY[k]} label={`What is ${kpiLabel(k)}?`} />}</th>
                <td className="num">{kpiValue(k, V1[k])}</td>
                <td className="num">{kpiValue(k, V2[k])}</td>
                <Change k={k} d={V2[k] - V1[k]} verdict={verdict[k]} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="table-note muted">▲ / ▼ show which way the number moved; the word says whether that is better. Changes in percentages are in percentage points (pp).<Hint text={GLOSSARY.pp} label="What is a percentage point?" /></p>
      <h3>Significance</h3>
      <div className="table-scroll">
        <table>
          <thead><tr><th scope="col">Test</th><th scope="col" className="num">V1</th><th scope="col" className="num">V2</th><th scope="col" className="num">p-value<Hint text={GLOSSARY.p_value} label="What is a p-value?" /></th><th scope="col">Method</th></tr></thead>
          <tbody>
            {Object.entries(tests).map(([k, t]) => (
              <tr key={k}><th scope="row">{sentence(k)}</th><td className="num">{t.V1}</td><td className="num">{t.V2}</td><td className={`num ${t.p_value < 0.05 ? 'tone-ok' : ''}`}>{t.p_value}</td><td>{t.method}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3>Success rate by action type</h3>
      <div className="table-scroll">
        <table>
          <thead><tr><th scope="col">Action type</th><th scope="col" className="num">V1</th><th scope="col" className="num">V2</th></tr></thead>
          <tbody>
            {Object.keys(V1.action_success_pct_by_type).map(t => (
              <tr key={t}><th scope="row">{sentence(t)}</th><td className="num">{kpiValue('pct', V1.action_success_pct_by_type[t])}</td><td className="num">{kpiValue('pct', V2.action_success_pct_by_type?.[t])}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function ModelMetrics({ m, links }) {
  const t = m.test, cm = t.confusion_matrix;
  const rows = [[`${sentence(m.model_type)} (selected)`, t], ...Object.entries(m.baselines || {}).map(([k, b]) => [k === 'battery_rule' ? `Rule: ${b.rule}` : sentence(k), b])];
  return (
    <>
      <p className="lead">{m.target}. Threshold {m.decision_threshold}.</p>
      <h3>Training, test and live data</h3>
      <p>Split by whole mission, so no mission is in two sets{m.split.revision ? ` (dataset revision ${m.split.revision})` : ''}: {m.split.method}.</p>
      <div className="table-scroll">
        <table>
          <thead><tr><th scope="col">Set</th><th scope="col" className="num">Actions</th><th scope="col">Missions</th><th scope="col">Used for</th></tr></thead>
          <tbody>
            <tr><th scope="row">Train</th><td className="num">{m.split.train_actions}</td><td>{m.split.train_missions.join(', ')}</td><td>Fitting, model choice (cross-validation), threshold</td></tr>
            <tr><th scope="row">Test</th><td className="num">{m.split.test_actions}</td><td>{m.split.test_missions.join(', ')}</td><td>Scored once ({m.split.test_failures} failures); the numbers below</td></tr>
            {m.split.live_missions && <tr><th scope="row">Live</th><td className="num">{m.split.live_actions}</td><td>{m.split.live_missions.join(', ')}</td><td>Never used in training: scored as they stream in (below)</td></tr>}
          </tbody>
        </table>
      </div>
      {links && (links.dataset || links.model) && (
        <p className="hf-links">
          {links.dataset && (
            <a className="btn btn-ghost btn-sm" href={`https://huggingface.co/datasets/${links.dataset}`} target="_blank" rel="noreferrer" title={links.dataset}>
              Dataset on Hugging Face <span aria-hidden="true">↗</span><span className="sr-only"> (opens in a new tab)</span>
            </a>
          )}
          {links.model && (
            <a className="btn btn-ghost btn-sm" href={`https://huggingface.co/${links.model}`} target="_blank" rel="noreferrer" title={links.model}>
              Model on Hugging Face <span aria-hidden="true">↗</span><span className="sr-only"> (opens in a new tab)</span>
            </a>
          )}
        </p>
      )}
      <div className="stat-grid">
        <Stat label="Precision" value={num(t.precision, 3)} hint={GLOSSARY.precision} />
        <Stat label="Recall" value={num(t.recall, 3)} hint={GLOSSARY.recall} />
        <Stat label="F1" value={num(t.f1, 3)} tone="accent" hint={GLOSSARY.f1} />
        <Stat label="PR-AUC" value={num(t.pr_auc, 3)} hint={GLOSSARY.pr_auc} />
        <Stat label="ROC-AUC" value={num(t.roc_auc, 3)} hint={GLOSSARY.roc_auc} />
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
            <thead><tr><th scope="col">Model</th><th scope="col" className="num">PR-AUC<Hint text={GLOSSARY.pr_auc} label="What is PR-AUC?" /></th><th scope="col" className="num">F1<Hint text={GLOSSARY.f1} label="What is F1?" /></th></tr></thead>
            <tbody>
              {Object.entries(m.cross_validation.candidates).map(([k, c]) => (
                <tr key={k}><th scope="row">{sentence(k)}{k === m.cross_validation.selected ? ' ★' : ''}</th>
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
      {m.test_by_configuration && (
        <>
          <h3>Test set by configuration</h3>
          <div className="table-scroll">
            <table>
              <thead><tr><th scope="col">Configuration</th><th scope="col" className="num">Actions</th><th scope="col" className="num">Failures</th><th scope="col" className="num">Precision</th><th scope="col" className="num">Recall</th><th scope="col" className="num">F1</th></tr></thead>
              <tbody>
                {Object.entries(m.test_by_configuration).map(([cfg, r]) => (
                  <tr key={cfg}><th scope="row">{cfg}</th><td className="num">{r.actions}</td><td className="num">{r.failures}</td><td className="num">{num(r.precision, 3)}</td><td className="num">{num(r.recall, 3)}</td><td className="num">{num(r.f1, 3)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted">Few failures per configuration, so these are very noisy; read them next to the live results below.</p>
        </>
      )}
      {m.what_if_v2_as_v1 && (
        <p>What-if: the {m.what_if_v2_as_v1.v2_actions} V2 steps scored as if they had run on V1 (same battery, waypoint and action) average
          {' '}{num(100 * m.what_if_v2_as_v1.mean_risk_if_v1, 0)}% predicted risk, against {num(100 * m.what_if_v2_as_v1.mean_risk_as_v2, 0)}% as V2.
          {m.what_if_v2_as_v1.mean_risk_if_v1 <= m.what_if_v2_as_v1.mean_risk_as_v2
            ? ' The configuration label on its own does not lower the model’s risk estimate; the conditions V2 ran in do.'
            : ' The configuration itself lowers the model’s risk estimate.'}</p>
      )}
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

/** The model on the live missions it never trained on, filling in as they stream in. */
function LiveModel({ l }) {
  if (!l.available) return <p className="note">{l.summary}</p>;
  const row = (name, c) => c && (
    <tr key={name}><th scope="row">{name}</th><td className="num">{c.caught}</td><td className="num">{c.missed}</td><td className="num">{c.false_alarms}</td>
      <td className="num">{num(c.precision, 3)}</td><td className="num">{num(c.recall, 3)}</td></tr>
  );
  return (
    <>
      <p className="lead">{l.summary}</p>
      {l.drift && <p className="note note-error" role="status">{l.drift}</p>}
      {l.arrived.length > 0 && (
        <>
          <div className="stat-grid">
            <Stat label="Missions arrived" value={`${l.arrived.length} of ${l.live_missions.length}`} />
            <Stat label="Failures caught" value={`${l.model.caught} of ${l.failures}`} tone={l.model.caught ? 'ok' : 'bad'} />
            <Stat label="False alarms" value={l.model.false_alarms} />
            {l.ranking && <Stat label="PR-AUC" value={num(l.ranking.pr_auc, 3)} sub={`failure rate ${num(100 * l.ranking.base_rate, 1)}% = chance`} />}
          </div>
          <div className="table-scroll">
            <table>
              <thead><tr><th scope="col">Approach</th><th scope="col" className="num">Caught</th><th scope="col" className="num">Missed</th><th scope="col" className="num">False alarms</th><th scope="col" className="num">Precision</th><th scope="col" className="num">Recall</th></tr></thead>
              <tbody>
                {row(`Model (flag at ${num(100 * l.threshold, 0)}% risk)`, l.model)}
                {row(`Rule: ${l.battery_rule_text}`, l.battery_rule)}
              </tbody>
            </table>
          </div>
          <h3>By mission</h3>
          <table>
            <thead><tr><th scope="col">Mission</th><th scope="col" className="num">Steps</th><th scope="col" className="num">Failures</th><th scope="col" className="num">Caught</th><th scope="col" className="num">False alarms</th></tr></thead>
            <tbody>
              {l.per_mission.map(r => <tr key={r.mission_id}><th scope="row">{r.mission_id}</th><td className="num">{r.actions}</td><td className="num">{r.failures}</td><td className="num">{r.caught}</td><td className="num">{r.false_alarms}</td></tr>)}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}

export default function DataScientist() {
  const { notify } = useApp();
  const [table, setTable] = useState('actions');
  const [busy, setBusy] = useState(false);
  const [pdfError, setPdfError] = useState('');
  const missions = useApi('/missions');
  const records = useApi('/records?limit=5000');
  const compare = useApi('/compare');
  const metrics = useApi('/metrics');
  const modelLive = useApi('/model/live');
  const live = useLive();
  const waypoints = useApi('/waypoints');
  const summary = useApi('/summary');
  const insights = useApi('/insights');
  const spec = TABLES[table];
  const tableState = table === 'missions' ? missions : { ...records, data: records.data && (spec.select ? spec.select(records.data.records) : records.data.records) };

  async function pdf() {
    setBusy(true);
    setPdfError('');
    try {
      // The AI review is written when the PDF is made (one model call, cached on the server), not on every page view.
      const review = await api('/report/summary').catch(() => null);
      const sandbox = live.sandboxDone;
      await downloadReport({
        title: 'Spot mission report',
        subtitle: `Every mission, waypoint and finding, how the new data compares with the baseline, and how the failure-risk model performs${sandbox.length ? ` (includes ${sandbox.length} sandbox mission${sandbox.length === 1 ? '' : 's'} from this browser)` : ''}.`,
        kpis: summary.data.kpis, compare: compare.data, metrics: metrics.data, modelLive: modelLive.data, summary: review, sandbox,
        waypoints: waypoints.data, ops: summary.data.ops, missions: missions.data, insights: insights.data, attention: summary.data.needs_attention,
      });
      notify('PDF download started');
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
          <p className="eyebrow">Technical view</p>
          <h1>Data analysis</h1>
        </div>
        <div className="page-actions">
          <button type="button" className="btn btn-accent" onClick={pdf} disabled={busy || !summary.data}>{busy ? 'Building PDF…' : 'Generate PDF'}</button>
          {pdfError && <p className="note note-error" role="alert">{pdfError}</p>}
        </div>
      </header>
      <nav className="jump-links" aria-label="Sections on this page">
        {SECTIONS.map(([id, label]) => (
          <a key={id} href={`#${id}`} onClick={e => { e.preventDefault(); scrollToEl(id); }}>{label}</a>
        ))}
      </nav>

      <Section eyebrow="Outcomes" title="Baseline (V1) vs improved (V2)" id="ds-compare">
        <Async state={compare}>{c => <Outcomes compare={c} />}</Async>
      </Section>

      <Section eyebrow="Outcomes" title="Failures per waypoint" id="ds-waypoints">
        <Async state={waypoints}>{w => <DataTable rows={w} columns={WAYPOINT_COLUMNS} caption="Waypoints" rowKey={r => r.id} />}</Async>
      </Section>

      <Section eyebrow="Failure-risk model" title="Model performance" id="ds-model">
        <Async state={metrics}>{m => <ModelMetrics m={m} links={modelLive.data && { dataset: modelLive.data.dataset_repo, model: modelLive.data.model_repo }} />}</Async>
      </Section>

      <Section eyebrow="Failure-risk model" title="On missions it has never seen (live)" id="ds-live-model">
        <Async state={modelLive}>{l => <LiveModel l={l} />}</Async>
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
