import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { AppContext, loadSession, saveSession, useLastRefresh } from './api.js';
import Overview from './tabs/Overview.jsx';
import Replay from './tabs/Replay.jsx';
import DataScientist from './tabs/DataScientist.jsx';
import OpsConsole from './modules/ops/OpsConsole.jsx';
import AskPanel from './components/AskPanel.jsx';
import AlarmCenter from './components/AlarmCenter.jsx';
import { BackToTop, Toasts } from './components/ui.jsx';
import { createSiren } from './lib/siren.js';
import { scrollToEl } from './lib/dom.js';
import { LiveProvider } from './live/LiveContext.jsx';
import { LiveBadge } from './live/LiveViews.jsx';

const TABS = [['overview', 'Overview'], ['replay', 'Replay'], ['analysis', 'Data Analysis'], ['operator', 'Operator']];
const PLAIN_TABS = ['overview', 'replay'];

function stored(key, fallback, allowed) {
  try {
    const v = localStorage.getItem(key);
    return allowed.includes(v) ? v : fallback;
  } catch { return fallback; }
}
function store(key, value) {
  try { localStorage.setItem(key, value); } catch { /* storage blocked: preference lasts this visit */ }
}
const clock = d => d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

/** Wait (up to ~3 s) for an element that renders once its data loads, then scroll to it. */
function scrollWhenReady(id, onFound) {
  let tries = 0;
  const step = () => {
    const el = document.getElementById(id);
    if (el) { scrollToEl(el); onFound?.(el); return; }
    if (++tries < 180) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export default function App() {
  const [tab, setTab] = useState(() => {
    const ids = TABS.map(t => t[0]);
    const route = window.location.pathname.replace(/^\/+|\/+$/g, '') || window.location.hash.slice(1);
    return ids.includes(route) ? route : 'overview';
  });
  const [theme, setTheme] = useState(() => stored('spot.theme', 'dark', ['dark', 'light']));
  const [version, setVersion] = useState(0);
  const [session, setSessionState] = useState(loadSession);
  const [context, setContext] = useState({ floor: 1 });
  const [replayMission, setReplayMission] = useState(null);
  const [siren, setSiren] = useState(null);
  const [muted, setMuted] = useState(false);
  const [alarm, setAlarm] = useState(false);
  const [toasts, setToasts] = useState([]);
  const refreshed = useLastRefresh();
  const topbar = useRef(null);

  // Each view opens at the top the first time, then comes back where it was left.
  const positions = useRef({});
  const pendingScroll = useRef(null);
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const switchTab = useCallback((id, scrollTo) => {
    if (id === tabRef.current) { if (scrollTo) scrollWhenReady(scrollTo); return; }
    positions.current[tabRef.current] = window.scrollY;
    pendingScroll.current = scrollTo || null;
    setTab(id);
  }, []);
  useLayoutEffect(() => {
    const target = pendingScroll.current;
    pendingScroll.current = null;
    window.scrollTo({ top: positions.current[tab] ?? 0, behavior: 'instant' });
    if (target) scrollWhenReady(target);
  }, [tab]);

  /** Jump to a view, optionally selecting a run / waypoint / part and scrolling to a section id. */
  const go = useCallback((id, { mission, waypoint, floor, part, scrollTo } = {}) => {
    if (mission) setReplayMission(mission);
    if (waypoint || part || floor) setContext(c => ({ ...c, ...(floor ? { floor } : {}), ...(waypoint ? { waypoint } : {}), ...(part ? { part } : {}) }));
    switchTab(id, scrollTo);
  }, [switchTab]);
  const openReplay = useCallback(id => go('replay', { mission: id }), [go]);

  const notify = useCallback(text => {
    const id = Date.now() + Math.random();
    setToasts(t => [...t.slice(-2), { id, text }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3200);
  }, []);

  useEffect(() => {
    const { pathname, search } = window.location;
    if (pathname !== `/${tab}` || window.location.hash) window.history.replaceState(null, '', `/${tab}${search}`);
  }, [tab]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#000000' : '#f8f8f8');
    store('spot.theme', theme);
  }, [theme]);
  // The header wraps onto two rows on small screens; section jumps and sticky bars use its real height.
  useEffect(() => {
    const el = topbar.current;
    if (!el) return undefined;
    const set = () => document.documentElement.style.setProperty('--topbar-h', `${el.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const bump = useCallback(() => setVersion(v => v + 1), []);
  const setSession = useCallback(s => { saveSession(s); setSessionState(s); }, []);
  const app = useMemo(() => ({ version, bump, session, setSession, notify, go }), [version, bump, session, setSession, notify, go]);

  // Crossfade the theme swap where the browser supports view transitions; otherwise switch instantly.
  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark';
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!document.startViewTransition || reduce) { setTheme(next); return; }
    document.startViewTransition(() => {
      document.documentElement.dataset.theme = next;
      flushSync(() => setTheme(next));
    });
  }

  function arm() {
    if (siren) { setMuted(m => !m); return; }
    const s = createSiren();
    if (s) { s.test(); setSiren(s); }
  }

  return (
    <AppContext.Provider value={app}>
      <LiveProvider>
      <a className="skip" href="#main">Skip to content</a>
      <div className="app" inert={alarm}>
        <header className="topbar" ref={topbar}>
          <a className="brand" href="/overview" aria-label="spotat.work home" onClick={e => { e.preventDefault(); switchTab('overview'); }}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 2h10l5 10-5 10H7L2 12z" /></svg>
            <span>spotat<b>.</b>work</span>
          </a>
          <nav className="tabs" aria-label="Views">
            {TABS.map(([id, label]) => (
              <button key={id} type="button" className={tab === id ? 'is-on' : ''} aria-current={tab === id ? 'page' : undefined} onClick={() => switchTab(id)}>
                {label}
              </button>
            ))}
          </nav>
          <div className="topbar-tools">
            <span className="status">
              <LiveBadge />
              {refreshed && <span className="refreshed" title="Last time data loaded from the backend">Data updated {clock(refreshed)}</span>}
            </span>
            <button type="button" className={`btn btn-sm ${siren ? 'btn-ghost' : 'btn-accent'}`} onClick={arm} aria-pressed={siren ? muted : undefined}>
              {!siren ? 'Arm alarms 📢' : muted ? 'Unmute' : 'Mute'}
            </button>
            <button
              type="button"
              className="icon-btn theme-toggle"
              onClick={toggleTheme}
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            >
              {theme === 'dark'
                ? <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.5" /><path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3M4.6 4.6l2.1 2.1M17.3 17.3l2.1 2.1M4.6 19.4l2.1-2.1M17.3 6.7l2.1-2.1" /></svg>
                : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" /></svg>}
            </button>
          </div>
        </header>

        <main id="main" className={`main main-${tab}`} tabIndex={-1}>
          {tab === 'overview' && <Overview theme={theme} context={context} setContext={setContext} onReplay={openReplay} />}
          {tab === 'replay' && <Replay missionId={replayMission} onMission={setReplayMission} />}
          {tab === 'analysis' && <DataScientist />}
          {tab === 'operator' && <OpsConsole />}
        </main>

        <footer className="footer">
          <span>spotat.work · Knight Hacks 2026</span>
          <span className="muted">Synthetic challenge data · stylized 3D model, not official Boston Dynamics CAD</span>
        </footer>

        <AskPanel
          mode={PLAIN_TABS.includes(tab) ? 'simple' : 'technical'}
          context={tab === 'overview' ? context : tab === 'replay' ? { mission: replayMission } : {}}
        />
        {/* Right after the assistant so CSS can hide it while the assistant panel is open. */}
        <BackToTop />
      </div>
      <Toasts items={toasts} />
      <AlarmCenter siren={siren} muted={muted} onMute={() => setMuted(m => !m)} onActive={setAlarm} />
      </LiveProvider>
    </AppContext.Provider>
  );
}
