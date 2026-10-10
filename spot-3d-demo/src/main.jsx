import React, { lazy, Suspense, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const SpotViewer = lazy(() => import('./SpotViewer'));
function Icon({ name, size = 18, ...rest }) {
  const paths = {
    cube: <><path d="m12 3 9 5v9l-9 5-9-5V8Z"/><path d="m3 8 9 5 9-5M12 13v9M7.5 5.5l9 5"/></>,
    reset: <><path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/></>,
    arrow: <path d="M7 17 17 7M7 7h10v10"/>,
    download: <><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/></>,
    play: <path d="m8 4 12 8-12 8Z"/>,
    pause: <><path d="M8 5v14M16 5v14"/></>,
    move: <><path d="M12 3v18M3 12h18M8 7l4-4 4 4M8 17l4 4 4-4M7 8l-4 4 4 4m10-8 4 4-4 4"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    bolt: <path d="m14 2-9 12h6l-1 8 9-12h-6Z"/>,
    stand: <><path d="M4 8h15v6H4ZM5 14v6m12-6v6M19 9h3"/></>,
    walk: <><path d="M4 8h15v6H4ZM6 14l-3 6m6-6 3 6m4-6-2 6m4-6 3 6M19 9h3"/></>,
    sit: <><path d="m4 13 13-6 3 5-13 6ZM7 17l-3 3h6m7-7 2 7h3"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>{paths[name] || paths.cube}</svg>;
}
function Toggle({ label, hint, checked, onChange }) {
  return <label className="toggle-row"><span>{label}{hint && <small>{hint}</small>}</span><input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}/><span className="switch" aria-hidden="true"/></label>;
}
function App() {
  const [stance, setStance] = useState('stand');
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [height, setHeight] = useState(0);
  const [autoRotate, setAutoRotate] = useState(false);
  const [wireframe, setWireframe] = useState(false);
  const [grid, setGrid] = useState(true);
  const [quality, setQuality] = useState('balanced');
  const [view, setView] = useState('perspective');
  const [resetKey, setResetKey] = useState(0);
  const [stats, setStats] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState('');
  const [showInfo, setShowInfo] = useState(false);
  const viewer = useRef();
  const animated = (stance === 'walk' && playing) || autoRotate;
  async function download() {
    setExporting(true); setMessage('');
    try { await viewer.current.exportGLB(); setMessage('GLB downloaded. Includes the current pose.'); }
    catch (err) { setMessage(err.message || 'Export failed. Please try again.'); }
    finally { setExporting(false); }
  }
  function choosePose(next) { setStance(next); setPlaying(true); }
  return <>
    <header className="header"><a className="brand" href="#" aria-label="Spot Model Lab home"><span className="brand-mark"><Icon name="stand" size={24}/></span><span>SPOT<span className="brand-slash">/</span><span className="brand-light">MODEL LAB</span></span></a><div className="header-right"><span className="prototype"><i/>INTERACTIVE PROTOTYPE</span><a href="https://bostondynamics.com/products/spot/" target="_blank" rel="noreferrer">Meet the real Spot <Icon name="arrow" size={15}/></a></div></header>
    <main>
      <section className="intro"><div><div className="eyebrow"><span/> A LITTLE ROBOT. A LOT OF POSSIBILITY.</div><h1>Your field partner,<br className="mobile-break"/> in three dimensions<span>.</span></h1><p>Get to know Spot. Turn it around, put it in motion, make it yours.</p></div><div className="edition"><span>MODEL SERIES</span><strong>01 <span>/ SPOT</span></strong></div></section>
      <div className="workspace">
        <section className="stage" aria-label="3D model preview">
          <div className="stage-top"><div className="stage-label"><span className="live-dot"/> SPOT EXPLORER <span className="tag">3D</span></div><span className="local-label">LOCAL DEMO <span>↗</span></span></div>
          <Suspense fallback={<div className="loading"><Icon name="cube" size={30}/><span>Assembling Spot…</span></div>}><SpotViewer ref={viewer} stance={stance} playing={playing} speed={speed} bodyHeight={height} autoRotate={autoRotate} wireframe={wireframe} showGrid={grid} quality={quality} view={view} resetKey={resetKey} onStats={setStats}/></Suspense>
          <div className="stage-caption"><span className="caption-line"/><div><strong>Spot</strong><span>QUADRUPED · PROCEDURAL MODEL</span></div></div>
          <div className="axis" aria-hidden="true"><span className="axis-y">Y</span><span className="axis-x">X</span><span className="axis-z">Z</span><i/></div>
          <div className="viewport-bottom"><span className="gesture"><Icon name="move" size={14}/> Drag to orbit <b>·</b> Scroll to zoom</span><button className="reset-button" onClick={() => { setView('perspective'); setAutoRotate(false); setResetKey(k => k + 1); }}><Icon name="reset" size={15}/> Reset view</button></div>
          <div className="camera-bar"><div className="view-tabs" aria-label="Camera views">{[['perspective','3D view'],['front','Front'],['side','Side'],['top','Top']].map(([id,label]) => <button key={id} aria-pressed={view === id} className={view === id ? 'selected' : ''} onClick={() => { setView(id); setAutoRotate(false); setResetKey(k => k + 1); }}>{id === 'perspective' && <Icon name="cube" size={14}/>} {label}</button>)}</div><span className="render-state"><i className={animated ? 'active' : ''}/>{animated ? 'In motion' : 'On-demand rendering'}</span></div>
        </section>
        <aside className="controls"><div className="controls-heading"><div className="eyebrow">MAKE A MOVE</div><h2>Model controls</h2><p>A small preview of a capable companion.</p></div>
          <div className="control-section"><div className="section-label"><span>01</span> POSE & MOTION</div><div className="pose-options">{[['stand','Stand','Ready for the next mission'],['walk','Walk','A little forward momentum'],['sit','Sit','Taking a well-earned break']].map(([id,name,desc]) => <button key={id} className={`pose ${stance === id ? 'chosen' : ''}`} aria-pressed={stance === id} onClick={() => choosePose(id)}><span className="pose-icon"><Icon name={id} size={24}/></span><span><strong>{name}</strong><small>{desc}</small></span><span className="radio-dot">{stance === id && <span/>}</span></button>)}</div>
          {stance === 'walk' && <div className="playback"><button onClick={() => setPlaying(v => !v)} aria-label={playing ? 'Pause walking' : 'Resume walking'}><Icon name={playing ? 'pause' : 'play'} size={16}/>{playing ? 'Pause' : 'Resume'}</button><label>Speed <select value={speed} onChange={e => setSpeed(Number(e.target.value))}><option value={0.5}>0.5×</option><option value={1}>1×</option><option value={1.5}>1.5×</option></select></label></div>}
          <label className="slider-label" htmlFor="height">Body height <span>{height > 0 ? '+' : ''}{Math.round(height * 100)} cm</span></label><input id="height" className="height-slider" type="range" min="-0.09" max="0.02" step="0.01" value={height} onChange={e => setHeight(Number(e.target.value))}/><div className="range-labels"><span>Lower</span><span>Higher</span></div></div>
          <div className="control-section display-section"><div className="section-label"><span>02</span> DISPLAY</div><Toggle label="Auto-rotate" checked={autoRotate} onChange={setAutoRotate}/><Toggle label="Ground grid" checked={grid} onChange={setGrid}/><Toggle label="Wireframe" checked={wireframe} onChange={setWireframe}/></div>
          <div className="performance"><div className="performance-top"><span><Icon name="bolt" size={15}/> LIGHT ON ITS FEET</span><select aria-label="Rendering quality" value={quality} onChange={e => setQuality(e.target.value)}><option value="balanced">Balanced</option><option value="eco">Eco</option></select></div><p>{quality === 'eco' ? '24 fps limit · 1× pixel ratio' : '30 fps limit · up to 1.5× pixel ratio'}<br/>Rests when you do. No heavy textures.</p></div>
        </aside>
      </div>
      <section className="details-strip" aria-label="Model details"><div className="detail"><span>BUILT FOR THE BROWSER</span><strong>Small model. Big potential.</strong></div><div className="detail metric"><span>MODEL TRIANGLES</span><strong>{stats ? stats.triangles.toLocaleString() : '—'}<small> polygons kept in check</small></strong></div><div className="detail metric"><span>MODEL ASSET DOWNLOADS</span><strong>0<small> generated in code</small></strong></div><button className="export-button" disabled={!stats || exporting} onClick={download}><Icon name="download" size={17}/>{exporting ? 'Exporting…' : 'Export model'}<span>.GLB</span></button></section>
      <div className="under-strip"><span className="export-message" role="status">{message}</span><button className="text-button" onClick={() => setShowInfo(v => !v)} aria-expanded={showInfo}>{showInfo ? 'Hide integration notes' : 'Made to fit your dashboard'} <Icon name="arrow" size={13}/></button></div>
      {showInfo && <section className="integration"><h2>Take Spot with you.</h2><p>Copy <code>SpotViewer.jsx</code> and <code>spotModel.js</code> into your React app, install <code>three</code>, and give the viewer a sized container. Pass <code>stance</code>, <code>playing</code>, and <code>bodyHeight</code> as props. See the demo README for the full integration example.</p><p>The GLB export contains the current pose and named joints. Walking is procedural in the React viewer; the export does not include animation clips. This is an original stylized model, not an official Boston Dynamics CAD model.</p></section>}
      <footer><span>SPOT / MODEL LAB <span className="footer-divider">—</span> HACKATHON EDITION</span><span>Made for exploration. Ready for integration.</span></footer>
    </main>
  </>;
}
createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);

