import React, { useEffect, useMemo, useState } from 'react';
import { api, asset, useApi, useApp } from '../../api.js';
import { Async, Badge, FadeImg, Field, Section, Segmented, Stat } from '../../components/ui.jsx';
import LineChart from '../../components/LineChart.jsx';
import LoginForm from './LoginForm.jsx';
import { downloadReport } from '../../lib/report.js';
import { formatTime, kpiLabel, nextStatuses, num, reading, severityTone, titleCase } from '../../lib/format.js';

const STATUS_TONE = { OPEN: 'bad', ACKNOWLEDGED: 'warn', IN_PROGRESS: 'warn', RESOLVED: 'ok', FALSE_ALARM: 'muted' };

/** Run a signed-in write; a rejected token signs the user out so the form shows again. */
function useWrite() {
  const { session, setSession, bump } = useApp();
  return async (path, method, body) => {
    try {
      const out = await api(path, { method, body, token: session?.token });
      bump();
      return out;
    } catch (e) {
      if (e.status === 401) setSession(null);
      throw e;
    }
  };
}

function IssueDetail({ id }) {
  const { session } = useApp();
  const write = useWrite();
  const state = useApi(`/ops/issues/${id}`);
  const [status, setStatus] = useState('');
  const [assignee, setAssignee] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setStatus(''); setNote(''); setError(''); setAssignee(state.data?.assignee || ''); }, [id, state.data?.assignee]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const body = { note };
    if (status) body.status = status;
    if (assignee !== (state.data.assignee || '')) body.assignee = assignee;
    try {
      await write(`/ops/issues/${id}`, 'PATCH', body);
      setNote('');
      setStatus('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Async state={state}>
      {i => {
        const options = nextStatuses(i.status, session?.role);
        return (
          <article className="issue-detail" aria-label={`Issue ${i.issue_id}`}>
            <p className="eyebrow">{i.issue_id} · {titleCase(i.source_type)} {i.source_id}</p>
            <h3>{i.title}</h3>
            <p className="badges">
              <Badge tone={STATUS_TONE[i.status]}>{titleCase(i.status)}</Badge>
              <Badge tone={severityTone(i.severity)}>{i.severity}</Badge>
              {i.danger && <Badge tone="bad">Danger</Badge>}
              {i.pending_decision && <Badge tone="bad">Alarm waiting</Badge>}
              <span className="muted">{i.mission_id} · {i.location_id} {i.location_name} · Floor {i.floor} · {i.asset_name} ({i.asset_criticality})</span>
            </p>
            <p>{i.explanation}</p>
            {i.recommended_action && <p className="next-step">Next step: {i.recommended_action}</p>}
            <div className="stat-row">
              <Stat label="Reading" value={reading(i.reading)} sub={i.reading?.usual_range ? `usual ${num(i.reading.usual_range.low)}–${num(i.reading.usual_range.high)}` : i.reading?.quality} />
              <Stat label="Predicted risk" value={num(i.predicted_failure_risk, 2)} />
              <Stat label="Assignee" value={i.assignee || '—'} />
            </div>
            {i.evidence_image && <figure className="evidence evidence-sm"><FadeImg src={asset(i.evidence_image)} alt="Reference inspection image" loading="lazy" /><figcaption>Reference image</figcaption></figure>}

            {session ? (
              <form className="issue-form" onSubmit={submit}>
                <div className="form-row">
                  <Field label="Change status">
                    <select value={status} onChange={e => setStatus(e.target.value)}>
                      <option value="">Keep {titleCase(i.status)}</option>
                      {options.map(s => <option key={s} value={s}>{s === 'OPEN' && (i.status === 'RESOLVED' || i.status === 'FALSE_ALARM') ? 'Reopen' : titleCase(s)}</option>)}
                    </select>
                  </Field>
                  <Field label="Assignee"><input value={assignee} onChange={e => setAssignee(e.target.value)} maxLength={60} placeholder="Optional" /></Field>
                </div>
                <Field label={status === 'FALSE_ALARM' ? 'Why is this a false alarm?' : 'Note'} hint="Required. Saved to the audit trail with your name.">
                  <textarea value={note} onChange={e => setNote(e.target.value)} required maxLength={1000} rows={2} />
                </Field>
                {!options.length && <p className="muted">Only a supervisor can reopen a closed issue. You can still add a note.</p>}
                <button type="submit" className="btn btn-accent" disabled={busy || !note.trim()}>{busy ? 'Saving…' : status ? `Mark ${titleCase(status)}` : 'Add note'}</button>
                {error && <p className="note note-error" role="alert">{error}</p>}
              </form>
            ) : <p className="muted">Sign in above to change this issue.</p>}

            <h4>Audit trail</h4>
            <ol className="timeline">
              {[...i.events].reverse().map(ev => (
                <li key={ev.event_id}>
                  <span className="timeline-when">{formatTime(ev.at)}</span>
                  <span><strong>{ev.from_status ? `${titleCase(ev.from_status)} → ${titleCase(ev.to_status)}` : titleCase(ev.kind)}</strong> · {ev.actor} ({ev.actor_role})</span>
                  {ev.note && <span className="muted">{ev.note}</span>}
                </li>
              ))}
            </ol>
          </article>
        );
      }}
    </Async>
  );
}

