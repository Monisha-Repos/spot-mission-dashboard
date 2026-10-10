// Temporary: build both PDF variants from real backend data so they can be rendered and inspected. Deleted after use.
import { readFileSync, writeFileSync } from 'node:fs';
import { buildReport } from './src/lib/report.js';

const out = '../tmp/pdfs';
const d = JSON.parse(readFileSync(`${out}/data.json`, 'utf8'));
const s = JSON.parse(readFileSync(`${out}/snapshot.json`, 'utf8'));
const now = new Date('2026-10-10T16:40:00');

const full = await buildReport({
  now, title: 'Spot mission report',
  subtitle: 'Every mission, waypoint and finding, with what needs attention and how the failure-risk model performs.',
  kpis: d.kpis, compare: d.compare, metrics: d.metrics, waypoints: d.waypoints, ops: d.ops,
  missions: d.missions, insights: d.insights, attention: d.needs_attention,
});
writeFileSync(`${out}/report.pdf`, Buffer.from(full.output('arraybuffer')));

const snap = await buildReport({
  now, kind: 'snapshot', title: `Snapshot: ${s.label}`,
  subtitle: `Saved by ${s.created_by}. Covers ${s.missions} missions.`, note: s.note, asOf: s.as_of, kpis: s.kpis, ops: s.kpis.all?.ops,
});
writeFileSync(`${out}/snapshot.pdf`, Buffer.from(snap.output('arraybuffer')));
console.log('pages', full.getNumberOfPages(), snap.getNumberOfPages());
