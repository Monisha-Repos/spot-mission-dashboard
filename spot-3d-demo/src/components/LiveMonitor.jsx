import React, { useEffect, useMemo, useRef, useState } from "react";
import { liveSnapshot, validateLiveEvent } from "../lib/live-engine.js";
import { humanize } from "../lib/engine.js";
import { number, readingLabel, unitLabel } from "../lib/display.js";
import { Badge, BatteryGauge, Button, Empty, Icon } from "./ui.jsx";
export default function LiveMonitor({ notify, onOpen, onExportRef, download }) {
  const [events, setEvents] = useState([]),
    [status, setStatus] = useState("Ready for incoming evidence"),
    [connected, setConnected] = useState(false),
    [gap, setGap] = useState(false),
    [running, setRunning] = useState(false);
  const source = useRef(null),
    timer = useRef(null),
    file = useRef(null),
    streamBuffer = useRef([]);
  const feed = useMemo(() => liveSnapshot(events), [events]);
  function stop() {
    clearInterval(timer.current);
    timer.current = null;
    source.current?.close();
    source.current = null;
    setConnected(false);
    setRunning(false);
  }
  useEffect(
    () => () => {
      clearInterval(timer.current);
      source.current?.close();
    },
    [],
  );
  useEffect(() => {
    onExportRef.current = () =>
      download(
        "Spotlight-live-evidence.json",
        JSON.stringify(
          {
            events,
            state: feed,
            incomplete: gap,
            sourceMode: status,
            exportedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
        "application/json",
      );
    return () => {
      onExportRef.current = null;
    };
  }, [events, feed, gap, status, onExportRef, download]);
  async function demo() {
    stop();
    try {
      const res = await fetch(
        `${import.meta.env.BASE_URL}data/live-demo.ndjson`,
      );
      if (!res.ok) throw Error("Demo sample unavailable");
      const rows = (await res.text()).trim().split(/\r?\n/).map(JSON.parse);
      if (rows.some((r) => !validateLiveEvent(r).valid))
        throw Error("Invalid demo data");
      setEvents([]);
      setGap(false);
      setRunning(true);
      setStatus("Synthetic event demo · no robot connected");
      let index = 0;
      timer.current = setInterval(() => {
        const row = rows[index++];
        setEvents((prior) => [...prior, row]);
        setStatus(`Synthetic event demo · ${index}/${rows.length} events`);
        if (index === rows.length) {
          clearInterval(timer.current);
          setRunning(false);
          setStatus("Synthetic demo finished · no robot connected");
        }
      }, 850);
    } catch (e) {
      notify(e.message);
    }
  }
  async function connect() {
    if (connected) {
      stop();
      setStatus("Disconnected");
      return;
    }
    stop();
    try {
      const res = await fetch("/api/health", {
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) throw Error("Gateway unavailable");
      const health = await res.json();
      if (!health.ok) throw Error("Gateway unavailable");
      const mode =
        health.mode === "synthetic-replay"
          ? "Synthetic gateway replay"
          : "Gateway feed";
      setEvents([]);
      streamBuffer.current = [];
      setGap(false);
      const stream = new EventSource("/api/events");
      source.current = stream;
      setConnected(true);
      setStatus("Connecting…");
      stream.onopen = () => setStatus(`${mode} connected`);
      stream.onerror = () => setStatus("Connection interrupted · retrying");
      stream.addEventListener("stream-reset", () => {
        setGap(true);
        setStatus("History gap · evidence incomplete");
      });
      stream.addEventListener("mission-event", (message) => {
        try {
          const row = JSON.parse(message.data);
          if (!validateLiveEvent(row).valid) throw Error();
          if (
            streamBuffer.current.some(
              (e) => JSON.stringify(e) === JSON.stringify(row),
            )
          )
            return;
          const next = [...streamBuffer.current, row];
          if (next.length > 2000) setGap(true);
          streamBuffer.current = next.slice(-2000);
          setEvents(streamBuffer.current);
          setStatus(`${mode} · receiving events`);
        } catch {
          notify("Invalid incoming event rejected.");
        }
      });
    } catch {
      notify(
        "Gateway not running here. Use the synthetic demo or run the optional Python gateway after building.",
      );
    }
  }
  async function importLog(e) {
    const input = e.target,
      selectedFile = input.files?.[0];
    if (!selectedFile) return;
    try {
      if (selectedFile.size > 8 * 1024 * 1024)
        throw Error("Choose a file smaller than 8 MB.");
      const text = await selectedFile.text();
      let rows;
      try {
        const json = JSON.parse(text);
        rows = Array.isArray(json) ? json : json.events || [json];
      } catch {
        rows = text.trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
      }
      if (
        !Array.isArray(rows) ||
        !rows.length ||
        rows.length > 10000 ||
        rows.some((r) => !validateLiveEvent(r).valid)
      )
        throw Error("Use valid Spotlight event JSON or NDJSON.");
      stop();
      setEvents(rows.slice(-2000));
      setGap(rows.length > 2000);
      setStatus(`Imported ${rows.length} events · ${selectedFile.name}`);
      notify("Event log loaded. Archived missions are unchanged.");
    } catch (err) {
      notify(err.message);
    } finally {
      input.value = "";
    }
  }
  return (
    <>
      <div className="live-intro">
        <div>
          <span className="eyebrow">LISTEN → UNDERSTAND → ACT</span>
          <h2>Watch evidence turn into understanding.</h2>
          <p>
            Try eight synthetic events, or bring an event log. Live evidence is
            never filled in from archived mission records.
          </p>
          <div className="inline-controls">
            <Button
              className="primary"
              icon="play"
              onClick={demo}
              disabled={running}
            >
              Run synthetic demo
            </Button>
            <Button icon="live" onClick={connect}>
              {connected ? "Disconnect" : "Connect gateway"}
            </Button>
            <Button icon="download" onClick={() => file.current.click()}>
              Import event log
            </Button>
            <input
              hidden
              ref={file}
              type="file"
              accept=".json,.ndjson,.jsonl"
              onChange={importLog}
            />
          </div>
        </div>
        <div
          className={`signal-visual ${connected || running ? "receiving" : ""}`}
          aria-hidden="true"
        >
          <span />
          <span />
          <span />
          <Icon name="live" size={32} />
        </div>
      </div>
      <div className="stream-status" role="status">
        <i className={connected || running ? "receiving" : ""} />
        {status}
        <span>{events.length} events received</span>
      </div>
      {gap && (
        <div className="warning-box">
          This feed has a history gap. Export or import a complete source log
          before relying on the reconstruction.
        </div>
      )}
      {feed.issues.length > 0 && (
        <div className="warning-box">
          {feed.issues.length} source consistency issue(s). Export the evidence
          to inspect the conflicts.
        </div>
      )}
      {!feed.missions.length && (
        <Empty title="Ready for the first observation">
          Run the demo above to see a reading, a critical flag and a failed
          inspection arrive in sequence.
        </Empty>
      )}
      {feed.missions.map((m) => (
        <section className="panel live-mission" key={m.mission_id}>
          <div className="panel-heading">
            <div>
              <h2>{m.mission_id}</h2>
              <p>
                {m.summary.actions} actions · {m.summary.failed} failed ·{" "}
                {m.summary.readings} readings · {m.summary.anomalies} source
                flags
              </p>
            </div>
            <div className="inline-controls">
              <BatteryGauge value={m.batteryPct} />
              <Badge value={m.status} />
            </div>
          </div>
          {m.gaps.map((g) => (
            <p className="panel-note" key={g}>
              {g}
            </p>
          ))}
          <div className="queue-items live-findings">
            {m.actions
              .filter((a) => a.classification.requiresAttention)
              .sort((a, b) => b.classification.rank - a.classification.rank)
              .map((a) => (
                <button
                  className="finding-card"
                  key={a.action_id}
                  onClick={() => onOpen({ ...a, live: true })}
                >
                  <div className="finding-top">
                    <strong>{a.asset_id || a.action_id}</strong>
                    <Badge value={a.classification.priority} />
                  </div>
                  <p>{a.classification.reasons.join(" · ")}</p>
                  <div className="finding-bottom">
                    <span>{a.location_id || "Location not supplied"}</span>
                    <span className="evidence-link">
                      Live evidence <Icon name="arrow" size={13} />
                    </span>
                  </div>
                </button>
              ))}
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Action / asset</th>
                  <th>Location / timestamp</th>
                  <th>Readings received</th>
                  <th>Outcome</th>
                </tr>
              </thead>
              <tbody>
                {m.actions.map((a) => (
                  <tr key={a.action_id}>
                    <td>
                      <button
                        className="table-action"
                        onClick={() => onOpen({ ...a, live: true })}
                      >
                        {a.action_id}
                        <small>{a.asset_id || "Asset not supplied"}</small>
                      </button>
                    </td>
                    <td>
                      {a.location_id || "Not supplied"}
                      <small>{a.timestamp}</small>
                    </td>
                    <td>
                      {a.readings.length
                        ? a.readings.map((r) => (
                            <span className="table-reading" key={r.reading_id}>
                              {number(r.value)} {unitLabel(r.unit)}
                              <small>
                                {readingLabel(r)} · {r.quality}
                              </small>
                            </span>
                          ))
                        : "Not supplied"}
                    </td>
                    <td>
                      <Badge value={a.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      {events.length > 0 && (
        <section className="panel event-trail">
          <div className="panel-heading">
            <div>
              <h2>Event trail</h2>
              <p>Original source IDs and times · latest 8 records</p>
            </div>
          </div>
          <div className="event-log">
            {events
              .slice(-8)
              .reverse()
              .map((e, i) => (
                <div key={`${e.event_id}-${i}`}>
                  <span>
                    {e.event_id} · {e.timestamp}
                  </span>
                  <strong>{humanize(e.event_type)}</strong>
                  {e.details.action_id && <small>{e.details.action_id}</small>}
                </div>
              ))}
          </div>
        </section>
      )}
      <p className="fine-print">
        The live demo is an additional labeled synthetic sample. The optional
        gateway accepts Spotlight events, not native Orbit webhooks; the
        project's Java mission-ingest API is separate. Leaving this view stops
        the feed; export it to retain evidence.
      </p>
    </>
  );
}
