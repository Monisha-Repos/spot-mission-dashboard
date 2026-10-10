import React, { lazy, Suspense, useRef, useState } from "react";
import { Icon, Button } from "./ui.jsx";
const SpotViewer = lazy(() => import("../SpotViewer.jsx"));
const Loading = () => (
  <div className="viewer-loading">
    <Icon name="robot" size={30} />
    <span>Getting SPOT ready…</span>
  </div>
);
export function RobotCompanion({ onExplore }) {
  const [rotate, setRotate] = useState(false);
  return (
    <section className="robot-companion">
      <div className="companion-copy">
        <span className="eyebrow">YOUR FIELD PARTNER</span>
        <h3>
          A familiar face
          <br />
          in the field.
        </h3>
        <p>Interactive model · cosmetic preview</p>
        <button className="text-button" onClick={onExplore}>
          Explore SPOT <Icon name="arrow" size={14} />
        </button>
      </div>
      <div className="companion-stage">
        <Suspense fallback={<Loading />}>
          <SpotViewer quality="eco" showGrid={false} autoRotate={rotate} />
        </Suspense>
        <button
          className={`rotate-button ${rotate ? "selected" : ""}`}
          aria-label={rotate ? "Stop model rotation" : "Rotate model"}
          aria-pressed={rotate}
          onClick={() => setRotate(!rotate)}
        >
          <Icon name="reset" size={14} />
        </button>
      </div>
    </section>
  );
}
export function RobotExplorer({ notify }) {
  const viewer = useRef();
  const [stance, setStance] = useState("stand"),
    [playing, setPlaying] = useState(true),
    [view, setView] = useState("perspective"),
    [reset, setReset] = useState(0),
    [rotate, setRotate] = useState(false),
    [grid, setGrid] = useState(true),
    [wireframe, setWireframe] = useState(false),
    [quality, setQuality] = useState("eco"),
    [height, setHeight] = useState(0),
    [speed, setSpeed] = useState(1),
    [stats, setStats] = useState(null),
    [exporting, setExporting] = useState(false);
  async function exportModel() {
    setExporting(true);
    try {
      await viewer.current.exportGLB();
      notify("Model exported as GLB.");
    } catch (e) {
      notify(e.message);
    } finally {
      setExporting(false);
    }
  }
  return (
    <div className="robot-explorer">
      <section className="panel robot-full-stage">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">SPOT EXPLORER</span>
            <h2>Designed to go a little further.</h2>
          </div>
          <span className="quiet-tag">COSMETIC MODEL / NO ROBOT CONTROL</span>
        </div>
        <div className="full-viewer">
          <Suspense fallback={<Loading />}>
            <SpotViewer
              ref={viewer}
              stance={stance}
              playing={playing}
              speed={speed}
              bodyHeight={height}
              view={view}
              resetKey={reset}
              autoRotate={rotate}
              showGrid={grid}
              wireframe={wireframe}
              quality={quality}
              onStats={setStats}
            />
          </Suspense>
          <span className="viewer-hint">Drag to orbit · Scroll to zoom</span>
        </div>
        <div className="camera-controls">
          <div className="segmented" aria-label="Camera view">
            {[
              ["perspective", "3D"],
              ["front", "Front"],
              ["side", "Side"],
              ["top", "Top"],
            ].map(([id, label]) => (
              <button
                key={id}
                aria-pressed={view === id}
                className={view === id ? "selected" : ""}
                onClick={() => {
                  setView(id);
                  setRotate(false);
                  setReset((n) => n + 1);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <Button
            icon="reset"
            onClick={() => {
              setView("perspective");
              setRotate(false);
              setReset((n) => n + 1);
            }}
          >
            Reset
          </Button>
        </div>
      </section>
      <section className="panel robot-controls">
        <span className="eyebrow">MAKE A MOVE</span>
        <h2>Get to know SPOT.</h2>
        <p className="muted">
          The existing articulated model, with its original geometry and camera
          controls.
        </p>
        <label className="field-label">Pose</label>
        <div className="pose-controls">
          {["stand", "walk", "sit"].map((p) => (
            <button
              key={p}
              className={stance === p ? "selected" : ""}
              aria-pressed={stance === p}
              onClick={() => {
                setStance(p);
                setPlaying(true);
              }}
            >
              <Icon name="robot" />
              {p}
            </button>
          ))}
        </div>
        {stance === "walk" && (
          <div className="inline-controls">
            <Button
              icon={playing ? "pause" : "play"}
              onClick={() => setPlaying(!playing)}
            >
              {playing ? "Pause" : "Resume"}
            </Button>
            <label>
              Speed{" "}
              <select
                aria-label="Walking speed"
                value={speed}
                onChange={(e) => setSpeed(+e.target.value)}
              >
                <option value="0.5">0.5×</option>
                <option value="1">1×</option>
                <option value="1.5">1.5×</option>
              </select>
            </label>
          </div>
        )}
        <label className="field-label" htmlFor="body-height">
          Body height <span>{Math.round(height * 100)} cm</span>
        </label>
        <input
          id="body-height"
          type="range"
          min="-0.09"
          max="0.02"
          step="0.01"
          value={height}
          onChange={(e) => setHeight(+e.target.value)}
        />
        {[
          ["Auto-rotate", rotate, setRotate],
          ["Ground grid", grid, setGrid],
          ["Wireframe", wireframe, setWireframe],
        ].map(([label, value, setter]) => (
          <label className="toggle-row" key={label}>
            <span>{label}</span>
            <input
              type="checkbox"
              checked={value}
              onChange={(e) => setter(e.target.checked)}
            />
          </label>
        ))}
        <label className="field-label" htmlFor="quality">
          Rendering quality
        </label>
        <select
          id="quality"
          value={quality}
          onChange={(e) => setQuality(e.target.value)}
        >
          <option value="eco">Eco · 24 fps cap</option>
          <option value="balanced">Balanced · 30 fps cap</option>
        </select>
        <div className="model-metrics">
          <Icon name="cube" />
          <span>
            {stats ? stats.triangles.toLocaleString("en-US") : "—"} triangles
            <small>Lightweight. Rests when offscreen.</small>
          </span>
        </div>
        <Button
          icon="download"
          disabled={!stats || exporting}
          onClick={exportModel}
        >
          {exporting ? "Exporting…" : "Export model .GLB"}
        </Button>
        <p className="fine-print">
          Original stylized geometry, not official CAD or a live digital twin.
          The GLB contains the selected pose; walking is procedural.
        </p>
      </section>
    </div>
  );
}
