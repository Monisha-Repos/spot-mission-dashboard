// PDF report shared by "Generate PDF" (Data Analysis tab) and snapshot export (Operator Console).
// Layout follows DESIGN-lamborghini.md: a true-black cover, white print pages with black chrome, Helvetica
// (the spec's fallback for LamboType) in uppercase at weight 400, sharp corners, hexagon marks, and gold as
// the one accent. Status colours stay green / amber / red, as in the app. Charts are drawn as vectors.
import { humanize, kpiLabel, reading, reportFilename } from './format.js';

const PAGE = { w: 595.28, h: 841.89, m: 40 };
const CW = PAGE.w - PAGE.m * 2;
const TOP = 66;                 // content starts below the black header band
const BOTTOM = PAGE.h - 54;     // and stops above the footer rule

const C = {
  black: [0, 0, 0], white: [255, 255, 255], iron: [24, 24, 24], charcoal: [32, 32, 32], shadow: [49, 49, 49],
  graphite: [73, 73, 73], slate: [102, 102, 102], ash: [125, 125, 125], steel: [150, 150, 150],
  line: [214, 214, 214], mist: [230, 230, 230], near: [246, 246, 246], smoke: [245, 245, 245],
  gold: [255, 192, 0], goldDark: [145, 115, 0], goldText: [122, 96, 0],
  ok: [29, 138, 66], warn: [184, 92, 0], bad: [200, 38, 27], critical: [128, 18, 12],
};
const TONE = { normal: C.ok, watch: C.warn, action: C.bad };
const SEV = { LOW: C.steel, MEDIUM: C.warn, HIGH: C.bad, CRITICAL: C.critical };
const STATUS_WORD = { normal: 'All good', watch: 'Keep an eye on', action: 'Needs action' };
const V1_COLOR = C.steel;
const V2_COLOR = C.gold;

/* ---------- text + number helpers (the standard PDF fonts only cover Latin-1) ---------- */

const clean = v => String(v ?? '')
  .replace(/[\u2010-\u2015\u2212]/g, '-')
  .replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"')
  .replace(/\u2192/g, 'to').replace(/\u2026/g, '...').replace(/\u00A0/g, ' ')
  .replace(/[^\x00-\xFF]/g, '');
