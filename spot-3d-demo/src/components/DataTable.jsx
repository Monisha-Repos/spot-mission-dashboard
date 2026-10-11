import React, { useEffect, useMemo, useRef, useState } from 'react';
import { sortRows } from '../lib/format.js';

const PAGE = 25;

/**
 * columns: [{ key, label, get?(row), render?(row), num? }]
 * filters: [{ key, label, get(row) }] → a select per filter with that column's distinct values.
 */
export default function DataTable({ rows, columns, filters = [], caption, rowKey }) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState({ key: columns[0].key, dir: 'asc' });
  const [picked, setPicked] = useState({});
  const [page, setPage] = useState(0);
  const [scrolled, setScrolled] = useState(false);
  const getter = c => c.get || (r => r[c.key]);

  const options = useMemo(() => Object.fromEntries(filters.map(f => [
    f.key, [...new Set(rows.map(f.get).filter(v => v !== null && v !== undefined && v !== ''))].sort(),
  ])), [rows, filters]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = rows.filter(r => filters.every(f => !picked[f.key] || String(f.get(r)) === picked[f.key]));
    if (q) out = out.filter(r => columns.some(c => String(getter(c)(r) ?? '').toLowerCase().includes(q)));
    const col = columns.find(c => c.key === sort.key);
    return col ? sortRows(out, getter(col), sort.dir) : out;
  }, [rows, query, picked, sort, columns, filters]);

  const pages = Math.max(1, Math.ceil(visible.length / PAGE));
  const current = Math.min(page, pages - 1);
  const shown = visible.slice(current * PAGE, current * PAGE + PAGE);
  const toggle = key => { setSort(s => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' })); setPage(0); };
  // A new page, sort or filter starts at the top of the scroll box.
  const box = useRef(null);
  useEffect(() => { if (box.current) box.current.scrollTop = 0; }, [current, sort, query, picked]);

  return (
    <div className="table-wrap">
      <div className="table-tools">
        <input type="search" placeholder="Filter rows…" value={query} onChange={e => { setQuery(e.target.value); setPage(0); }} aria-label={`Filter ${caption}`} />
        {filters.map(f => (
          <select key={f.key} value={picked[f.key] || ''} onChange={e => { setPicked(p => ({ ...p, [f.key]: e.target.value })); setPage(0); }} aria-label={f.label}>
            <option value="">{f.label}: all</option>
            {options[f.key].map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        ))}
        <span className="muted table-count">{visible.length} of {rows.length}</span>
      </div>
      <div
        ref={box}
        className={`table-scroll table-scroll-y${scrolled ? ' is-scrolled' : ''}`}
        onScroll={e => { const s = e.currentTarget.scrollTop > 0; if (s !== scrolled) setScrolled(s); }}
      >
        <table>
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {columns.map(c => (
                <th key={c.key} scope="col" className={c.num ? 'num' : ''} aria-sort={sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                  <button type="button" onClick={() => toggle(c.key)}>
                    {c.label}<span aria-hidden="true">{sort.key === c.key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}</span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={rowKey ? rowKey(r) : i}>
                {columns.map(c => <td key={c.key} className={c.num ? 'num' : ''}>{c.render ? c.render(r) : String(getter(c)(r) ?? '—')}</td>)}
              </tr>
            ))}
            {!shown.length && <tr><td colSpan={columns.length} className="muted">No rows match.</td></tr>}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="pager">
          <button type="button" className="btn btn-ghost btn-sm" disabled={current === 0} onClick={() => setPage(current - 1)}>Previous</button>
          <span className="muted">Page {current + 1} of {pages}</span>
          <button type="button" className="btn btn-ghost btn-sm" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>Next</button>
        </div>
      )}
    </div>
  );
}
