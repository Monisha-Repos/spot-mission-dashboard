import { kpiLabel, reportFilename } from './format.js';

const HEADLINE = [
  ['mission_completion_pct', '%'], ['action_success_pct', '%'], ['anomalies_per_mission', ''],
  ['serious_anomalies', ''], ['avg_battery_drain_pct', '%'], ['avg_end_battery_pct', '%'],
  ['reading_good_pct', '%'], ['hidden_failure_missions', ''], ['avg_predicted_failure_risk', ''],
];

const fmt = (v, suffix) => (v === null || v === undefined ? '—' : `${v}${suffix}`);

/**
 * One PDF for both "Generate PDF" (Data Scientist tab) and snapshot export (Operator Console).
 * kpis: { all, V1, V2 } from compute_kpis (GET /kpis or a snapshot); everything else is optional.
 */
export async function downloadReport({ title, subtitle, kpis, metrics, waypoints, compare, ops }) {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const now = new Date();
  const gold = [255, 192, 0];
  const head = { fillColor: [0, 0, 0], textColor: [255, 255, 255], fontStyle: 'bold' };
  let y = 40;

  doc.setFillColor(0, 0, 0);
  doc.rect(0, 0, doc.internal.pageSize.getWidth(), 70, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(18);
  doc.text(String(title).toUpperCase(), 40, 34);
  doc.setFontSize(9);
  doc.setTextColor(...gold);
  doc.text(`${subtitle ? subtitle + '  |  ' : ''}Generated ${now.toLocaleString()}`, 40, 52);
  doc.setTextColor(0, 0, 0);
  y = 92;

  const section = text => {
    if (y > 740) { doc.addPage(); y = 50; }
    doc.setFontSize(11);
    doc.text(text.toUpperCase(), 40, y);
    y += 8;
  };
  const table = (headRow, body) => {
    autoTable(doc, { startY: y, head: [headRow], body, headStyles: head, styles: { fontSize: 8, cellPadding: 4 }, margin: { left: 40, right: 40 } });
    y = doc.lastAutoTable.finalY + 22;
  };

  section('Key performance indicators');
  table(['KPI', 'All', 'V1 (baseline)', 'V2 (improved)'],
    HEADLINE.map(([k, s]) => [kpiLabel(k), fmt(kpis.all?.[k], s), fmt(kpis.V1?.[k], s), fmt(kpis.V2?.[k], s)]));

  const types = Object.keys(kpis.all?.action_success_pct_by_type || {});
  if (types.length) {
    section('Action success by type');
    table(['Action type', 'All', 'V1', 'V2'], types.map(t => [t, ...['all', 'V1', 'V2'].map(s => fmt(kpis[s]?.action_success_pct_by_type?.[t], '%'))]));
  }

  if (compare?.tests) {
    section('V1 vs V2 significance');
    table(['Test', 'V1', 'V2', 'p-value', 'Method'], Object.entries(compare.tests).map(([k, t]) => [k.replace(/_/g, ' '), t.V1, t.V2, t.p_value, t.method]));
  }

  if (waypoints?.length) {
    section('Failure rate by waypoint');
    table(['Waypoint', 'Name', 'Floor', 'Status', 'Actions', 'Failed %', 'V1 %', 'V2 %', 'Top failure'],
      waypoints.map(w => [w.id, w.name, w.floor, w.status, w.actions, w.failure_pct, w.by_configuration?.V1?.failure_pct ?? '—',
        w.by_configuration?.V2?.failure_pct ?? '—', Object.keys(w.top_failures || {})[0] || '—']));
  } else if (kpis.all?.failure_pct_by_waypoint) {
    section('Failure rate by waypoint');
    table(['Waypoint', 'All %', 'V1 %', 'V2 %'], Object.keys(kpis.all.failure_pct_by_waypoint).map(w =>
      [w, ...['all', 'V1', 'V2'].map(s => fmt(kpis[s]?.failure_pct_by_waypoint?.[w], ''))]));
  }

  if (ops) {
    section('Operator console');
    table(['Metric', 'Value'], Object.entries(ops).map(([k, v]) => [k.replace(/_/g, ' '), v ?? '—']));
  }

  if (metrics?.test) {
    const t = metrics.test, cm = t.confusion_matrix;
    section(`Failure-risk model (${metrics.model_type}, held-out test set)`);
    table(['Precision', 'Recall', 'F1', 'PR-AUC', 'ROC-AUC', 'TN / FP / FN / TP'],
      [[t.precision, t.recall, t.f1, t.pr_auc, t.roc_auc, `${cm.true_negative} / ${cm.false_positive} / ${cm.false_negative} / ${cm.true_positive}`]]);
  }

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(120, 120, 120);
    doc.text(`spotat.work | synthetic challenge data | page ${i} of ${pages}`, 40, doc.internal.pageSize.getHeight() - 20);
  }
  doc.save(reportFilename(now));
}
