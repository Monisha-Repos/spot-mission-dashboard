import React, { useState } from "react";
import { Badge, Empty, Icon } from "./ui.jsx";
import { formatTimestamp } from "../lib/engine.js";
export default function AttentionQueue({
  queue,
  reviews,
  onOpen,
  filter,
  setFilter,
  selected,
  onClear,
}) {
  const [expanded, setExpanded] = useState(false);
  const filtered = queue.filter(
    (a) =>
      filter === "all" ||
      (filter === "flags" && a.anomalies.length) ||
      (filter === "failures" && a.status === "FAILED") ||
      (filter === "unreviewed" && !reviews[a.id]?.ack),
  );
  return (
    <section className="panel attention-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">A LITTLE CLARITY GOES A LONG WAY</span>
          <h2>
            Attention queue <span className="count">{filtered.length}</span>
          </h2>
          <p>Prioritized findings. Evidence one click away.</p>
        </div>
        <Icon name="flag" />
      </div>
      <div className="queue-filters">
        {[
          ["all", "All findings"],
          ["flags", "Flags"],
          ["failures", "Failures"],
          ["unreviewed", "Unreviewed"],
        ].map(([value, label]) => (
          <button
            key={value}
            className={filter === value ? "selected" : ""}
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
          >
            {label}
          </button>
        ))}
      </div>
      {selected && (
        <button className="location-filter" onClick={onClear}>
          <Icon name="pin" size={13} />
          {selected}
          <Icon name="close" size={13} />
        </button>
      )}
      <div className="queue-items">
        {(expanded ? filtered : filtered.slice(0, 4)).map((a) => (
          <button
            className={`finding-card ${a.priority === "CRITICAL" ? "critical" : ""}`}
            key={a.id}
            onClick={() => onOpen(a)}
          >
            <div className="finding-top">
              <strong>
                <i />
                {a.title}
              </strong>
              <Badge value={a.priority} />
            </div>
            <p>
              {a.asset?.asset_name || a.asset_id} <span>·</span>{" "}
              {a.location?.location_name || a.location_id}
            </p>
            <div className="finding-bottom">
              <span>
                <Icon name="pin" size={12} />
                {a.location_id}
              </span>
              <span>
                {formatTimestamp(a.timestamp, { date: false, seconds: true })}
              </span>
              {reviews[a.id]?.ack && (
                <span className="reviewed">
                  <Icon name="check" size={12} />
                  Reviewed
                </span>
              )}
              <span className="evidence-link">
                Evidence <Icon name="arrow" size={13} />
              </span>
            </div>
          </button>
        ))}
      </div>
      {!filtered.length && (
        <Empty title="Nothing in this filter">
          Clear the filter to see other findings. Missing evidence is not a
          health clearance.
        </Empty>
      )}
      {filtered.length > 4 && (
        <button className="queue-more" onClick={() => setExpanded(!expanded)}>
          {expanded ? "Show less" : `Show all ${filtered.length} findings`}{" "}
          <Icon name="chevron" size={13} />
        </button>
      )}
      <p className="fine-print queue-footnote">
        Source severity first, then failed inspections, reading quality and
        mapping conflicts.
      </p>
    </section>
  );
}
