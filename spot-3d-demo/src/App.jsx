import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AppContext, loadSession, saveSession } from './api.js';
import Overview from './tabs/Overview.jsx';
import Replay from './tabs/Replay.jsx';
import DataScientist from './tabs/DataScientist.jsx';
import OpsConsole from './modules/ops/OpsConsole.jsx';
import AskPanel from './components/AskPanel.jsx';
import AlarmCenter from './components/AlarmCenter.jsx';
import { createSiren } from './lib/siren.js';

const TABS = [['overview', 'Overview'], ['operator', 'Issue queue'], ['replay', 'Mission replay'], ['scientist', 'Analytics']];
const PLAIN_TABS = ['overview', 'replay', 'operator'];

function stored(key, fallback, allowed) {
  try {
    const v = localStorage.getItem(key);
    return allowed.includes(v) ? v : fallback;
  } catch { return fallback; }
}
function store(key, value) {
  try { localStorage.setItem(key, value); } catch { /* storage blocked: preference lasts this visit */ }
}

export default function App() {
  const [tab, setTab] = useState(() => {
    const ids = TABS.map(t => t[0]);
    const hash = window.location.hash.slice(1);
    return ids.includes(hash) ? hash : stored('spot.tab', 'overview', ids);
  });
  const [theme, setTheme] = useState(() => stored('spot.theme', 'dark', ['dark', 'light']));
  const [version, setVersion] = useState(0);
  const [session, setSessionState] = useState(loadSession);
  const [context, setContext] = useState({ floor: 1 });
  const [replayMission, setReplayMission] = useState(null);
  const openReplay = useCallback(id => { if (id) setReplayMission(id); setTab('replay'); }, []);
  const [siren, setSiren] = useState(null);
  const [muted, setMuted] = useState(false);
  const [alarm, setAlarm] = useState(false);
  const [stream, setStream] = useState('connecting');

  useEffect(() => {
    store('spot.tab', tab);
    if (window.location.hash.slice(1) !== tab) window.history.replaceState(null, '', `#${tab}`);
  }, [tab]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#000000' : '#f8f8f8');
    store('spot.theme', theme);
  }, [theme]);

  const bump = useCallback(() => setVersion(v => v + 1), []);
  const setSession = useCallback(s => { saveSession(s); setSessionState(s); }, []);
  const app = useMemo(() => ({ version, bump, session, setSession }), [version, bump, session, setSession]);

  function arm() {
    if (siren) { setMuted(m => !m); return; }
    const s = createSiren();
    if (s) { s.test(); setSiren(s); }
  }

  return (
    <AppContext.Provider value={app}>
      <a className="skip" href="#main">Skip to content</a>
      <div className="app" inert={alarm}>
        <header className="topbar">
          <a className="brand" href="#overview" aria-label="spotat.work home" onClick={e => { e.preventDefault(); setTab('overview'); }}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 2h10l5 10-5 10H7L2 12z" /></svg>
            <span>spotat<b>.</b>work</span>
          </a>
          <span className="workspace-label">Operations</span>
          <nav className="tabs" aria-label="Views">
            {TABS.map(([id, label]) => (
              <button key={id} type="button" className={tab === id ? 'is-on' : ''} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>
                {label}
              </button>
            ))}
          </nav>
          <div className="topbar-tools">
            <span className={`live live-${stream}`} title={`Live ingest stream: ${stream}`}>
              <i aria-hidden="true" />{stream === 'live' ? 'Live updates' : stream === 'offline' ? 'Updates offline' : 'Connecting'}
            </span>
            <button type="button" className="btn btn-sm btn-ghost alarm-toggle" onClick={arm} aria-pressed={Boolean(siren) && !muted} title="Enable or mute the audible alarm. Visual alerts remain active.">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5Z" /><path d={siren && !muted ? 'M15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14' : 'm16 9 6 6m0-6-6 6'} /></svg>
              <span className="sound-label">{!siren ? 'Enable sound' : muted ? 'Sound muted' : 'Sound on'}</span>
            </button>
            <button
              type="button"
              className="icon-btn theme-toggle"
              onClick={() => setTheme(t => (t === 'dark' ? 'light' : 'dark'))}
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            >
              {theme === 'dark'
                ? <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.5" /><path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3M4.6 4.6l2.1 2.1M17.3 17.3l2.1 2.1M4.6 19.4l2.1-2.1M17.3 6.7l2.1-2.1" /></svg>
                : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" /></svg>}
            </button>
            <AskPanel
              mode={PLAIN_TABS.includes(tab) ? 'simple' : 'technical'}
              context={tab === 'overview' ? context : tab === 'replay' ? { mission: replayMission } : {}}
            />
          </div>
        </header>

        <main id="main" className={`main main-${tab}`}>
          {tab === 'overview' && <Overview theme={theme} context={context} setContext={setContext} onReplay={openReplay} onOperator={() => setTab('operator')} />}
          {tab === 'replay' && <Replay missionId={replayMission} onMission={setReplayMission} />}
          {tab === 'scientist' && <DataScientist />}
          {tab === 'operator' && <OpsConsole />}
        </main>

        <footer className="footer">
          <span>spotat.work <span className="muted">/ Mission operations</span></span>
          <span className="muted">Knight Hacks 2026 · Synthetic challenge data · Stylized Spot model</span>
        </footer>

      </div>
      <AlarmCenter siren={siren} muted={muted} onMute={() => setMuted(m => !m)} onActive={setAlarm} onStream={setStream} />
    </AppContext.Provider>
  );
}