function Issues() {
  const [filters, setFilters] = useState({ status: '', severity: '', location: '', open_only: 'true' });
  const [selected, setSelected] = useState(null);
  const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString();
  const issues = useApi(`/ops/issues?${qs}`);
  const set = (k, v) => setFilters(f => ({ ...f, [k]: v }));
  const locations = useMemo(() => [...new Set((issues.data || []).map(i => i.location_id))].sort(), [issues.data]);

  return (
    <div className="queue-layout">
      <div>
        <div className="table-tools">
          <select value={filters.status} onChange={e => set('status', e.target.value)} aria-label="Status">
            <option value="">Status: any</option>
            {Object.keys(STATUS_TONE).map(s => <option key={s} value={s}>{titleCase(s)}</option>)}
          </select>
          <select value={filters.severity} onChange={e => set('severity', e.target.value)} aria-label="Severity">
            <option value="">Severity: any</option>
            {['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map(s => <option key={s}>{s}</option>)}
          </select>
          <select value={filters.location} onChange={e => set('location', e.target.value)} aria-label="Waypoint">
            <option value="">Waypoint: any</option>
            {(filters.location && !locations.includes(filters.location) ? [filters.location, ...locations] : locations).map(l => <option key={l}>{l}</option>)}
          </select>
          <label className="check"><input type="checkbox" checked={filters.open_only === 'true'} onChange={e => set('open_only', e.target.checked ? 'true' : '')} /> Open only</label>
          <span className="muted table-count">{issues.data?.length ?? 0} issues</span>
        </div>
        <Async state={issues} empty="No issues match these filters.">
          {list => (
            <ul className="queue">
              {list.map(i => (
                <li key={i.issue_id}>
                  <button type="button" className={`queue-item${selected === i.issue_id ? ' is-selected' : ''}${i.danger ? ' is-danger' : ''}`} onClick={() => setSelected(i.issue_id)} aria-pressed={selected === i.issue_id}>
                    <span className="queue-badges">
                      <Badge tone={severityTone(i.severity)}>{i.severity}</Badge>
                      <Badge tone={STATUS_TONE[i.status]}>{titleCase(i.status)}</Badge>
                      {i.danger && <Badge tone="bad">Danger</Badge>}
                      {i.pending_decision && <Badge tone="bad">Alarm</Badge>}
                    </span>
                    <strong>{i.title}</strong>
                    <span className="muted">{i.issue_id} · {i.mission_id} · {i.location_id} · {i.asset_id} ({i.asset_criticality}){i.assignee ? ` · ${i.assignee}` : ''}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Async>
      </div>
      <div className="queue-detail">{selected ? <IssueDetail id={selected} /> : <p className="muted">Pick an issue to see its details and history.</p>}</div>
    </div>
  );
}

const CHART_KPIS = [
  ['action_success_pct', '%'], ['mission_completion_pct', '%'], ['anomalies_per_mission', ''],
  ['avg_battery_drain_pct', '%'], ['avg_predicted_failure_risk', ''],
];

function Snapshots() {
  const { session } = useApp();
  const write = useWrite();
  const list = useApi('/ops/snapshots');
  const [kpi, setKpi] = useState('action_success_pct');
  const [label, setLabel] = useState('');
  const [note, setNote] = useState('');
  const [saveError, setSaveError] = useState('');
  const [cmp, setCmp] = useState({ a: '', b: '', scope_a: 'all', scope_b: 'all' });
  const snaps = list.data || [];
  useEffect(() => {
    if (snaps.length >= 2 && !cmp.a) setCmp(c => ({ ...c, a: String(snaps[0].snapshot_id), b: String(snaps[snaps.length - 1].snapshot_id) }));
  }, [snaps.length]);
  const compare = useApi(cmp.a && cmp.b ? `/ops/snapshots/compare?${new URLSearchParams(cmp)}` : null);

  async function save(e) {
    e.preventDefault();
    setSaveError('');
    try {
      await write('/ops/snapshots', 'POST', { label, note: note || null });
      setLabel('');
      setNote('');
    } catch (err) {
      setSaveError(err.message);
    }
  }
  async function exportPdf(id) {
    const s = await api(`/ops/snapshots/${id}`);
    await downloadReport({
      kind: 'snapshot', title: `Snapshot: ${s.label}`,
      subtitle: `Saved by ${s.created_by} on ${formatTime(s.created_at)}. Covers ${s.missions} missions, data up to ${formatTime(s.as_of || s.created_at)}.`,
      note: s.note, asOf: s.as_of || s.created_at, kpis: s.kpis, ops: s.kpis.all?.ops,
    });
  }

  const unit = CHART_KPIS.find(([k]) => k === kpi)[1];
  return (
    <>
      <Async state={list} empty="No snapshots yet.">
        {() => (
          <>
            <div className="chart-head">
              <h3>{kpiLabel(kpi)} over time</h3>
              <select value={kpi} onChange={e => setKpi(e.target.value)} aria-label="KPI to chart">
                {CHART_KPIS.map(([k]) => <option key={k} value={k}>{kpiLabel(k)}</option>)}
              </select>
            </div>
            <LineChart
              title={`${kpiLabel(kpi)} across snapshots`}
              labels={snaps.map(s => `#${s.snapshot_id}`)}
              format={v => `${v}${unit}`}
              series={[
                { name: 'All', tone: 'accent', values: snaps.map(s => s.headline?.all?.[kpi] ?? null) },
                { name: 'V1 baseline', tone: 'muted', values: snaps.map(s => s.headline?.V1?.[kpi] ?? null) },
                { name: 'V2 improved', tone: 'ok', values: snaps.map(s => s.headline?.V2?.[kpi] ?? null) },
              ]}
            />
          </>
        )}
      </Async>

      {session ? (
        <form className="snapshot-form" onSubmit={save}>
          <div className="form-row">
            <Field label="Snapshot label"><input value={label} onChange={e => setLabel(e.target.value)} required maxLength={120} placeholder="e.g. After WP05 fix" /></Field>
            <Field label="Note"><input value={note} onChange={e => setNote(e.target.value)} maxLength={1000} placeholder="Optional" /></Field>
            <button type="submit" className="btn btn-accent">Save snapshot</button>
          </div>
          {saveError && <p className="note note-error" role="alert">{saveError}</p>}
        </form>
      ) : <p className="muted">Sign in to save a snapshot.</p>}

      <h3>Compare two snapshots</h3>
      <div className="form-row compare-pick">
        {['a', 'b'].map(side => (
          <React.Fragment key={side}>
            <Field label={side === 'a' ? 'Before' : 'After'}>
              <select value={cmp[side]} onChange={e => setCmp(c => ({ ...c, [side]: e.target.value }))}>
                <option value="">Pick a snapshot</option>
                {snaps.map(s => <option key={s.snapshot_id} value={s.snapshot_id}>#{s.snapshot_id} {s.label}</option>)}
              </select>
            </Field>
            <Field label="Scope">
              <select value={cmp[`scope_${side}`]} onChange={e => setCmp(c => ({ ...c, [`scope_${side}`]: e.target.value }))}>
                <option value="all">All</option><option value="V1">V1</option><option value="V2">V2</option>
              </select>
            </Field>
          </React.Fragment>
        ))}
      </div>
      {compare.data || compare.error ? (
        <Async state={compare}>
          {c => (
            <>
              <p className="lead"><span className="tone-ok">▲ {c.improved} improved</span> · <span className="tone-bad">▼ {c.degraded} degraded</span></p>
              <div className="table-scroll">
                <table>
                  <thead><tr><th scope="col">KPI</th><th scope="col" className="num">#{c.a.snapshot_id} {c.a.scope}</th><th scope="col" className="num">#{c.b.snapshot_id} {c.b.scope}</th><th scope="col" className="num">Change</th></tr></thead>
                  <tbody>
                    {c.changes.filter(ch => ch.verdict !== 'unchanged').map(ch => (
                      <tr key={ch.kpi}>
                        <th scope="row">{kpiLabel(ch.kpi)}</th>
                        <td className="num">{num(ch.a)}</td>
                        <td className="num">{num(ch.b)}</td>
                        <td className={`num delta ${ch.verdict === 'improved' ? 'tone-ok' : ch.verdict === 'degraded' ? 'tone-bad' : ''}`}>
                          {ch.verdict === 'improved' ? '▲ ' : ch.verdict === 'degraded' ? '▼ ' : ''}{ch.delta > 0 ? '+' : ''}{num(ch.delta)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Async>
      ) : null}

      <h3>Timeline</h3>
      <ol className="timeline">
        {[...snaps].reverse().map(s => (
          <li key={s.snapshot_id}>
            <span className="timeline-when">#{s.snapshot_id} · {formatTime(s.as_of || s.created_at)}</span>
            <span><strong>{s.label}</strong> · {s.created_by}{s.auto_seeded ? ' (auto)' : ''} · {s.missions} missions · success {num(s.headline?.all?.action_success_pct)}%</span>
            {s.note && <span className="muted">{s.note}</span>}
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => exportPdf(s.snapshot_id)}>PDF</button>
          </li>
        ))}
      </ol>
    </>
  );
}

function Activity() {
  const state = useApi('/ops/activity?limit=50');
  return (
    <Async state={state}>
      {a => (
        <>
          <p className="lead">{a.summary}</p>
          <ol className="timeline">
            {a.events.map(ev => (
              <li key={ev.event_id}>
                <span className="timeline-when">{formatTime(ev.at)}</span>
                <span><strong>{ev.issue_id}</strong> {ev.from_status ? `${titleCase(ev.from_status)} → ${titleCase(ev.to_status)}` : titleCase(ev.kind)} · {ev.actor} · {ev.asset_id} @ {ev.location_id}</span>
                <span className="muted">{ev.title}{ev.note ? ` — ${ev.note}` : ''}</span>
              </li>
            ))}
          </ol>
        </>
      )}
    </Async>
  );
}

export default function OpsConsole() {
  const { session, setSession } = useApp();
  const [view, setView] = useState('issues');
  const health = useApi('/health');
  const kpis = useApi('/ops/kpis');
  if (health.data && !health.data.ops_enabled) {
    return <Section title="Operator console is off"><p className="muted">Set <code>OPS_ENABLED=true</code> in <code>backend/.env</code> and restart the backend.</p></Section>;
  }
  const o = kpis.data?.ops;
  return (
    <>
      <header className="page-head">
        <div>
          <p className="eyebrow">Operator console</p>
          <h1>Act on findings</h1>
        </div>
        {session && (
          <div className="page-actions">
            <span className="muted">Signed in as <strong>{session.name}</strong> ({session.role})</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSession(null)}>Sign out</button>
          </div>
        )}
      </header>
      {!session && <Section eyebrow="Sign in" title="Operator sign-in"><LoginForm /></Section>}
      {o && (
        <div className="stat-grid">
          <Stat label="Open issues" value={o.open_issues} sub={`${o.issues} total`} tone={o.open_issues ? 'warn' : 'ok'} />
          <Stat label="Danger" value={o.danger_issues} tone={o.danger_issues ? 'bad' : undefined} />
          <Stat label="Alarms waiting" value={o.pending_alarms} tone={o.pending_alarms ? 'bad' : undefined} />
          <Stat label="Resolved · false alarms" value={`${o.resolved} · ${o.false_alarms}`} />
          <Stat label="Mean time to resolve" value={o.mttr_hours === null ? '—' : `${num(o.mttr_hours)} h`} />
          <Stat label="Median alarm response" value={o.median_alarm_response_sec === null ? '—' : `${num(o.median_alarm_response_sec, 0)} s`} />
        </div>
      )}
      <Section actions={<Segmented label="Console view" options={[['issues', 'Issue queue'], ['snapshots', 'Snapshots & history'], ['activity', 'Activity']]} value={view} onChange={setView} />}>
        {view === 'issues' && <Issues />}
        {view === 'snapshots' && <Snapshots />}
        {view === 'activity' && <Activity />}
      </Section>
    </>
  );
}
