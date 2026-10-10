import React, { useEffect, useMemo, useRef, useState } from "react";
import { missionSnapshot, buildQueue, buildHandover } from "./lib/engine.js";
import { shortType } from "./lib/display.js";
import { Badge, Button, Empty, Icon } from "./components/ui.jsx";
import EvidenceDrawer, { Modal } from "./components/EvidenceDrawer.jsx";
import MissionOverview, {
  MissionStrip,
} from "./components/MissionOverview.jsx";
import AttentionQueue from "./components/AttentionQueue.jsx";
import Insights from "./components/Insights.jsx";
import LiveMonitor from "./components/LiveMonitor.jsx";
import { RobotExplorer } from "./components/RobotPanel.jsx";

const views = [
  ["overview", "Mission control", "dashboard"],
  ["replay", "Mission replay", "replay"],
  ["live", "Live monitor", "live"],
  ["insights", "Fleet insights", "chart"],
  ["handover", "Shift handover", "notes"],
  ["robot", "Robot explorer", "robot"],
];
const pageCopy = {
  overview: [
    "Know what needs you.",
    "From robot observations to your next best action.",
  ],
  replay: [
    "See the mission unfold.",
    "Every event in order. Every finding in context.",
  ],
  live: [
    "The next observation, in focus.",
    "Incoming evidence becomes clear outcomes and next steps.",
  ],
  insights: [
    "Find the pattern. Improve the next run.",
    "An honest look at reliability, with the sample sizes to explain it.",
  ],
  handover: [
    "A clear picture for the next shift.",
    "The findings, the evidence, and the context only you can add.",
  ],
  robot: [
    "Your field partner, in three dimensions.",
    "An interactive introduction to SPOT. Your mission data stays in mission control.",
  ],
};
const initialView = () =>
  views.some((v) => v[0] === location.hash.slice(1))
    ? location.hash.slice(1)
    : "overview";
