import React from "react";
import {
  compareConfigurations,
  reliabilityInsights,
  summarize,
  locationSummary,
  humanize,
} from "../lib/engine.js";
import { number, shortType } from "../lib/display.js";
import { Icon } from "./ui.jsx";
export function Metric({
  label,
  value,
  suffix,
  detail,
  icon,
  attention = false,
  progress,
}) {
  return (
    <div className={`metric-card ${attention ? "attention" : ""}`}>
      <div className="metric-label">
        {label}
        <Icon name={icon} />
      </div>
      <div className="metric-number">
        {value}
        <small>{suffix}</small>
      </div>
      <p>{detail}</p>
      {progress !== undefined && (
        <div className="metric-progress">
          <span style={{ width: `${progress || 0}%` }} />
        </div>
      )}
    </div>
  );
}
export default function Insights({ data }) {
  const compare = compareConfigurations(data),
    reliability = reliabilityInsights(data),
    all = summarize(data);
  const locations = locationSummary(data)
    .filter((l) => l.summary.totalActions)
    .sort(
      (a, b) =>
        b.summary.failedActions / b.summary.totalActions -
        a.summary.failedActions / a.summary.totalActions,
    );
  const bar = (label, value, metric, warn = false) => (
    <div className={`bar-row ${warn ? "warning" : ""}`} key={label}>
      <span>{label}</span>
      <div className="bar-track">
        <span style={{ width: `${value || 0}%` }} />
      </div>
      <strong>{metric}</strong>
    </div>
  );
  return (
    <>
      <div className="insight-banner">
        <div>
          <span className="eyebrow">CONFIGURATION INTELLIGENCE</span>
          <h2>
            More successful actions.
            <br />
            Still worth a closer look.
          </h2>
          <p>
            The observed action success rate increased from V1 to V2. Mission
            completion and inspection success still tell different stories.
          </p>
        </div>
        <div className="insight-delta">
          +{number(compare.actionSuccessDeltaPp)}
          <span>percentage points / V2 vs V1</span>
        </div>
      </div>
      <div className="metric-grid">
        <Metric
          label="Missions analyzed"
          value={all.missionCount}
          detail={`${all.completedMissionCount} completed`}
          icon="robot"
        />
        <Metric
          label="Inspection actions"
          value={all.totalActions}
          detail={`${all.failedActions} failed actions`}
          icon="check"
        />
        <Metric
          label="Questionable readings"
          value={all.questionableReadings}
          detail={`Across ${all.readingsCount} supplied readings`}
          icon="flag"
        />
        <Metric
          label="Location conflicts"
          value={all.locationMismatchCount}
          detail="Action waypoint vs asset registry"
          icon="pin"
          attention
        />
      </div>
      <div className="insights-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Completed ≠ fully inspected</h2>
              <p>Two views of mission reliability</p>
            </div>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Configuration</th>
                  <th>Mission completion</th>
                  <th>Action success</th>
                </tr>
              </thead>
              <tbody>
                {compare.configurations.map((c) => (
                  <tr key={c.configuration}>
                    <td>
                      <strong>{c.configuration}</strong>
                      <small>{humanize(c.scenario)}</small>
                    </td>
                    <td>
                      {number(c.missionCompletionRate)}%
                      <small>
                        {c.completedMissionCount} / {c.missionCount} missions
                      </small>
                    </td>
                    <td>
                      {number(c.successRate)}%
                      <small>
                        {c.successfulActions} / {c.terminalActions} actions
                      </small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="panel-note">
            {compare.configurations
              .map(
                (c) =>
                  `${c.configuration}: ${c.completedWithGaps} completed missions contained failed actions.`,
              )
              .join(" ")}{" "}
            {compare.caveat}
          </p>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Which inspections need a closer look?</h2>
              <p>Action success rate · all configurations</p>
            </div>
          </div>
          <div className="bars">
            {reliability.byType.map((t) =>
              bar(
                shortType(t.actionType),
                t.successRate,
                `${t.total - t.failed}/${t.total} · ${number(t.successRate)}%`,
              ),
            )}
          </div>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Where failures concentrate</h2>
              <p>Action waypoint · highest failure rates</p>
            </div>
          </div>
          <div className="bars">
            {locations
              .slice(0, 5)
              .map((l) =>
                bar(
                  `${l.location_id} ${l.location_name}`,
                  (100 * l.summary.failedActions) / l.summary.totalActions,
                  `${l.summary.failedActions}/${l.summary.totalActions} failed`,
                  true,
                ),
              )}
          </div>
          <p className="panel-note">
            Location conflicts are exposed in the evidence. Verify the mapping
            before dispatching work.
          </p>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Battery and inspection outcomes</h2>
              <p>Failure rate grouped by recorded charge</p>
            </div>
          </div>
          <div className="bars">
            {reliability.batteryBands.map((b) =>
              bar(
                b.label,
                b.failureRate,
                `${b.failed}/${b.total} · ${number(b.failureRate)}%`,
                true,
              ),
            )}
          </div>
          <p className="panel-note">{reliability.caveat}</p>
        </section>
      </div>
    </>
  );
}
