import React, { useEffect, useRef, useState } from "react";
import { Badge, BatteryGauge, Button, Icon } from "./ui.jsx";
import { humanize, formatTimestamp, recommendNextStep } from "../lib/engine.js";
import { readingLabel, shortType, number, unitLabel } from "../lib/display.js";
export function Modal({ title, children, onClose, className = "" }) {
  const ref = useRef();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog.open) dialog.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${className}`}
      aria-label={title}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) ref.current.close();
      }}
    >
      <div className="modal-inner">
        <div className="modal-header">
          <span className="eyebrow">SPOTLIGHT / MISSION INTELLIGENCE</span>
          <button
            className="icon-button"
            aria-label="Close dialog"
            onClick={() => ref.current.close()}
          >
            <Icon name="close" />
          </button>
        </div>
        <h2>{title}</h2>
        {children}
      </div>
    </dialog>
  );
}
export default function EvidenceDrawer({
  action: a,
  review = {},
  onSave,
  onClose,
  onDownload,
  live = false,
}) {
  const [note, setNote] = useState(review.note || ""),
    [ack, setAck] = useState(!!review.ack);
  const highest = [...a.anomalies].sort(
    (x, y) =>
      (({ CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 })[y.severity] || 0) -
      ({ CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 }[x.severity] || 0),
  )[0];
  const title = highest
    ? humanize(highest.anomaly_type)
    : a.status === "FAILED"
      ? humanize(a.failure_type || "Failed inspection")
      : shortType(a.action_type) + " inspection";
  return (
    <Modal title={title} onClose={onClose} className="evidence-drawer">
      <p className="drawer-subtitle">
        {a.asset?.asset_name || a.asset_id || "Asset not supplied"} ·{" "}
        {a.location?.location_name || a.location_id || "Location not supplied"}
        <br />
        {live ? a.timestamp : formatTimestamp(a.timestamp, { seconds: true })}
        {!live && " · source timezone unspecified"}
      </p>
      <div className="badge-row">
        <Badge value={a.status} />
        {a.classification.requiresAttention && (
          <Badge value={a.classification.priority} />
        )}
        <span className="quiet-tag">
          {live
            ? "RECEIVED EVENTS"
            : a.readings.some((r) => r.reconstructed) ||
                a.anomalies.some((n) => n.reconstructed)
              ? "RECONSTRUCTED CSV EVIDENCE"
              : "ARCHIVED EVIDENCE"}
        </span>
      </div>
      <section className="evidence-section next-step">
        <Icon name="spark" />
        <div>
          <h3>Your next step</h3>
          <p>{a.recommendation || recommendNextStep(a)}</p>
          <small>Explainable triage rule · operator decides</small>
        </div>
      </section>
      <section className="evidence-section">
        <h3>What SPOT reported</h3>
        {a.classification.reasons.length ? (
          a.classification.reasons.map((reason) => (
            <p className="reason" key={reason}>
              <span /> {reason}
            </p>
          ))
        ) : (
          <p>
            No source flag is recorded. This does not establish equipment
            health.
          </p>
        )}
        {a.anomalies.map((n) => (
          <div className="anomaly-detail" key={n.anomaly_id}>
            <div>
              <Badge value={n.severity} />
              <strong>{humanize(n.anomaly_type)}</strong>
            </div>
            <p>{n.description}</p>
            <small>
              {n.anomaly_id} · {n.timestamp} ·{" "}
              {n.operator_review_required
                ? "Operator review required"
                : "Review optional in source"}
            </small>
          </div>
        ))}
      </section>
      {a.locationMismatch && (
        <div className="warning-box">
          <Icon name="pin" />
          <span>
            <strong>Check the location before dispatching.</strong> The action
            records {a.location_id}; the asset registry records{" "}
            {a.asset.location_id}. The map uses the action waypoint.
          </span>
        </div>
      )}
      {highest?.anomaly_type === "ABNORMAL_TEMPERATURE" &&
        !a.readings.some((r) => r.measurement_type === "TEMPERATURE_C") && (
          <div className="warning-box">
            This temperature flag has no linked temperature reading in the
            available evidence. Verify the source before drawing a conclusion.
          </div>
        )}
      <section className="evidence-section">
        <h3>Recorded readings</h3>
        {a.readings.length ? (
          a.readings.map((r) => (
            <div className="reading-row" key={r.reading_id}>
              <div>
                <strong>{readingLabel(r)}</strong>
                <small>
                  {r.reading_id} ·{" "}
                  {live
                    ? r.timestamp
                    : formatTimestamp(r.timestamp, {
                        date: false,
                        seconds: true,
                      })}
                </small>
              </div>
              <div>
                <b>
                  {number(r.value)} <small>{unitLabel(r.unit)}</small>
                </b>
                <Badge value={r.quality} />
              </div>
            </div>
          ))
        ) : (
          <p>
            No reading has been supplied for this action in the current view.
          </p>
        )}
        <p className="fine-print">
          Quality is the source's label, not a probability of equipment health.
          Numeric alarm thresholds and record-linked inspection photos are not
          supplied.
        </p>
      </section>
      <section className="evidence-section">
        <h3>Follow the source</h3>
        <dl className="source-grid">
          <div>
            <dt>Mission / action</dt>
            <dd>
              {a.mission_id} / {a.action_id}
            </dd>
          </div>
          <div>
            <dt>Asset / waypoint</dt>
            <dd>
              {a.asset_id || "Unknown"} / {a.location_id || "Unknown"}
            </dd>
          </div>
          <div>
            <dt>Inspection</dt>
            <dd>{shortType(a.action_type)}</dd>
          </div>
          <div>
            <dt>Battery at observation</dt>
            <dd>
              <BatteryGauge
                value={a.battery_pct}
                compact
                label="Battery at observation"
              />
            </dd>
          </div>
        </dl>
        <details>
          <summary>Inspect record fields</summary>
          <pre>{JSON.stringify(a, null, 2)}</pre>
        </details>
        <button
          className="text-button"
          onClick={() =>
            onDownload(
              `Spotlight-${a.action_id}-evidence.json`,
              JSON.stringify(a, null, 2),
              "application/json",
            )
          }
        >
          Download evidence <Icon name="download" size={14} />
        </button>
      </section>
      {!live && (
        <section className="evidence-section">
          <h3>Your review</h3>
          <label className="field-label" htmlFor="evidence-note">
            Context for the next operator
          </label>
          <textarea
            id="evidence-note"
            placeholder="Who should follow up? What should they verify?"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <label className="check-row">
            <input
              type="checkbox"
              checked={ack}
              onChange={(e) => setAck(e.target.checked)}
            />
            I have reviewed this finding
          </label>
          <Button
            className="primary"
            icon="check"
            onClick={() =>
              onSave(a.action_id, {
                ack,
                note,
                updatedAt: new Date().toISOString(),
              })
            }
          >
            Save review
          </Button>
          <p className="fine-print">
            Saved in this browser. Reviewing a finding does not resolve the
            equipment issue.
          </p>
        </section>
      )}
    </Modal>
  );
}
