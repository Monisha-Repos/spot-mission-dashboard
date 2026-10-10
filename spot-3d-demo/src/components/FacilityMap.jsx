import React, { useState } from "react";
import { Icon, Badge, Empty } from "./ui.jsx";
import { humanize, formatTimestamp } from "../lib/engine.js";
import {
  waypointFindings,
  shortType,
  number,
  unitLabel,
} from "../lib/display.js";

const labels = {
  WP03: [21, -20],
  WP04: [23, 25],
  WP05: [-47, -17],
  WP07: [24, 8],
  WP10: [12, 18],
  WP09: [-28, 24],
  WP02: [-16, 24],
};

export default function FacilityMap({
  locations,
  snapshot,
  selected,
  onSelect,
  onEvidence,
}) {
  const [floor, setFloor] = useState(1);
  const [direction, setDirection] = useState("up");
  const floorLocations = locations.filter((l) => l.floor === floor);
  const findings = selected ? waypointFindings(snapshot.actions, selected) : [];
  const selectedLocation = locations.find((l) => l.location_id === selected);
  const visited = new Set(snapshot.actions.map((a) => a.location_id));
  function switchFloor(next) {
    if (next === floor) return;
    setDirection(next > floor ? "up" : "down");
    setFloor(next);
    onSelect(null);
  }
  const paths = [];
  for (let i = 1; i < snapshot.actions.length; i++) {
    const a = snapshot.actions[i - 1].location,
      b = snapshot.actions[i].location;
    if (a?.floor === floor && b?.floor === floor)
      paths.push(
        `M${a.x_coord},${100 - a.y_coord}L${b.x_coord},${100 - b.y_coord}`,
      );
  }
  return (
    <section className="panel map-panel" aria-label="Facility observations">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">SPATIAL INTELLIGENCE</span>
          <h2>Every observation has a place.</h2>
          <p>Choose a waypoint to see what SPOT found.</p>
        </div>
        <div className="floor-tabs" role="group" aria-label="Facility floor">
          {[1, 2].map((f) => (
            <button
              key={f}
              className={floor === f ? "selected" : ""}
              aria-pressed={floor === f}
              onClick={() => switchFloor(f)}
            >
              <Icon name="layers" size={14} />
              Floor 0{f}
            </button>
          ))}
        </div>
      </div>
      <div className={`map-stage ${selected ? "has-selection" : ""}`}>
        <div className="map-compass">
          N <span>↑</span>
        </div>
        <span className="map-scale">XY / SYNTHETIC FACILITY</span>
        <div className="floor-shadow" aria-hidden="true" />
        <div key={floor} className={`floor-scene enter-${direction}`}>
          <div className="map-grid" aria-hidden="true" />
          <svg
            className="map-architecture"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <path d="M1 93V8H26V1H60V20H99V91H73V99H27V93Z" />
            <path
              d={
                floor === 1
                  ? "M26 8V65H1M26 40H60V20M60 40H99M60 40V90H27V99M73 40V91"
                  : "M26 8V55H1M26 55H73V91M60 20V55M60 75H27V93"
              }
            />
            <text x="9" y="34">
              {floor === 1 ? "PROCESS AREAS" : "AUXILIARY SYSTEMS"}
            </text>
            <text x="40" y="86">
              LEVEL 0{floor}
            </text>
          </svg>
          <svg
            className="route-layer"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            {paths.map((d, i) => (
              <path key={i} d={d} className="route-line" />
            ))}
          </svg>
          {floorLocations.map((l) => {
            const actions = waypointFindings(snapshot.actions, l.location_id),
              attention = actions.filter(
                (a) => a.classification.requiresAttention,
              ),
              critical = actions.some(
                (a) => a.classification.highestSeverity === "CRITICAL",
              ),
              active = selected === l.location_id;
            const offset = labels[l.location_id] || [0, -26];
            return (
              <button
                key={l.location_id}
                className={`waypoint ${attention.length ? "attention" : ""} ${critical ? "critical" : ""} ${visited.has(l.location_id) ? "visited" : ""} ${active ? "selected" : ""}`}
                style={{ left: `${l.x_coord}%`, top: `${100 - l.y_coord}%` }}
                aria-label={`${l.location_id}, ${l.location_name}, ${attention.length} findings, ${actions.length} observed actions`}
                aria-pressed={active}
                onClick={() => onSelect(active ? null : l.location_id)}
              >
                <span className="waypoint-halo" />
                <span className="waypoint-dot">
                  {attention.length || (visited.has(l.location_id) ? "" : "·")}
                </span>
                <span
                  className="waypoint-label"
                  style={{
                    "--label-x": `${offset[0]}px`,
                    "--label-y": `${offset[1]}px`,
                  }}
                >
                  {l.location_id}
                  {attention.length > 0 && <i />}
                </span>
              </button>
            );
          })}
        </div>
        <div className="map-level-label" aria-hidden="true">
          <span>FLOOR</span>
          <strong>0{floor}</strong>
        </div>
      </div>
      <div className="map-legend">
        <span>
          <i className="critical-dot" />
          Critical flag
        </span>
        <span>
          <i className="attention-dot" />
          Needs review
        </span>
        <span>
          <i className="visited-dot" />
          Observed
        </span>
        <small>
          {visited.size} / {locations.length} waypoints
        </small>
      </div>
      {selected && (
        <section
          className="waypoint-inspector"
          aria-label="Selected waypoint findings"
          aria-live="polite"
        >
          <div className="waypoint-inspector-header">
            <div>
              <span className="eyebrow">
                {selectedLocation?.location_id} / FLOOR{" "}
                {selectedLocation?.floor}
              </span>
              <h3>{selectedLocation?.location_name}</h3>
            </div>
            <button
              className="icon-button"
              aria-label="Close waypoint findings"
              onClick={() => onSelect(null)}
            >
              <Icon name="close" size={16} />
            </button>
          </div>
          {findings.length ? (
            <div className="waypoint-findings">
              {findings.map((a) => (
                <button
                  key={a.action_id}
                  className="map-finding"
                  onClick={() => onEvidence(a)}
                >
                  <div>
                    <strong>
                      {a.anomalies[0]
                        ? humanize(
                            [...a.anomalies].sort(
                              (x, y) =>
                                (({ CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 })[
                                  y.severity
                                ] || 0) -
                                ({ CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 }[
                                  x.severity
                                ] || 0),
                            )[0].anomaly_type,
                          )
                        : a.status === "FAILED"
                          ? humanize(a.failure_type)
                          : a.classification.requiresAttention
                            ? a.classification.label
                            : shortType(a.action_type)}
                    </strong>
                    <span>
                      {a.asset?.asset_name || a.asset_id} ·{" "}
                      {formatTimestamp(a.timestamp, {
                        date: false,
                        seconds: true,
                      })}
                    </span>
                    <p>
                      {a.classification.reasons.join(" · ") ||
                        "No source flag recorded. Open the inspection evidence for context."}
                    </p>
                    {a.readings.length > 0 && (
                      <small>
                        {a.readings
                          .map(
                            (r) =>
                              `${number(r.value)} ${unitLabel(r.unit)} · ${r.quality}`,
                          )
                          .join(" / ")}
                      </small>
                    )}
                  </div>
                  <div className="map-finding-end">
                    <Badge
                      value={
                        a.classification.requiresAttention
                          ? a.classification.priority
                          : a.status
                      }
                    />
                    <span>
                      Evidence <Icon name="arrow" size={13} />
                    </span>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <Empty title="No observation at this waypoint">
              This mission has not supplied an action here in the current view.
            </Empty>
          )}
        </section>
      )}
      <p className="map-disclaimer">
        Source waypoint coordinates; illustrative floor outline. Lines show
        inspection order, not a navigable route.
      </p>
    </section>
  );
}
