import { createContext, useCallback, useContext, useEffect, useState } from 'react';

// Python backend (FastAPI) and Java ingest API. Override in .env.local for a deployed build.
export const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:8000').replace(/\/$/, '');
export const INGEST_URL = (import.meta.env.VITE_INGEST_URL || 'http://localhost:8081').replace(/\/$/, '');

const TOKEN_KEY = 'spot.ops.session';

export function loadSession() {
  try { return JSON.parse(localStorage.getItem(TOKEN_KEY)) || null; } catch { return null; }
}
export function saveSession(session) {
  try {
    if (session) localStorage.setItem(TOKEN_KEY, JSON.stringify(session));
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* private mode: the session lasts until reload */ }
}

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export async function api(path, { method = 'GET', body, token } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(API_URL + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, `Can't reach the backend at ${API_URL}. Is it running?`);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = data?.detail;
    const message = typeof detail === 'string' ? detail : Array.isArray(detail) ? detail.map(d => d.msg).join('; ') : res.statusText;
    throw new ApiError(res.status, message);
  }
  return data;
}

export const asset = path => (path ? API_URL + path : '');

/**
 * Shared app state: a data version that bumps on every live mission, the operator session,
 * notify(message) for brief success toasts, and go(tab, extra) to switch views.
 */
export const AppContext = createContext({ version: 0, bump() {}, session: null, setSession() {}, notify() {}, go() {} });
export const useApp = () => useContext(AppContext);

// When data last loaded successfully, so the top bar can say how fresh the dashboard is.
let lastRefresh = null;
const refreshListeners = new Set();
function markRefreshed() {
  lastRefresh = new Date();
  refreshListeners.forEach(fn => fn(lastRefresh));
}
export function useLastRefresh() {
  const [at, setAt] = useState(lastRefresh);
  useEffect(() => {
    refreshListeners.add(setAt);
    return () => { refreshListeners.delete(setAt); };
  }, []);
  return at;
}

/** GET a path and re-fetch whenever the data version changes (live missions, writes). */
export function useApi(path) {
  const { version } = useApp();
  const [state, setState] = useState({ data: null, error: null, loading: Boolean(path) });
  const [local, setLocal] = useState(0);
  useEffect(() => {
    if (!path) { setState({ data: null, error: null, loading: false }); return; }
    let alive = true;
    setState(s => ({ ...s, loading: true }));
    api(path).then(
      data => { markRefreshed(); if (alive) setState({ data, error: null, loading: false }); },
      error => alive && setState(s => ({ data: s.data, error, loading: false })),
    );
    return () => { alive = false; };
  }, [path, version, local]);
  const reload = useCallback(() => setLocal(n => n + 1), []);
  return { ...state, reload };
}