const isNum = v => typeof v === 'number' && !Number.isNaN(v);
const pct = (v, d = 1) => (isNum(v) ? `${+v.toFixed(d)}%` : '-');
const n1 = v => (isNum(v) ? String(+v.toFixed(2)) : '-');
const pad2 = n => String(n).padStart(2, '0');
const asDate = v => (v instanceof Date ? v : new Date(v));
function dateLabel(v, withYear = true) {
  const d = asDate(v);
  return Number.isNaN(d.getTime()) ? clean(v) : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' } : {}) });
}
function dateTime(v) {
  const d = asDate(v);
  return Number.isNaN(d.getTime()) ? clean(v) : `${dateLabel(d)}, ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function dateRange(missions, asOf) {
  if (missions?.length) {
    const a = asDate(missions[0].start_time), b = asDate(missions[missions.length - 1].start_time);
    return a.getFullYear() === b.getFullYear() ? `${dateLabel(a, false)} - ${dateLabel(b)}` : `${dateLabel(a)} - ${dateLabel(b)}`;
  }
  return asOf ? `Data up to ${dateLabel(asOf)}` : '';
}
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

class Report {
  constructor(doc, autoTable, input) {
    this.doc = doc;
    this.autoTable = autoTable;
    this.in = input;
    this.now = input.now || new Date();
    this.y = TOP;
    this.chapterNo = 0;
  }

  /* ---------- drawing primitives ---------- */
  fill(c) { this.doc.setFillColor(...c); }
  stroke(c) { this.doc.setDrawColor(...c); }
  font(size, style = 'normal') { this.doc.setFont('helvetica', style); this.doc.setFontSize(size); }
  width(s, cs = 0) { return this.doc.getTextWidth(s) + cs * Math.max(0, s.length - 1); }

  /** One line of text. Alignment is computed here so letter-spaced text lines up too. */
  text(str, x, y, { size = 9, color = C.black, style = 'normal', upper = false, cs = 0, align = 'left', fit } = {}) {
    let s = clean(str);
    if (upper) s = s.toUpperCase();
    this.font(size, style);
    while (fit && size > 6 && this.width(s, cs) > fit) { size -= 0.5; this.font(size, style); }
    this.doc.setTextColor(...color);
    const w = this.width(s, cs);
    const dx = align === 'right' ? -w : align === 'center' ? -w / 2 : 0;
    this.doc.text(s, x + dx, y, cs ? { charSpace: cs } : undefined);
    return w;
  }
  lines(str, w, size, style = 'normal') { this.font(size, style); return this.doc.splitTextToSize(clean(str), w); }
  /** Wrapped paragraph; returns its height. */
  para(str, x, y, w, { size = 9, color = C.graphite, lh = 1.42, style = 'normal', maxLines } = {}) {
    let ls = this.lines(str, w, size, style);
    if (maxLines && ls.length > maxLines) { ls = ls.slice(0, maxLines); ls[maxLines - 1] = `${ls[maxLines - 1].replace(/\s*\S*$/, '')}...`; }
    this.doc.setTextColor(...color);
    ls.forEach((l, i) => this.doc.text(l, x, y + i * size * lh));
    return ls.length * size * lh;
  }
  paraHeight(str, w, size, lh = 1.42) { return this.lines(str, w, size).length * size * lh; }
  rect(x, y, w, h, c) { this.fill(c); this.doc.rect(x, y, w, h, 'F'); }
  hline(x1, x2, y, c = C.mist, lw = 0.5) { this.stroke(c); this.doc.setLineWidth(lw); this.doc.line(x1, y, x2, y); }
  vline(x, y1, y2, c = C.mist, lw = 0.5) { this.stroke(c); this.doc.setLineWidth(lw); this.doc.line(x, y1, x, y2); }
  dashed(on) { this.doc.setLineDashPattern(on ? [2, 2] : [], 0); }
  poly(pts, c, style = 'F') {
    if (style.includes('F')) this.fill(c);
    if (style.includes('S')) this.stroke(c);
    const rel = pts.slice(1).map((p, i) => [p[0] - pts[i][0], p[1] - pts[i][1]]);
    this.doc.lines(rel, pts[0][0], pts[0][1], [1, 1], style, true);
  }
  /** The brand hexagon (flat top, pointed sides), same shape as the app's clip-path. */
  hex(cx, cy, r, c, style = 'F') {
    const h = r * 0.9;
    this.poly([[cx - r / 2, cy - h], [cx + r / 2, cy - h], [cx + r, cy], [cx + r / 2, cy + h], [cx - r / 2, cy + h], [cx - r, cy]], c, style);
  }
  /** Hexagon swatches with labels; returns the x where the legend ends. */
  legend(items, x, y) {
    let cx = x;
    for (const [label, color] of items) {
      this.hex(cx + 3.5, y - 2.4, 3.5, color);
      cx += 11 + this.text(label, cx + 11, y, { size: 6.5, color: C.graphite, upper: true, cs: 0.7 }) + 16;
    }
    return cx;
  }

  /* ---------- page flow ---------- */
  newPage() { this.doc.addPage(); this.y = TOP; }
  ensure(h) { if (this.y + h > BOTTOM) this.newPage(); }

  chapter(eyebrow, title, lead) {
    this.newPage();
    this.chapterNo += 1;
    const y = this.y + 6;
    this.text(`${pad2(this.chapterNo)}  /  ${eyebrow}`, PAGE.m, y, { size: 7, color: C.goldText, upper: true, cs: 1.6 });
    this.text(title, PAGE.m, y + 30, { size: 26, upper: true, fit: CW });
    let h = 44;
    if (lead) h += 6 + this.para(lead, PAGE.m, y + 50, 420, { size: 9.5, color: C.graphite });
    this.hline(PAGE.m, PAGE.m + CW, y + h, C.line);
    this.rect(PAGE.m, y + h - 1, 28, 2, C.gold);
    this.y = y + h + 24;
  }
  heading(title, caption, minBody = 90) {
    const capH = caption ? this.paraHeight(caption, CW, 8) : 0;
    this.ensure(26 + capH + minBody);
    this.text(title, PAGE.m, this.y + 8, { size: 9.5, upper: true, cs: 1.2 });
    if (caption) this.para(caption, PAGE.m, this.y + 22, CW, { size: 8, color: C.ash });
    this.y += caption ? 20 + capH + 10 : 22;
  }

  /* ---------- components ---------- */

  tiles(items, cols = 4, h = 76) {
    const gap = 6, w = (CW - gap * (cols - 1)) / cols, rows = Math.ceil(items.length / cols);
    this.ensure(rows * (h + gap));
    items.forEach((t, i) => {
      const x = PAGE.m + (i % cols) * (w + gap), y = this.y + Math.floor(i / cols) * (h + gap);
      this.rect(x, y, w, h, C.near);
      this.rect(x, y, 2, h, t.tone || C.line);
      this.text(t.label, x + 12, y + 17, { size: 6.3, color: C.ash, upper: true, cs: 0.8, fit: w - 20 });
      this.text(t.value, x + 12, y + 44, { size: 20, color: t.valueColor || C.black, fit: w - 22 });
      if (t.sub) this.para(t.sub, x + 12, y + 58, w - 20, { size: 7, color: C.slate, lh: 1.3, maxLines: 2 });
    });
    this.y += rows * (h + gap) + 16;
  }

  /** One full-width bar split into coloured parts, with a counted legend underneath. */
  stackBar(parts, h = 12) {
    const total = parts.reduce((s, p) => s + (p.value || 0), 0);
    this.ensure(h + 28);
    if (!total) return;
    let x = PAGE.m;
    for (const p of parts) {
      if (!p.value) continue;
      const w = (p.value / total) * CW;
      this.rect(x, this.y, Math.max(w - 1, 0.5), h, p.color);
      x += w;
    }
    let lx = PAGE.m;
    const ly = this.y + h + 16;
    for (const p of parts) {
      this.hex(lx + 3.5, ly - 2.6, 3.5, p.color);
      lx += 10 + this.text(`${p.value}`, lx + 10, ly, { size: 9 });
      lx += 4 + this.text(p.label, lx + 4, ly, { size: 6.5, color: C.graphite, upper: true, cs: 0.7 });
      lx += 4 + this.text(`(${pct((p.value / total) * 100, 0)})`, lx + 4, ly, { size: 6.5, color: C.ash }) + 18;
    }
    this.y += h + 32;
  }

  /** Before / after rows: a V1 bar and a V2 bar per metric, plus the change, coloured by whether it is better. */
  pairedBars(rows) {
    const labelW = 140, deltaW = 78, gapR = 40, x0 = PAGE.m + labelW, bw = CW - labelW - deltaW - gapR, rowH = 36;
    this.ensure(rows.length * rowH + 24);
    this.legend([['V1 baseline', V1_COLOR], ['V2 improved', V2_COLOR]], PAGE.m + labelW, this.y + 4);
    this.text('Change', PAGE.m + CW, this.y + 4, { size: 6.5, color: C.ash, upper: true, cs: 0.7, align: 'right' });
    this.y += 14;
    for (const r of rows) {
      const y = this.y, max = r.max || Math.max(r.a || 0, r.b || 0, 1) * 1.15;
      this.text(r.label, PAGE.m, y + 13, { size: 8.5, fit: labelW - 10 });
      if (r.note) this.text(r.note, PAGE.m, y + 23, { size: 6.5, color: C.ash, fit: labelW - 10 });
      [[r.a, V1_COLOR, 4], [r.b, V2_COLOR, 16]].forEach(([v, color, dy]) => {
        this.rect(x0, y + dy, bw, 9, C.near);
        if (isNum(v)) {
          const w = Math.max((v / max) * bw, 1);
          this.rect(x0, y + dy, w, 9, color);
          this.text(r.fmt(v), x0 + w + 5, y + dy + 7, { size: 7, color: C.graphite });
        }
      });
      if (isNum(r.a) && isNum(r.b)) {
        const d = r.b - r.a, same = Math.abs(d) < 0.005;
        const better = r.better === 'lower' ? d < 0 : d > 0;
        const sign = d > 0 ? '+' : '';
        this.text(same ? 'No change' : `${sign}${+d.toFixed(r.unit ? 1 : 2)}${r.unit ? ` ${r.unit}` : ''}`, PAGE.m + CW, y + 13,
          { size: 10, color: same ? C.ash : better ? C.ok : C.bad, align: 'right' });
        this.text(same ? '' : better ? 'Better' : 'Worse', PAGE.m + CW, y + 23, { size: 6.3, color: C.ash, upper: true, cs: 0.7, align: 'right' });
      }
      this.hline(PAGE.m, PAGE.m + CW, y + rowH - 4, C.mist);
      this.y += rowH;
    }
    this.y += 12;
  }

  /** Vertical columns. groups: [{label, values: [..], colors?: [..]}]. Returns the geometry for overlays. */
  columns({ groups, series, max = 100, h = 140, ticks = [0, 25, 50, 75, 100], yFmt = v => `${v}%`, valueFmt = v => pct(v, 0), labelSize = 6.5, extra = 0 }) {
    const axisW = 26, x0 = PAGE.m + axisW, w = CW - axisW;
    const gw = w / groups.length;
    const labelLines = Math.max(...groups.map(g => this.lines(g.label.toUpperCase(), gw - 4, labelSize).length));
    this.ensure(h + 18 + labelLines * 8 + extra);
    const top = this.y + 8, base = top + h;
    for (const t of ticks) {
      const yy = base - (t / max) * h;
      this.hline(x0, x0 + w, yy, t === 0 ? C.steel : C.mist, t === 0 ? 0.7 : 0.5);
      this.text(yFmt(t), x0 - 6, yy + 2.2, { size: 6, color: C.ash, align: 'right' });
    }
    const inner = Math.min(gw * 0.62, 26 * series.length), bw = inner / series.length;
    groups.forEach((g, i) => {
      const gx = x0 + i * gw + (gw - inner) / 2;
      g.values.forEach((v, j) => {
        if (!isNum(v)) return;
        const bh = Math.max((v / max) * h, 0.6), bx = gx + j * bw;
        this.rect(bx + 0.6, base - bh, bw - 1.2, bh, g.colors?.[j] || series[j].color);
        if (valueFmt) this.text(valueFmt(v), bx + bw / 2, base - bh - 3.5, { size: 5.8, color: C.graphite, align: 'center' });
      });
      this.lines(g.label.toUpperCase(), gw - 4, labelSize).forEach((l, k) =>
        this.text(l, x0 + i * gw + gw / 2, base + 11 + k * 7.5, { size: labelSize, color: C.graphite, align: 'center' }));
    });
    const geo = { x0, w, gw, top, base, h, max };
    this.y = base + 14 + labelLines * 7.5 + 10;
    return geo;
  }

  hbars(rows, { color = C.graphite, labelW = 150, valueFmt = v => String(v) } = {}) {
    const rowH = 17, max = Math.max(...rows.map(r => r.value), 1), bx = PAGE.m + labelW, bw = CW - labelW - 40;
    this.ensure(rows.length * rowH + 8);
    for (const r of rows) {
      this.text(r.label, PAGE.m, this.y + 9, { size: 8, fit: labelW - 10 });
      this.rect(bx, this.y + 3, bw, 7, C.near);
      this.rect(bx, this.y + 3, Math.max((r.value / max) * bw, 1), 7, r.color || color);
      this.text(valueFmt(r.value), PAGE.m + CW, this.y + 9, { size: 8, color: C.graphite, align: 'right' });
      this.y += rowH;
    }
    this.y += 14;
  }

  table(head, body, { columnStyles = {}, statusCol, colorCol, colorFn } = {}) {
    this.ensure(70);
    this.autoTable(this.doc, {
      startY: this.y,
      head: [head.map(h => clean(h).toUpperCase())],
      body: body.map(r => r.map(c => clean(c))),
      theme: 'plain',
      margin: { left: PAGE.m, right: PAGE.m, top: TOP, bottom: PAGE.h - BOTTOM },
      styles: {
        font: 'helvetica', fontSize: 7.4, textColor: C.charcoal, valign: 'middle', overflow: 'linebreak',
        cellPadding: { top: 4, bottom: 4, left: 6, right: 6 }, lineColor: C.mist, lineWidth: { bottom: 0.5 },
      },
      headStyles: { fillColor: C.black, textColor: C.white, fontSize: 6.2, fontStyle: 'normal', lineWidth: 0, cellPadding: { top: 6, bottom: 6, left: 6, right: 6 } },
      columnStyles,
      didParseCell: d => {
        // Headers follow their column's alignment.
        if (d.section === 'head') { const a = columnStyles[d.column.index]?.halign; if (a) d.cell.styles.halign = a; return; }
        if (d.section !== 'body') return;
        if (d.column.index === statusCol && STATUS_WORD[d.cell.raw]) {
          d.cell.text = [STATUS_WORD[d.cell.raw]];
          d.cell.styles.textColor = TONE[d.cell.raw];
          d.cell.styles.cellPadding = { top: 4, bottom: 4, left: 16, right: 6 };
        }
        if (d.column.index === colorCol && colorFn) {
          const c = colorFn(d.cell.raw, d.row.index);
          if (c) d.cell.styles.textColor = c;
        }
      },
      didDrawCell: d => {
        if (d.section === 'body' && d.column.index === statusCol && TONE[d.cell.raw]) {
          this.hex(d.cell.x + 9, d.cell.y + d.cell.height / 2, 3, TONE[d.cell.raw]);
        }
      },
    });
    this.y = this.doc.lastAutoTable.finalY + 22;
  }

  /* ---------- cover + chrome ---------- */

  cover() {
    const { kpis = {}, ops, missions, title, subtitle, kind = 'report', asOf, compare, note } = this.in;
    const k = kpis.all || {};
    this.rect(0, 0, PAGE.w, PAGE.h, C.black);

    // Hexagon geometry from the brand, kept almost invisible behind the title.
    this.doc.setLineWidth(0.8);
    this.hex(PAGE.w - 70, 360, 230, C.iron, 'S');
    this.hex(PAGE.w - 70, 360, 160, C.charcoal, 'S');
    this.hex(PAGE.w - 70, 360, 90, C.iron, 'S');

    this.hex(PAGE.m + 7, 56, 7, C.gold);
    this.text('spotat.work', PAGE.m + 22, 59.5, { size: 9, color: C.white, upper: true, cs: 2.4 });
    this.text(kind === 'snapshot' ? 'Performance snapshot' : 'Inspection report', PAGE.w - PAGE.m, 59.5, { size: 7, color: C.steel, upper: true, cs: 1.6, align: 'right' });

    const count = missions?.length || k.missions;
    const eyebrow = [count ? plural(count, 'mission') : null, dateRange(missions, asOf)].filter(Boolean).join('  /  ');
    let y = 292;
    if (eyebrow) this.text(eyebrow, PAGE.m, y, { size: 8, color: C.gold, upper: true, cs: 2 });
    y += 46;
    this.lines(clean(title).toUpperCase(), 470, 50).forEach(l => { this.text(l, PAGE.m, y, { size: 50, color: C.white }); y += 48; });
    y += 4;
    if (subtitle) y += this.para(subtitle, PAGE.m, y, 420, { size: 11.5, color: C.smoke, lh: 1.45 });
    const headline = note || compare?.summary;
    if (headline) this.para(headline, PAGE.m, y + 14, 400, { size: 9, color: C.steel, lh: 1.5, maxLines: 5 });

    // Hero numbers.
    const hero = [
      ['Action success', pct(k.action_success_pct), kpis.V1 && kpis.V2 ? `V1 ${pct(kpis.V1.action_success_pct)} to V2 ${pct(kpis.V2.action_success_pct)}` : `${k.actions ?? '-'} checks`, C.gold],
      ['Missions completed', pct(k.mission_completion_pct), `${k.missions ?? '-'} missions`, C.white],
      ['Findings', `${k.anomalies ?? '-'}`, `${k.serious_anomalies ?? '-'} high or critical`, C.white],
      ops ? ['Open issues', `${ops.open_issues ?? '-'}`, `${ops.pending_alarms ?? 0} alarms waiting`, C.white]
        : ['Battery per mission', pct(k.avg_battery_drain_pct, 0), `${pct(k.avg_end_battery_pct, 0)} left at the end`, C.white],
    ];
    const hy = 640, cw = CW / 4;
    this.hline(PAGE.m, PAGE.m + CW, hy, C.shadow, 0.6);
    hero.forEach(([label, value, sub, color], i) => {
      const x = PAGE.m + i * cw + (i ? 14 : 0);
      if (i) this.vline(PAGE.m + i * cw, hy + 14, hy + 86, C.shadow, 0.6);
      this.text(label, x, hy + 26, { size: 6.5, color: C.steel, upper: true, cs: 1.1 });
      this.text(value, x, hy + 62, { size: 30, color, fit: cw - 20 });
      this.text(sub, x, hy + 80, { size: 7.5, color: C.ash, fit: cw - 20 });
    });

    // Thin horizon line, like the progress bar under the site's hero.
    this.hline(PAGE.m, PAGE.m + CW, PAGE.h - 58, C.white, 0.5);
    this.text(`Generated ${dateTime(this.now)}`, PAGE.m, PAGE.h - 40, { size: 6.8, color: C.ash, upper: true, cs: 1 });
    this.text('Synthetic challenge data  /  Knight Hacks 2026', PAGE.w - PAGE.m, PAGE.h - 40, { size: 6.8, color: C.ash, upper: true, cs: 1, align: 'right' });
  }

  chrome() {
    const n = this.doc.getNumberOfPages();
    for (let i = 2; i <= n; i++) {
      this.doc.setPage(i);
      this.rect(0, 0, PAGE.w, 30, C.black);
      this.hex(PAGE.m + 4.5, 15, 4.5, C.gold);
      this.text('spotat.work', PAGE.m + 15, 17.6, { size: 6.8, color: C.white, upper: true, cs: 1.8 });
      this.text(this.in.title, PAGE.w - PAGE.m, 17.6, { size: 6.3, color: C.steel, upper: true, cs: 1.2, align: 'right', fit: 300 });
      this.hline(PAGE.m, PAGE.w - PAGE.m, PAGE.h - 34, C.line);
      this.text(`Generated ${dateTime(this.now)}  /  synthetic challenge data`, PAGE.m, PAGE.h - 21, { size: 6.2, color: C.ash, upper: true, cs: 0.8 });
      this.text(`${pad2(i)} / ${pad2(n)}`, PAGE.w - PAGE.m, PAGE.h - 21, { size: 7, upper: true, cs: 1.2, align: 'right' });
    }
  }

  /* ---------- chapters ---------- */

  atAGlance() {
    const { kpis = {}, ops, attention } = this.in;
    const k = kpis.all || {}, v1 = kpis.V1, v2 = kpis.V2;
    const both = (key, d = 1) => (v1 && v2 ? `V1 ${pct(v1[key], d)} to V2 ${pct(v2[key], d)}` : null);
    this.chapter('At a glance', 'The short version',
      'The numbers an operator needs before the shift: how reliably Spot did its checks, what it found, and what still needs a person.');

    this.tiles([
      { label: 'Action success', value: pct(k.action_success_pct), sub: both('action_success_pct'), tone: C.gold },
      { label: 'Missions completed', value: pct(k.mission_completion_pct), sub: `${k.missions ?? '-'} missions, ${k.actions ?? '-'} checks` },
      { label: 'Findings', value: `${k.anomalies ?? '-'}`, sub: `${k.serious_anomalies ?? '-'} high or critical`, tone: C.warn },
      { label: 'Hidden failures', value: `${k.hidden_failure_missions ?? '-'}`, sub: 'missions marked finished with a failed check', tone: C.bad },
      { label: 'Battery used per mission', value: pct(k.avg_battery_drain_pct, 0), sub: both('avg_battery_drain_pct', 0) },
      { label: 'Battery left at the end', value: pct(k.avg_end_battery_pct, 0), sub: both('avg_end_battery_pct', 0) },
      { label: 'Good readings', value: pct(k.reading_good_pct), sub: 'readings Spot rated as reliable' },
      ops
        ? { label: 'Open issues', value: `${ops.open_issues ?? '-'}`, sub: `${ops.resolved ?? 0} resolved, ${ops.false_alarms ?? 0} false alarms`, tone: ops.open_issues ? C.warn : C.ok }
        : { label: 'Avg. predicted risk', value: isNum(k.avg_predicted_failure_risk) ? pct(k.avg_predicted_failure_risk * 100, 0) : '-', sub: 'chance a check fails, from the model' },
    ]);

    const sc = k.status_counts;
    if (sc) {
      this.heading('How every check turned out', 'Each stop Spot made is rated with the same three colours used across the dashboard.', 40);
      this.stackBar([
        { label: STATUS_WORD.normal, value: sc.normal, color: C.ok },
        { label: STATUS_WORD.watch, value: sc.watch, color: C.warn },
        { label: STATUS_WORD.action, value: sc.action, color: C.bad },
      ]);
    }

    if (attention?.length) {
      const shown = attention.slice(0, 3);
      this.heading('Needs attention', 'The most serious findings first. Each one comes with a plain next step.', 110);
      shown.forEach(r => this.attentionItem(r));
      const total = sc?.action;
      if (total > shown.length) {
        this.ensure(16);
        this.text(`${total - shown.length} more checks need action. The Operator console on spotat.work lists every one.`, PAGE.m, this.y + 6, { size: 7.5, color: C.ash });
        this.y += 18;
      }
    }
  }

  attentionItem(r) {
    const sev = r.anomaly?.severity;
    const color = SEV[sev] || TONE[r.status] || C.bad;
    const pad = 14, w = CW - pad * 2 - 4;
    const explain = this.paraHeight(r.explanation, w, 8.3);
    const next = this.paraHeight(`Next step: ${r.recommended_action}`, w, 8.3);
    const h = 54 + explain + next;
    this.ensure(h + 8);
    const y = this.y, x = PAGE.m + pad + 4;
    this.rect(PAGE.m, y, CW, h, C.near);
    this.rect(PAGE.m, y, 3, h, color);
    const tag = [sev || (r.outcome === 'FAILED' ? 'Failed check' : STATUS_WORD[r.status]), r.anomaly ? humanize(r.anomaly.type) : humanize(r.failure_type)].filter(Boolean).join('  /  ');
    this.text(tag, x, y + 17, { size: 6.6, color, upper: true, cs: 1, fit: w - 120 });
    this.text(dateTime(r.timestamp), PAGE.m + CW - pad, y + 17, { size: 7, color: C.ash, align: 'right' });
    this.text(r.asset?.name, x, y + 33, { size: 12, upper: true, fit: w });
    const meta = [`${r.location?.id} ${r.location?.name}`, `Floor ${r.location?.floor}`, `Mission ${r.mission_id}`, r.reading ? `${r.reading.label} ${reading(r.reading)}` : null].filter(Boolean).join('  /  ');
    this.text(meta, x, y + 45, { size: 7.2, color: C.slate, fit: w });
    this.para(r.explanation, x, y + 59, w, { size: 8.3, color: C.charcoal });
    this.para(`Next step: ${r.recommended_action}`, x, y + 59 + explain, w, { size: 8.3, color: C.goldText });
    this.y += h + 8;
  }

  performance() {
    const { kpis = {}, compare, insights } = this.in;
    const v1 = kpis.V1, v2 = kpis.V2, all = kpis.all || {};
    const types = Object.keys(all.action_success_pct_by_type || {});
    if (!insights?.length && !(v1 && v2) && !types.length) return;
    this.chapter('Performance', v1 && v2 ? 'What changed' : 'How Spot performed',
      compare?.summary || 'How reliably each kind of check worked across the missions in this report.');

    if (insights?.length) {
      this.heading('What the data says', null, 60);
      insights.forEach((ins, i) => {
        const tw = CW - 34;
        const th = this.paraHeight(ins.title, tw, 10, 1.3), dh = this.paraHeight(ins.detail, tw, 8.3);
        const h = th + dh + 18;
        this.ensure(h);
        this.text(pad2(i + 1), PAGE.m, this.y + 10, { size: 11, color: C.goldText });
        this.para(ins.title, PAGE.m + 34, this.y + 10, tw, { size: 10, color: C.black, lh: 1.3 });
        this.para(ins.detail, PAGE.m + 34, this.y + 14 + th, tw, { size: 8.3, color: C.graphite });
        this.hline(PAGE.m + 34, PAGE.m + CW, this.y + h - 3, C.mist);
        this.y += h + 4;
      });
      this.y += 10;
    }

    if (v1 && v2) {
      this.heading('Before and after', 'Baseline setup (V1) compared with the improved setup (V2). Green means the change is an improvement.', 220);
      this.pairedBars([
        { label: 'Action success', a: v1.action_success_pct, b: v2.action_success_pct, max: 100, fmt: v => pct(v), unit: 'pts', better: 'higher' },
        { label: 'Missions completed', a: v1.mission_completion_pct, b: v2.mission_completion_pct, max: 100, fmt: v => pct(v), unit: 'pts', better: 'higher' },
        { label: 'Good readings', a: v1.reading_good_pct, b: v2.reading_good_pct, max: 100, fmt: v => pct(v), unit: 'pts', better: 'higher' },
        { label: 'Battery left at the end', a: v1.avg_end_battery_pct, b: v2.avg_end_battery_pct, max: 100, fmt: v => pct(v, 0), unit: 'pts', better: 'higher' },
        { label: 'Battery used per mission', a: v1.avg_battery_drain_pct, b: v2.avg_battery_drain_pct, max: 100, fmt: v => pct(v, 0), unit: 'pts', better: 'lower' },
        { label: 'Findings per mission', a: v1.anomalies_per_mission, b: v2.anomalies_per_mission, fmt: n1, better: 'lower', note: 'fewer is better' },
        { label: 'Average mission length', a: v1.avg_duration_min, b: v2.avg_duration_min, fmt: v => `${+v.toFixed(1)} min`, unit: 'min', better: 'lower' },
      ]);
    }

    if (types.length) {
      this.heading('Success by kind of check', 'Share of each kind of check that finished without a failure.', 190);
      const series = v1 && v2 ? [{ name: 'V1', color: V1_COLOR }, { name: 'V2', color: V2_COLOR }] : [{ name: 'All', color: C.graphite }];
      if (v1 && v2) this.legend([['V1 baseline', V1_COLOR], ['V2 improved', V2_COLOR]], PAGE.m + 26, this.y + 2);
      this.y += v1 && v2 ? 8 : 0;
      this.columns({
        groups: types.map(t => ({ label: humanize(t), values: v1 && v2 ? [v1.action_success_pct_by_type?.[t], v2.action_success_pct_by_type?.[t]] : [all.action_success_pct_by_type[t]] })),
        series,
      });
    }

    if (compare?.tests) {
      this.heading('Is the difference real?', 'Statistical tests on V1 vs V2. A p-value under 0.05 means the change is unlikely to be chance.', 70);
      const frac = s => { const [a, b] = String(s).split('/').map(Number); return b ? `${a} of ${b} (${pct((a / b) * 100)})` : clean(s); };
      this.table(['Measure', 'V1 baseline', 'V2 improved', 'p-value', 'Verdict', 'Method'],
        Object.entries(compare.tests).map(([key, t]) => [humanize(key), frac(t.V1), frac(t.V2), n1(t.p_value), t.p_value < 0.05 ? 'Real difference' : 'Could be chance', t.method]),
        { colorCol: 4, colorFn: v => (v === 'Real difference' ? C.ok : C.ash), columnStyles: { 3: { halign: 'right' } } });
    }
  }

  where() {
    const { kpis = {}, waypoints } = this.in;
    const all = kpis.all || {};
    const byWp = all.failure_pct_by_waypoint || {};
    const rows = waypoints?.length
      ? [...waypoints].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true })).map(w => ({ id: w.id, pct: w.failure_pct, floor: w.floor, status: w.status }))
      : Object.keys(byWp).sort().map(id => ({ id, pct: byWp[id] }));
    if (!rows.length && !all.anomalies_by_severity) return;
    this.chapter('Facility', 'Where problems happen',
      'Failed checks and findings by location, so the next walk-down can start at the worst spots.');

    if (rows.length) {
      const vals = rows.map(r => r.pct).filter(isNum);
      const top = Math.max(10, Math.ceil(Math.max(...vals) / 10) * 10);
      const avg = isNum(all.action_success_pct) ? 100 - all.action_success_pct : vals.reduce((s, v) => s + v, 0) / vals.length;
      this.heading('Failed checks by waypoint', waypoints?.length ? 'Bar colour is the waypoint\'s current status (worst result in its last five missions).' : 'Share of checks that failed at each waypoint.', 200);
      const lx = waypoints?.length ? this.legend([[STATUS_WORD.normal, C.ok], [STATUS_WORD.watch, C.warn], [STATUS_WORD.action, C.bad]], PAGE.m + 26, this.y + 2) : PAGE.m + 26;
      this.dashed(true); this.hline(lx, lx + 16, this.y - 0.4, C.black, 0.7); this.dashed(false);
      this.text(`Average ${pct(avg, 0)}`, lx + 22, this.y + 2, { size: 6.5, color: C.graphite, upper: true, cs: 0.7 });
      this.y += 8;
      const floors = rows.some(r => r.floor);
      const g = this.columns({
        groups: rows.map(r => ({ label: r.id, values: [r.pct], colors: [TONE[r.status] || C.graphite] })),
        series: [{ color: C.graphite }], max: top, ticks: [0, top / 4, top / 2, (top * 3) / 4, top].map(v => +v.toFixed(1)),
        yFmt: v => `${+v.toFixed(0)}%`, h: 130, extra: floors ? 18 : 0,
      });
      // Average line across the chart.
      const ay = g.base - (avg / g.max) * g.h;
      this.dashed(true); this.hline(g.x0, g.x0 + g.w, ay, C.black, 0.6); this.dashed(false);
      if (floors) {
        const fy = this.y - 4;
        for (const f of [...new Set(rows.map(r => r.floor))]) {
          const idx = rows.map((r, i) => (r.floor === f ? i : -1)).filter(i => i >= 0);
          const x1 = g.x0 + idx[0] * g.gw + 4, x2 = g.x0 + (idx[idx.length - 1] + 1) * g.gw - 4;
          this.hline(x1, x2, fy, C.steel, 0.6);
          this.vline(x1, fy - 3, fy, C.steel, 0.6);
          this.vline(x2, fy - 3, fy, C.steel, 0.6);
          this.rect((x1 + x2) / 2 - 22, fy - 3, 44, 7, C.white);
          this.text(`Floor ${f}`, (x1 + x2) / 2, fy + 2.2, { size: 6, color: C.ash, upper: true, cs: 0.8, align: 'center' });
        }
        this.y += 12;
      }
    }

    const sev = all.anomalies_by_severity;
    if (sev && Object.keys(sev).length) {
      this.heading('Findings by severity', `${all.anomalies} findings in total. High and critical ones always need a person to look.`, 40);
      this.stackBar(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].filter(s => sev[s]).map(s => ({ label: s.toLowerCase(), value: sev[s], color: SEV[s] })));
    }
    const types = all.anomalies_by_type;
    if (types && Object.keys(types).length) {
      this.heading('Findings by type', null, 60);
      this.hbars(Object.entries(types).sort((a, b) => b[1] - a[1]).map(([t, v]) => ({ label: humanize(t).replace(/^\w/, c => c.toUpperCase()), value: v })));
    }

  }

  waypointTable() {
    const { waypoints } = this.in;
    if (waypoints?.length) {
      this.heading('Waypoint details', 'Status is the worst result at the waypoint in its last five missions. Open counts issues still open in the Operator console.', 80);
      this.table(['Waypoint', 'Location', 'Floor', 'Status', 'Checks', 'Failed', 'V1 to V2', 'Most common problem', 'Open'],
        [...waypoints].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true })).map(w => [
          w.id, w.name, w.floor, w.status, w.actions, pct(w.failure_pct),
          `${pct(w.by_configuration?.V1?.failure_pct, 0)} to ${pct(w.by_configuration?.V2?.failure_pct, 0)}`,
          humanize(Object.keys(w.top_failures || {})[0]) || '-', w.open_issues ?? '-',
        ]),
        { statusCol: 3, columnStyles: { 2: { halign: 'center' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 8: { halign: 'right' } } });
    }
  }

  history() {
    const { missions } = this.in;
    if (!missions?.length) return;
    this.chapter('Mission history', 'Every run, in order',
      'One column per mission. Gold columns use the improved setup (V2); a red hexagon marks a run that stopped early.');

    const n = missions.length, axisW = 26, x0 = PAGE.m + axisW, w = CW - axisW, slot = w / n, bw = Math.min(13, slot * 0.6);
    const cx = i => x0 + i * slot + slot / 2;
    const split = missions.findIndex(m => m.configuration_version === 'V2');

    const axis = (base, h, ticks, fmt) => ticks.forEach(t => {
      const yy = base - (t / 100) * h;
      this.hline(x0, x0 + w, yy, t === 0 ? C.steel : C.mist, t === 0 ? 0.7 : 0.5);
      this.text(fmt(t), x0 - 6, yy + 2.2, { size: 6, color: C.ash, align: 'right' });
    });
    const divider = (top, base) => {
      if (split <= 0) return;
      const dx = x0 + split * slot;
      this.dashed(true); this.vline(dx, top - 20, base, C.black, 0.6); this.dashed(false);
    };

    // 1. Action success per mission.
    this.heading('Checks that succeeded, per mission', null, 170);
    this.legend([['V1 baseline', V1_COLOR], ['V2 improved', V2_COLOR], ['Stopped early', C.bad]], x0, this.y + 2);
    this.y += 14;
    let h = 110, top = this.y + 34, base = top + h;
    axis(base, h, [0, 50, 100], t => `${t}%`);
    divider(top, base);
    if (split > 0) {
      this.text('Baseline (V1)', x0 + split * slot - 6, top - 16, { size: 6, color: C.ash, upper: true, cs: 0.8, align: 'right' });
      this.text('Improved (V2)', x0 + split * slot + 6, top - 16, { size: 6, color: C.goldText, upper: true, cs: 0.8 });
    }
    missions.forEach((m, i) => {
      const v = m.actions ? ((m.actions - m.failed_actions) / m.actions) * 100 : 0;
      const bh = Math.max((v / 100) * h, 0.6);
      this.rect(cx(i) - bw / 2, base - bh, bw, bh, m.configuration_version === 'V2' ? V2_COLOR : V1_COLOR);
      this.text(`${Math.round(v)}`, cx(i), base - bh - 3.5, { size: 5.6, color: C.graphite, align: 'center' });
      if (m.mission_status === 'FAILED') this.hex(cx(i), base - bh - 16, 3.2, C.bad);
    });
    this.y = base + 22;

    // 2. Battery: start to end for each mission.
    this.heading('Battery, start to end', 'The line runs from the battery level at the start of a run to the level at the end (hexagon). Red: under 20% left.', 120);
    h = 92; top = this.y + 8; base = top + h;
    axis(base, h, [0, 50, 100], t => `${t}%`);
    divider(top, base);
    missions.forEach((m, i) => {
      const ys = base - (m.start_battery_pct / 100) * h, ye = base - (m.end_battery_pct / 100) * h;
      this.vline(cx(i), ys, ye, C.graphite, 1.4);
      this.hline(cx(i) - 3, cx(i) + 3, ys, C.graphite, 1.4);
      this.hex(cx(i), ye, 3.4, m.end_battery_pct < 20 ? C.bad : m.end_battery_pct < 35 ? C.warn : C.ok);
    });
    missions.forEach((m, i) => this.text(m.mission_id.replace(/^M0?/, ''), cx(i), base + 10, { size: 5.8, color: C.ash, align: 'center' }));
    this.text('Mission number', x0 + w, base + 21, { size: 5.8, color: C.ash, upper: true, cs: 0.8, align: 'right' });
    this.y = base + 34;
  }

  missionLog() {
    const { missions } = this.in;
    if (!missions?.length) return;
    this.heading('Mission log', 'Findings count every stop rated keep an eye on or needs action. A run can be marked finished while some of its checks failed.', 80);
    this.table(['Mission', 'Started', 'Setup', 'Length', 'Stops', 'Findings', 'Battery', 'Result'],
      missions.map(m => {
        const f = (m.status_counts?.watch || 0) + (m.status_counts?.action || 0);
        return [
          m.mission_id, dateTime(m.start_time), m.configuration_version, `${m.duration_min} min`, m.actions,
          f ? `${f}${m.status_counts?.action ? ` (${m.status_counts.action} action)` : ''}` : 'None',
          `${m.start_battery_pct}% to ${m.end_battery_pct}%`,
          m.mission_status === 'FAILED' ? 'Stopped early' : m.hidden_failures ? `Finished, ${plural(m.failed_actions, 'failed check')}` : 'Finished',
        ];
      }),
      {
        colorCol: 7,
        colorFn: v => (v === 'Stopped early' ? C.bad : v.startsWith('Finished,') ? C.warn : C.ok),
        columnStyles: { 3: { halign: 'right' }, 4: { halign: 'right' } },
      });
  }

  modelAndOps() {
    const { metrics, ops } = this.in;
    const t = metrics?.test;
    if (!t && !ops) return;
    this.chapter(t ? 'Model and operations' : 'Operations', t ? 'Predicting failures' : 'Operator console',
      t ? 'A failure-risk model scores each check before Spot runs it, so operators can expect trouble. Scores are measured on missions the model never saw.' : 'Where the issues raised by Spot stand with the operators.');

    if (t) {
      const cm = t.confusion_matrix, failed = cm.true_positive + cm.false_negative, warned = cm.true_positive + cm.false_positive;
      this.para(`In the ${metrics.split?.test_missions?.length ?? ''} test missions, ${plural(failed, 'check')} actually failed. The model warned about ${cm.true_positive} of them ahead of time, and ${cm.false_positive} of its ${plural(warned, 'warning')} were false alarms.`,
        PAGE.m, this.y + 4, CW, { size: 10, color: C.black, lh: 1.45 });
      this.y += 40;
      this.tiles([
        { label: 'Precision', value: n1(t.precision), sub: 'warnings that were right', tone: C.gold },
        { label: 'Recall', value: n1(t.recall), sub: 'failures it caught' },
        { label: 'F1 score', value: n1(t.f1), sub: 'balance of both' },
        { label: 'PR-AUC', value: n1(t.pr_auc), sub: `ROC-AUC ${n1(t.roc_auc)}` },
      ], 4, 70);

      // Confusion matrix (left) and model vs simple rules (right).
      this.heading('Test set results', `${clean(metrics.model_type).replace(/_/g, ' ')}, decision threshold ${n1(metrics.decision_threshold)}. Split: ${clean(metrics.split?.method)}.`, 200);
      const y0 = this.y, cell = 74, mx = PAGE.m + 70;
      this.text('Predicted', mx + cell, y0 + 6, { size: 6.3, color: C.ash, upper: true, cs: 1, align: 'center' });
      this.text('No failure', mx + cell / 2, y0 + 20, { size: 6.5, color: C.graphite, upper: true, cs: 0.6, align: 'center' });
      this.text('Failure', mx + cell * 1.5, y0 + 20, { size: 6.5, color: C.graphite, upper: true, cs: 0.6, align: 'center' });
      this.text('Actual', PAGE.m, y0 + 28 + cell, { size: 6.3, color: C.ash, upper: true, cs: 1 });
      this.text('No failure', mx - 8, y0 + 28 + cell / 2 + 2, { size: 6.5, color: C.graphite, upper: true, cs: 0.6, align: 'right' });
      this.text('Failure', mx - 8, y0 + 28 + cell * 1.5 + 2, { size: 6.5, color: C.graphite, upper: true, cs: 0.6, align: 'right' });
      [[cm.true_negative, 'Correct', 0, 0, true], [cm.false_positive, 'False alarm', 1, 0, false],
        [cm.false_negative, 'Missed', 0, 1, false], [cm.true_positive, 'Caught', 1, 1, true]].forEach(([v, label, cxI, cyI, right]) => {
        const x = mx + cxI * cell, y = y0 + 28 + cyI * cell;
        this.rect(x + 1, y + 1, cell - 2, cell - 2, right ? C.charcoal : C.near);
        this.text(`${v}`, x + cell / 2, y + cell / 2 + 6, { size: 24, color: right ? C.white : C.black, align: 'center' });
        this.text(label, x + cell / 2, y + cell - 10, { size: 6, color: right ? C.steel : C.ash, upper: true, cs: 0.8, align: 'center' });
      });

      const bx = PAGE.m + 260, bw = CW - 260 - 34, rule = metrics.baselines?.battery_rule;
      this.text('Model vs a simple rule', bx, y0 + 6, { size: 6.3, color: C.ash, upper: true, cs: 1 });
      if (rule) this.para(`Rule: ${rule.rule}`, bx, y0 + 18, bw + 34, { size: 7, color: C.slate });
      let yy = y0 + 36;
      for (const [label, key] of [['F1 score', 'f1'], ['PR-AUC', 'pr_auc'], ['Recall', 'recall'], ['Precision', 'precision']]) {
        this.text(label, bx, yy + 6, { size: 7.5 });
        [[t[key], C.gold, 'Model'], [rule?.[key], C.steel, 'Rule']].forEach(([v, color], j) => {
          const by = yy + 11 + j * 10;
          this.rect(bx, by, bw, 7, C.near);
          if (isNum(v)) { this.rect(bx, by, Math.max(v * bw, 1), 7, color); this.text(n1(v), bx + bw + 6, by + 6, { size: 6.5, color: C.graphite }); }
        });
        yy += 36;
      }
      this.legend([['Model', C.gold], ['Battery rule', C.steel]], bx, yy + 4);
      this.y = Math.max(y0 + 28 + cell * 2, yy + 4) + 26;

      const cv = metrics.cross_validation;
      if (cv?.candidates) {
        this.heading('Cross-validation', clean(cv.method), 70);
        this.table(['Candidate', 'PR-AUC (mean +/- sd)', 'F1 (mean +/- sd)', 'Threshold', 'Chosen'],
          Object.entries(cv.candidates).map(([name, c]) => [humanize(name), `${n1(c.pr_auc_mean)} +/- ${n1(c.pr_auc_std)}`, `${n1(c.f1_mean)} +/- ${n1(c.f1_std)}`, n1(c.threshold), name === cv.selected ? 'Yes' : '']),
          { colorCol: 4, colorFn: v => (v === 'Yes' ? C.goldText : null) });
      }
    }

    if (ops) {
      this.heading('Operator console', 'Issues raised from findings and failed checks, and how operators handled them.', 90);
      const hrs = ops.mttr_hours, sec = ops.median_alarm_response_sec;
      this.tiles([
        { label: 'Issues raised', value: `${ops.issues ?? '-'}` },
        { label: 'Still open', value: `${ops.open_issues ?? '-'}`, tone: ops.open_issues ? C.warn : C.ok },
        { label: 'Resolved', value: `${ops.resolved ?? '-'}`, tone: C.ok },
        { label: 'False alarms', value: `${ops.false_alarms ?? '-'}` },
        { label: 'Marked as danger', value: `${ops.danger_issues ?? '-'}`, tone: ops.danger_issues ? C.bad : C.line },
        { label: 'Alarms waiting', value: `${ops.pending_alarms ?? '-'}`, tone: ops.pending_alarms ? C.bad : C.line },
        { label: 'Time to resolve', value: isNum(hrs) ? `${+hrs.toFixed(1)} h` : '-', sub: isNum(hrs) ? 'average' : 'nothing resolved yet' },
        { label: 'Alarm response', value: isNum(sec) ? `${Math.round(sec)} s` : '-', sub: isNum(sec) ? 'median' : 'no alarms answered yet' },
      ]);
    }
  }

  /** Any other headline KPIs, as a compact appendix table, so nothing in a snapshot is dropped. */
  appendix() {
    const { kpis = {} } = this.in;
    const keys = ['mission_completion_pct', 'action_success_pct', 'anomalies_per_mission', 'serious_anomalies', 'avg_battery_drain_pct',
      'avg_end_battery_pct', 'avg_duration_min', 'reading_good_pct', 'hidden_failure_missions', 'avg_predicted_failure_risk'];
    const fmt = (k, v) => (!isNum(v) ? '-' : k.endsWith('_pct') ? pct(v) : n1(v));
    const scopes = ['all', 'V1', 'V2'].filter(s => kpis[s]);
    if (!kpis.all) return;
    this.chapter('Appendix', 'Detail tables', 'The exact values behind the charts, for anyone who needs to check a number.');
    this.waypointTable();
    this.missionLog();
    this.heading('All key figures', null, 120);
    this.table(['Measure', ...scopes.map(s => (s === 'all' ? 'All missions' : s === 'V1' ? 'V1 baseline' : 'V2 improved'))],
      keys.map(k => [kpiLabel(k), ...scopes.map(s => fmt(k, kpis[s][k]))]),
      { columnStyles: Object.fromEntries(scopes.map((_, i) => [i + 1, { halign: 'right' }])) });
  }

  render() {
    this.cover();
    this.atAGlance();
    this.performance();
    this.where();
    this.history();
    this.modelAndOps();
    this.appendix();
    this.chrome();
  }
}

/**
 * Builds the report. kpis: { all, V1, V2 } from compute_kpis (GET /summary or a snapshot). Everything else is
 * optional and its section is skipped when missing: compare, metrics, waypoints, missions, insights,
 * attention (records), ops, kind ('report' | 'snapshot'), asOf, note.
 */
export async function buildReport(input) {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
  doc.setProperties({ title: clean(input.title), subject: 'Spot inspection report', author: 'spotat.work', creator: 'spotat.work' });
  new Report(doc, autoTable, input).render();
  return doc;
}

export async function downloadReport(input) {
  const now = input.now || new Date();
  const doc = await buildReport({ ...input, now });
  doc.save(reportFilename(now));
}
