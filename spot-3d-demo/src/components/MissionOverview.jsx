import React from "react";
import { Badge, BatteryGauge, Button, Empty, Icon } from "./ui.jsx";
import { Metric } from "./Insights.jsx";
import FacilityMap from "./FacilityMap.jsx";
import AttentionQueue from "./AttentionQueue.jsx";
import { RobotCompanion } from "./RobotPanel.jsx";
import { formatTimestamp, humanize } from "../lib/engine.js";
import { number, shortType, readingLabel, unitLabel } from "../lib/display.js";
const clock = (t) => formatTimestamp(t, { date: false, seconds: true });

export function MissionStrip({
  data,
  missionId,
  snapshot,
  replay,
  selectMission,
}) {
  const mission = data.missions.find((m) => m.mission_id === missionId);
  return (
    <section className="mission-strip">
      <div className="mission-identity">
        <span className="mission-icon">
          <Icon name="robot" size={25} />
        </span>
        <div>
          <label className="sr-only" htmlFor="mission-select">
            Select mission
          </label>
          <select
            id="mission-select"
            value={missionId}
            onChange={(e) => selectMission(e.target.value)}
          >
            {data.missions.map((m) => (
              <option key={m.mission_id} value={m.mission_id}>
                {m.mission_id} ·{" "}
                {m.mission_name.replace("Autowalk Inspection ", "")}
              </option>
            ))}
          </select>
          <small>
            {formatTimestamp(mission.start_time)} ·{" "}
            {mission.configuration_version} ·{" "}
            {replay ? "Recorded replay" : "Archived report"}
          </small>
        </div>
      </div>
      <div className="mission-facts">
        <div>
          <span>MISSION STATUS</span>
          <Badge value={snapshot.missionStatus} />
        </div>
        <div>
          <span>{replay ? "OBSERVED BATTERY" : "REMAINING BATTERY"}</span>
          <BatteryGauge value={snapshot.batteryPct} />
        </div>
        <div className="duration-fact">
          <span>{replay ? "OBSERVED EVENTS" : "MISSION DURATION"}</span>
          <strong>
            {replay
              ? `${snapshot.events.length} events`
              : `${number(mission.duration_min)} min`}
          </strong>
        </div>
      </div>
    </section>
  );
}

