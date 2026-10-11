import React, { useEffect, useMemo, useRef, useState } from 'react';
import { sortRows } from '../lib/format.js';
import { Hint } from './ui.jsx';

const PAGE = 25;

/**
 * columns: [{ key, label, get?(row), show?(value, row) → text, render?(row), num?, hint? }]
 *   get = the raw value (sorting), show = readable text (display + search), render = custom cell.
 * filters: [{ key, label, get(row), show?(value) }] → a select per filter with that column's distinct values.
 * The first column is the row's identifier and stays pinned while scrolling sideways.
 */
export default function DataTable({ rows, columns, filters = [], caption, rowKey }) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState({ key: columns[0].key, dir: 'asc' });
  const [picked, setPicked] = useState({});
  const [page, setPage] = useState(0);
  const [scrolled, setScrolled] = useState(false);
  const getter = c => c.get || (r => r[c.key]);
  const text = (c, r) => {
    const v = getter(c)(r);
    if (c.show) return c.show(v, r) || '—';
    return v === null || v === undefined || v === '' ? '—' : String(v);
  };

  const options = useMemo(() => Object.fromEntries(filters.map(f => [
    f.key, [...new Set(rows.map(f.get).filter(v => v !== null && v !== undefined && v !== ''))].sort(),
  ])), [rows, filters]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = rows.filter(r => filters.every(f => !picked[f.key] || String(f.get(r)) === picked[f.key]));
    // Match both the raw value (e.g. ACOUSTIC_INSPECTION) and the readable text (Acoustic inspection).
    if (q) out = out.filter(r => columns.some(c => `${getter(c)(r) ?? ''} ${c.show ? text(c, r) : ''}`.toLowerCase().includes(q)));
    const col = columns.find(c => c.key === sort.key);
    return col ? sortRows(out, getter(col), sort.dir) : out;
  }, [rows, query, picked, sort, columns, filters]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeFilters = (query.trim() ? 1 : 0) + Object.values(picked).filter(Boolean).length;
  const clear = () => { setQuery(''); setPicked({}); setPage(0); };
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
          <select
            key={f.key}
            className={picked[f.key] ? 'is-active' : undefined}
            value={picked[f.key] || ''}
            onChange={e => { setPicked(p => ({ ...p, [f.key]: e.target.value })); setPage(0); }}
            aria-label={f.label}
          >
            <option value="">{f.label}: all</option>
            {options[f.key].map(v => <option key={v} value={v}>{f.show ? f.show(v) : v}</option>)}
          </select>
        ))}
        {activeFilters > 0 && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={clear}>Clear filters ({activeFilters})</button>
        )}
        <span className="muted table-count">
          {visible.length} of {rows.length}{activeFilters > 0 && <span className="filtered-tag"> · filtered</span>}
        </span>
      </div>
      <div
        ref={box}
        className={`table-scroll table-scroll-y${scrolled ? ' is-scrolled' : ''}`}
        onScroll={e => { const s = e.currentTarget.scrollTop > 0; if (s !== scrolled) setScrolled(s); }}
      >
        <table className="data-table">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {columns.map(c => {
                const on = sort.key === c.key;
                return (
                  <th key={c.key} scope="col" className={`${c.num ? 'num' : ''}${on ? ' is-sorted' : ''}`} aria-sort={on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                    <button type="button" onClick={() => toggle(c.key)}>
                      {c.label}
                      <span className="sort-ind" aria-hidden="true">{on ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}</span>
                    </button>
                    {c.hint && <Hint text={c.hint} label={`What is ${c.label}?`} />}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={rowKey ? rowKey(r) : i}>
                {columns.map((c, ci) => {
                  const Cell = ci === 0 ? 'th' : 'td';
                  return <Cell key={c.key} scope={ci === 0 ? 'row' : undefined} className={c.num ? 'num' : ''}>{c.render ? c.render(r) : text(c, r)}</Cell>;
                })}
              </tr>
            ))}
            {!shown.length && (
              <tr>
                <td colSpan={columns.length} className="table-empty">
                  {activeFilters
                    ? <>No matches for these filters. <button type="button" className="btn btn-ghost btn-sm" onClick={clear}>Clear filters</button></>
                    : 'Nothing recorded yet.'}
                </td>
              </tr>
            )}
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