const readLocal = (key) => {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "{}");
    return value && typeof value === "object" && !Array.isArray(value)
      ? value
      : {};
  } catch {
    return {};
  }
};
function download(name, text, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function App() {
  const [data, setData] = useState(null),
    [loadError, setLoadError] = useState(""),
    [view, setView] = useState(initialView),
    [missionId, setMissionId] = useState("M020"),
    [selectedLocation, setSelectedLocation] = useState(null),
    [filter, setFilter] = useState("all"),
    [query, setQuery] = useState(""),
    [focusOnly, setFocusOnly] = useState(false),
    [eventIndex, setEventIndex] = useState(0),
    [playing, setPlaying] = useState(false),
    [speed, setSpeed] = useState(1),
    [drawer, setDrawer] = useState(null),
    [reviews, setReviews] = useState(() => readLocal("spotlight-reviews-v1")),
    [shift, setShift] = useState(() => readLocal("spotlight-handover-v1")),
    [about, setAbout] = useState(false),
    [command, setCommand] = useState(false),
    [commandQuery, setCommandQuery] = useState(""),
    [toast, setToast] = useState("");
  const toastTimer = useRef(),
    liveExport = useRef(),
    main = useRef();
  function notify(message) {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 4000);
  }
  useEffect(() => {
    const abort = new AbortController();
    fetch(`${import.meta.env.BASE_URL}data/mission-data.json`, {
      signal: abort.signal,
    })
      .then((r) => {
        if (!r.ok) throw Error("Mission data could not be loaded.");
        return r.json();
      })
      .then(setData)
      .catch((e) => {
        if (e.name !== "AbortError") setLoadError(e.message);
      });
    return () => abort.abort();
  }, []);
  useEffect(() => {
    const listener = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (drawer || about) return;
        setCommand((v) => !v);
        setPlaying(false);
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [drawer, about]);
  useEffect(() => {
    const listener = () => {
      if (location.hash === "#main") {
        main.current?.focus();
        return;
      }
      setView(initialView());
      setPlaying(false);
      setSelectedLocation(null);
    };
    window.addEventListener("hashchange", listener);
    return () => window.removeEventListener("hashchange", listener);
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);
  const replayEvents = useMemo(
    () => data?.replay.filter((e) => e.mission_id === missionId) || [],
    [data, missionId],
  );
  const scope = useMemo(
    () =>
      view === "replay"
        ? {
            missionId,
            replay: true,
            eventIndex,
            asOf: replayEvents[eventIndex]?.timestamp || null,
          }
        : view === "insights"
          ? {}
          : { missionId },
    [view, missionId, eventIndex, replayEvents],
  );
  const snapshot = useMemo(
    () => (data ? missionSnapshot(data, missionId, scope.asOf, scope) : null),
    [data, missionId, scope],
  );
  const queue = useMemo(
    () => (data ? buildQueue(data, scope) : []),
    [data, scope],
  );
  useEffect(() => {
    if (!playing) return;
    if (eventIndex >= replayEvents.length - 1) {
      setPlaying(false);
      return;
    }
    const timer = setTimeout(() => setEventIndex((i) => i + 1), 1200 / speed);
    return () => clearTimeout(timer);
  }, [playing, speed, replayEvents.length, eventIndex]);
  function navigate(next) {
    setPlaying(false);
    setView(next);
    setSelectedLocation(null);
    setQuery("");
    setFilter("all");
    setFocusOnly(false);
    history.replaceState(null, "", `#${next}`);
    setCommand(false);
    setCommandQuery("");
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  function selectMission(id) {
    setMissionId(id);
    setEventIndex(0);
    setPlaying(false);
    setSelectedLocation(null);
    setQuery("");
  }
  function openEvidence(a) {
    setPlaying(false);
    setDrawer(a);
  }
  function saveReview(id, review) {
    const next = { ...reviews, [id]: review };
    setReviews(next);
    try {
      localStorage.setItem("spotlight-reviews-v1", JSON.stringify(next));
      notify("Review saved. The original finding stays unchanged.");
    } catch {
      notify("Browser storage unavailable. Review saved for this session.");
    }
    setDrawer(null);
  }
  function saveShift() {
    try {
      localStorage.setItem("spotlight-handover-v1", JSON.stringify(shift));
      notify("Shift notes saved in this browser.");
    } catch {
      notify("Notes saved in this session. Export them before closing.");
    }
  }
  function exportReport() {
    if (view === "live") {
      liveExport.current?.();
      notify("Live evidence exported.");
      return;
    }
    const text =
      buildHandover(
        data,
        scope,
        Object.fromEntries(
          Object.entries(reviews).map(([id, r]) => [
            id,
            { ...r, status: r.ack ? "Acknowledged" : "New" },
          ]),
        ),
      ) +
      `\n\nSHIFT NOTES\nPrepared by: ${shift.operator || "Not specified"}\n${shift.note || "No shift notes added."}\n\nExported: ${new Date().toISOString()} (UTC export time)\n`;
    download(
      `Spotlight-${view === "insights" ? "fleet" : missionId}-handover.md`,
      text,
      "text/markdown",
    );
    notify("Handover exported with evidence and operator notes.");
  }
  const searchNeedle = commandQuery.trim().toLowerCase();
  const commandActions =
    data && searchNeedle
      ? data.actions
          .filter((a) =>
            `${a.action_id} ${a.asset_id} ${a.location_id} ${a.action_type}`
              .toLowerCase()
              .includes(searchNeedle),
          )
          .slice(0, 8)
      : [];

  return (
    <>
      <a
        className="skip-link"
        href="#main"
        onClick={(e) => {
          e.preventDefault();
          main.current?.focus();
        }}
      >
        Skip to dashboard
      </a>
      <aside className="sidebar">
        <a
          className="brand"
          href="#overview"
          onClick={(e) => {
            e.preventDefault();
            navigate("overview");
          }}
        >
          <span className="brand-symbol">
            <i />
            <i />
            <i />
          </span>
          <span>
            spotlight<span className="brand-period">.</span>
            <small>MISSION INTELLIGENCE</small>
          </span>
        </a>
        <div className="workspace-badge">
          <span>
            <Icon name="robot" size={19} />
          </span>
          <div>
            SPOT Operations<small>Knight Hacks · Demo facility</small>
          </div>
          <i />
        </div>
        <span className="nav-label">YOUR WORKSPACE</span>
        <nav aria-label="Main navigation">
          {views.map(([id, label, icon]) => (
            <button
              key={id}
              className={`nav-item ${view === id ? "active" : ""} ${id === "robot" ? "nav-robot" : ""}`}
              onClick={() => navigate(id)}
              aria-current={view === id ? "page" : undefined}
              title={label}
            >
              <Icon name={icon} />
              <span>{label}</span>
              {view === id && <i />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <Icon name="spark" size={28} />
            <strong>Every flag has a story.</strong>
            <p>
              Understand the observation.
              <br />
              Make the next call with clarity.
            </p>
          </div>
          <button
            className="nav-item"
            onClick={() => {
              setAbout(true);
              setPlaying(false);
            }}
            title="About the data"
          >
            <Icon name="info" />
            <span>About the data</span>
          </button>
          <div className="operator">
            <span>OP</span>
            <div>
              Operator workspace<small>Decisions stay in your hands</small>
            </div>
          </div>
        </div>
      </aside>
      <div className="app-shell">
        <header className="topbar">
          <div className="breadcrumb">
            Operations <span>/</span>
            <strong>{views.find((v) => v[0] === view)?.[1]}</strong>
          </div>
          <div className="topbar-actions">
            <button
              className="command-trigger"
              onClick={() => {
                setCommand(true);
                setPlaying(false);
              }}
            >
              <Icon name="search" size={15} />
              <span>Jump to anything</span>
              <kbd>Ctrl K</kbd>
            </button>
            <span className="demo-label">
              <i />
              SYNTHETIC DATA
            </span>
          </div>
        </header>
        <main ref={main} id="main" tabIndex={-1}>
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                <span className="eyebrow-line" />
                YOUR OPERATIONS, IN FOCUS
              </div>
              <h1>{pageCopy[view][0]}</h1>
              <p>{pageCopy[view][1]}</p>
            </div>
            {data && view !== "robot" && (
              <div className="heading-actions">
                {view === "overview" && (
                  <Button icon="replay" onClick={() => navigate("replay")}>
                    Replay mission
                  </Button>
                )}
                <Button
                  className="primary"
                  icon="download"
                  onClick={exportReport}
                >
                  {view === "live" ? "Export live evidence" : "Export handover"}
                </Button>
              </div>
            )}
          </div>
          {!data ? (
            <Empty title={loadError || "Loading inspection evidence…"}>
              {loadError
                ? "Refresh the page to try again."
                : "Joining the source records, one observation at a time."}
            </Empty>
          ) : (
            <>
              {["overview", "replay", "handover"].includes(view) && (
                <MissionStrip
                  data={data}
                  missionId={missionId}
                  snapshot={snapshot}
                  replay={view === "replay"}
                  selectMission={selectMission}
                />
              )}
              {["overview", "replay"].includes(view) && (
                <MissionOverview
                  {...{
                    data,
                    missionId,
                    snapshot,
                    queue,
                    reviews,
                    view,
                    selectedLocation,
                    setSelectedLocation,
                    filter,
                    setFilter,
                    query,
                    setQuery,
                    focusOnly,
                    setFocusOnly,
                    openEvidence,
                    navigate,
                    replayEvents,
                    eventIndex,
                    setEventIndex,
                    playing,
                    setPlaying,
                    speed,
                    setSpeed,
                  }}
                />
              )}
              {view === "insights" && <Insights data={data} />}
              {view === "live" && (
                <LiveMonitor
                  notify={notify}
                  onOpen={openEvidence}
                  onExportRef={liveExport}
                  download={download}
                />
              )}
              {view === "robot" && <RobotExplorer notify={notify} />}
              {view === "handover" && (
                <>
                  <div className="handover-brief">
                    <Icon name="notes" />
                    <p>
                      <strong>
                        {queue.filter((a) => !reviews[a.id]?.ack).length}{" "}
                        unreviewed actions
                      </strong>{" "}
                      remain in this mission. A review records that someone has
                      seen the finding; it does not clear the asset.
                    </p>
                  </div>
                  <div className="handover-grid">
                    <AttentionQueue
                      queue={queue}
                      reviews={reviews}
                      onOpen={openEvidence}
                      filter={filter}
                      setFilter={setFilter}
                    />
                    <section className="panel shift-card">
                      <span className="eyebrow">
                        CONTEXT MAKES THE DIFFERENCE
                      </span>
                      <h2>Your shift notes</h2>
                      <p className="muted">
                        Local to this browser. Included in the export.
                      </p>
                      <label className="field-label" htmlFor="shift-operator">
                        Prepared by
                      </label>
                      <input
                        id="shift-operator"
                        placeholder="Your name or shift"
                        value={shift.operator || ""}
                        onChange={(e) =>
                          setShift({ ...shift, operator: e.target.value })
                        }
                      />
                      <label className="field-label" htmlFor="shift-note">
                        What the next operator should know
                      </label>
                      <textarea
                        id="shift-note"
                        placeholder="Add verification steps, context or follow-up ownership…"
                        value={shift.note || ""}
                        onChange={(e) =>
                          setShift({ ...shift, note: e.target.value })
                        }
                      />
                      <div className="inline-controls">
                        <Button icon="check" onClick={saveShift}>
                          Save notes
                        </Button>
                        <Button
                          className="primary"
                          icon="download"
                          onClick={exportReport}
                        >
                          Export .md
                        </Button>
                      </div>
                      <p className="fine-print">
                        The handover includes source IDs, recorded times,
                        locations, priorities and review notes. Export before
                        moving to another browser.
                      </p>
                    </section>
                  </div>
                </>
              )}
            </>
          )}
          <footer>
            <span>Built for the people who keep things running.</span>
            <strong>SPOTLIGHT / KNIGHT HACKS 2026</strong>
          </footer>
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <Icon name="check" size={17} />
          {toast}
        </div>
      )}
      {drawer && (
        <EvidenceDrawer
          key={drawer.action_id}
          action={drawer}
          live={!!drawer.live}
          review={reviews[drawer.action_id]}
          onSave={saveReview}
          onClose={() => setDrawer(null)}
          onDownload={download}
        />
      )}
      {about && (
        <Modal
          title="A clear view. An honest one."
          onClose={() => setAbout(false)}
        >
          <p className="modal-intro">
            All facility data is fictional challenge material. Spotlight links
            the supplied records and makes uncertainty visible.
          </p>
          <div className="about-grid">
            <section>
              <Icon name="check" />
              <h3>Every flag has a source</h3>
              <p>
                Original IDs, severity, reading quality and timestamps are
                preserved. A mission can complete while inspections fail.
              </p>
            </section>
            <section>
              <Icon name="replay" />
              <h3>Replay respects time</h3>
              <p>
                Events reveal outcomes only as they arrive. Linked CSV
                observations are labeled reconstructed. M023 is partial;
                M024–M027 have no replay.
              </p>
            </section>
            <section>
              <Icon name="pin" />
              <h3>Conflicts stay visible</h3>
              <p>
                Maps use action waypoints. Differences from the asset registry
                are disclosed in the evidence drawer.
              </p>
            </section>
            <section>
              <Icon name="robot" />
              <h3>A model, not telemetry</h3>
              <p>
                SPOT's 3D appearance and poses are a cosmetic preview. They do
                not represent actual motion or send robot commands.
              </p>
            </section>
          </div>
          <p className="fine-print">
            No alarm thresholds, universal confidence percentages or verified
            image-to-record links are provided. Timestamps have no supplied
            timezone. Reviews are stored only in this browser.
          </p>
          <Button className="primary" onClick={() => setAbout(false)}>
            Back to the dashboard
          </Button>
        </Modal>
      )}
      {command && (
        <Modal
          title="Where would you like to go?"
          className="command-palette"
          onClose={() => {
            setCommand(false);
            setCommandQuery("");
          }}
        >
          <label className="command-input">
            <Icon name="search" />
            <input
              autoFocus
              placeholder="Find a view, mission, asset or action…"
              value={commandQuery}
              onChange={(e) => setCommandQuery(e.target.value)}
              aria-label="Search views and archived mission records"
            />
            <kbd>ESC</kbd>
          </label>
          <div className="command-results">
            <span className="eyebrow">QUICK NAVIGATION</span>
            {views
              .filter(
                (v) =>
                  !searchNeedle || v[1].toLowerCase().includes(searchNeedle),
              )
              .map(([id, label, icon]) => (
                <button key={id} onClick={() => navigate(id)}>
                  <Icon name={icon} />
                  <span>{label}</span>
                  <Icon name="chevron" size={14} />
                </button>
              ))}
            {data && (
              <>
                <span className="eyebrow">ARCHIVED MISSIONS</span>
                {data.missions
                  .filter((m) =>
                    searchNeedle
                      ? `${m.mission_id} ${m.mission_name}`
                          .toLowerCase()
                          .includes(searchNeedle)
                      : m.mission_id === "M020",
                  )
                  .slice(0, 5)
                  .map((m) => (
                    <button
                      key={m.mission_id}
                      onClick={() => {
                        navigate("overview");
                        selectMission(m.mission_id);
                      }}
                    >
                      <Icon name="robot" />
                      <span>
                        {m.mission_id}
                        <small>{m.mission_name}</small>
                      </span>
                      <Badge value={m.mission_status} />
                    </button>
                  ))}
                {commandActions.length > 0 && (
                  <span className="eyebrow">ARCHIVED INSPECTION EVIDENCE</span>
                )}
                {commandActions.map((a) => (
                  <button
                    key={a.action_id}
                    onClick={() => {
                      navigate("overview");
                      selectMission(a.mission_id);
                      setDrawer(
                        missionSnapshot(data, a.mission_id).actions.find(
                          (x) => x.action_id === a.action_id,
                        ),
                      );
                    }}
                  >
                    <Icon name="pin" />
                    <span>
                      {a.asset_id} · {a.action_id}
                      <small>
                        {shortType(a.action_type)} / {a.location_id} /{" "}
                        {a.mission_id}
                      </small>
                    </span>
                    <Icon name="arrow" size={14} />
                  </button>
                ))}
              </>
            )}
          </div>
          <p className="fine-print">
            Inspection results open the archived report, separate from replay
            time.
          </p>
        </Modal>
      )}
    </>
  );
}