export default function MissionOverview({
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
}) {
  const s = snapshot.summary;
  const matches = (a) =>
    (!selectedLocation || a.location_id === selectedLocation) &&
    (!query ||
      `${a.title || ""} ${a.asset_id} ${a.asset?.asset_name} ${a.location_id} ${a.location?.location_name} ${a.action_id} ${a.action_type}`
        .toLowerCase()
        .includes(query.toLowerCase()));
  const actions = snapshot.actions
    .filter(matches)
    .filter((a) => !focusOnly || a.classification.requiresAttention);
  return (
    <>
      {view === "replay" && (
        <>
          <section className="replay-controls">
            <Button
              icon={playing ? "pause" : "play"}
              className="primary"
              disabled={!replayEvents.length}
              onClick={() => {
                if (!playing && eventIndex >= replayEvents.length - 1)
                  setEventIndex(0);
                setPlaying(!playing);
              }}
            >
              {playing ? "Pause" : "Play"}
            </Button>
            <button
              className="icon-button"
              aria-label="Restart replay"
              disabled={!replayEvents.length}
              onClick={() => {
                setPlaying(false);
                setEventIndex(0);
              }}
            >
              <Icon name="reset" size={16} />
            </button>
            <div className="timeline-control">
              <label className="sr-only" htmlFor="replay-timeline">
                Replay event position
              </label>
              <input
                id="replay-timeline"
                type="range"
                min="0"
                max={Math.max(0, replayEvents.length - 1)}
                value={eventIndex}
                disabled={!replayEvents.length}
                onChange={(e) => {
                  setPlaying(false);
                  setEventIndex(+e.target.value);
                }}
              />
              <div>
                <span>
                  Event {replayEvents.length ? eventIndex + 1 : 0} /{" "}
                  {replayEvents.length}
                </span>
                <span>
                  {replayEvents[eventIndex]
                    ? humanize(replayEvents[eventIndex].event_type)
                    : "No replay supplied"}
                </span>
              </div>
            </div>
            <Button
              disabled={eventIndex >= replayEvents.length - 1}
              onClick={() => {
                setPlaying(false);
                setEventIndex((i) => i + 1);
              }}
            >
              Step →
            </Button>
            <select
              aria-label="Replay speed"
              value={speed}
              onChange={(e) => setSpeed(+e.target.value)}
            >
              {[1, 2, 4].map((n) => (
                <option key={n} value={n}>
                  {n}× speed
                </option>
              ))}
            </select>
            <div className="replay-clock">
              {replayEvents[eventIndex]
                ? clock(replayEvents[eventIndex].timestamp)
                : "—"}
              <small>RECORDED SOURCE TIME</small>
            </div>
          </section>
          <p className="replay-note">
            {snapshot.replayCoverage.coverage === "complete"
              ? "Complete mission stream."
              : snapshot.replayCoverage.coverage === "partial"
                ? "Partial stream: supplied events end mid-mission."
                : "No events supplied for this mission."}{" "}
            CSV readings and flags are reconstructed only after their action
            outcome arrives. Source timezone unspecified.
          </p>
        </>
      )}
      <div className="metric-grid">
        <Metric
          label="Inspection success"
          value={number(s.successRate)}
          suffix="%"
          detail={`${s.successfulActions} of ${s.terminalActions} finished actions succeeded`}
          icon="check"
          progress={s.successRate}
        />
        <Metric
          label="Needs attention"
          value={s.attentionCount}
          suffix="actions"
          detail={`${s.anomalyCount} flags · ${s.failedActions} failures · ${s.locationMismatchCount} location conflicts`}
          icon="flag"
          attention
        />
        <Metric
          label="Reading evidence"
          value={s.readingsCount}
          suffix="readings"
          detail={`${s.questionableReadings} questionable · ${s.missingReadings} actions without readings`}
          icon="layers"
        />
        <Metric
          label="Operator review"
          value={s.reviewRequired}
          suffix="flags"
          detail={`${s.criticalAnomalies} critical · ${s.highAnomalies} high priority`}
          icon="pin"
        />
      </div>
      <div className="operator-brief">
        <span>
          <Icon name="spark" />
        </span>
        <p>
          <strong>The operator brief</strong>
          {!s.totalActions
            ? "Waiting for the first action. No inspection outcomes have arrived."
            : snapshot.missionStatus === "COMPLETED" && s.failedActions
              ? `The route is completed, but ${s.failedActions} inspection${s.failedActions === 1 ? "" : "s"} failed. A finished mission doesn't mean every asset was inspected successfully.`
              : `${s.successfulActions} actions succeeded. ${s.attentionCount} actions need a closer look at flags, reading quality or location mapping.`}
        </p>
        <span className="brief-label">EVIDENCE, EXPLAINED</span>
      </div>
      <div className="dashboard-grid">
        <div className="map-column">
          <FacilityMap
            key={missionId}
            locations={data.locations}
            snapshot={snapshot}
            selected={selectedLocation}
            onSelect={setSelectedLocation}
            onEvidence={openEvidence}
          />
          <RobotCompanion onExplore={() => navigate("robot")} />
        </div>
        <AttentionQueue
          key={missionId}
          queue={queue.filter(matches)}
          reviews={reviews}
          onOpen={openEvidence}
          filter={filter}
          setFilter={setFilter}
          selected={selectedLocation}
          onClear={() => setSelectedLocation(null)}
        />
      </div>
      <div className="lower-grid">
        <section className="panel inspection-panel">
          <div className="panel-heading">
            <div>
              <h2>Inspection log</h2>
              <p>Action outcomes, separate from mission status</p>
            </div>
            <div className="inspection-tools">
              <button
                className={`focus-toggle ${focusOnly ? "selected" : ""}`}
                aria-pressed={focusOnly}
                onClick={() => setFocusOnly(!focusOnly)}
              >
                <Icon name="filter" size={14} />
                Focus findings
              </button>
              <label className="search-field">
                <Icon name="search" size={14} />
                <input
                  type="search"
                  placeholder="Asset, action or location…"
                  aria-label="Search inspection log and attention queue"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
            </div>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Inspection / asset</th>
                  <th>Location</th>
                  <th>Source time</th>
                  <th>Outcome</th>
                  <th>Battery</th>
                </tr>
              </thead>
              <tbody>
                {actions.map((a) => (
                  <tr key={a.action_id}>
                    <td>
                      <button
                        className="table-action"
                        onClick={() => openEvidence(a)}
                      >
                        {shortType(a.action_type)}
                        <small>
                          {a.action_id} · {a.asset_id}
                        </small>
                      </button>
                    </td>
                    <td>
                      <button
                        className="table-location"
                        onClick={() => openEvidence(a)}
                      >
                        <Icon name="pin" size={12} />
                        {a.location_id}
                      </button>
                    </td>
                    <td className="tabular">{clock(a.timestamp)}</td>
                    <td>
                      <Badge value={a.status} />
                      {a.anomalies.length > 0 && (
                        <small>
                          {a.anomalies.length} source flag
                          {a.anomalies.length === 1 ? "" : "s"}
                        </small>
                      )}
                    </td>
                    <td>
                      <BatteryGauge
                        value={a.battery_pct}
                        compact
                        label="Battery at inspection"
                      />
                    </td>
                  </tr>
                ))}
                {!actions.length && (
                  <tr>
                    <td colSpan="5">
                      <Empty title="No matching inspections">
                        Try another filter or advance the replay.
                      </Empty>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Latest readings</h2>
              <p>Observed values. Original source quality.</p>
            </div>
            <Icon name="layers" />
          </div>
          <div className="reading-list">
            {[...snapshot.readings]
              .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
              .slice(0, 5)
              .map((r) => (
                <button
                  className="reading-row"
                  key={r.reading_id}
                  onClick={() =>
                    openEvidence(
                      snapshot.actions.find((a) => a.action_id === r.action_id),
                    )
                  }
                >
                  <div>
                    <strong>{readingLabel(r)}</strong>
                    <small>
                      {r.asset_id} · {clock(r.timestamp)}
                      {r.reconstructed ? " · Reconstructed" : ""}
                    </small>
                  </div>
                  <div>
                    <b>
                      {number(r.value)} <small>{unitLabel(r.unit)}</small>
                    </b>
                    <Badge value={r.quality} />
                  </div>
                </button>
              ))}
            {!snapshot.readings.length && (
              <Empty title="No readings yet">
                Available sensor evidence will appear here.
              </Empty>
            )}
          </div>
          <p className="panel-note">
            GOOD describes the reading's quality. It does not establish
            equipment health.
          </p>
        </section>
      </div>
      {view === "replay" && (
        <section className="panel event-trail">
          <div className="panel-heading">
            <div>
              <h2>The event trail</h2>
              <p>Source order is preserved, even when timestamps match.</p>
            </div>
            <span className="quiet-tag">
              {snapshot.events.length} OBSERVED EVENTS
            </span>
          </div>
          <div className="event-log">
            {snapshot.events
              .slice(-6)
              .reverse()
              .map((e) => (
                <div key={e.event_id}>
                  <span>
                    {e.event_id} · {clock(e.timestamp)}
                  </span>
                  <strong>{humanize(e.event_type)}</strong>
                  <small>
                    {e.details.action_id || e.mission_id}{" "}
                    {e.details.status && `/ ${e.details.status}`}
                  </small>
                </div>
              ))}
          </div>
        </section>
      )}
    </>
  );
}
