#!/usr/bin/env python3
"""Spotlight static demo + loopback event gateway. Python 3.10+, no dependencies.

This receives the challenge-kit schema plus Spotlight evidence extensions,
not native Orbit webhook payloads.
It is a local development server, not an authenticated production service.
"""
from __future__ import annotations

import argparse
from collections import OrderedDict, deque
from datetime import datetime
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import math
from pathlib import Path
import re
import threading
import time
from urllib.parse import parse_qs, urlsplit

MAX_BODY = 1_048_576
MAX_BATCH = 500
MAX_EVENT = 65_536
HISTORY_LIMIT = 2000
SEEN_LIMIT = 10000
KIT_EVENT_TYPES = frozenset({"MISSION_STARTED", "MISSION_COMPLETED", "ACTION_STARTED", "ACTION_COMPLETED", "ACTION_FAILED"})
EVIDENCE_EVENT_TYPES = frozenset({"READING_CAPTURED", "ANOMALY_DETECTED"})
EVENT_TYPES = KIT_EVENT_TYPES | EVIDENCE_EVENT_TYPES
IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$")
TIME_FORMAT = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$")


class ValidationError(ValueError):
    pass


def _reject_constant(value):
    raise ValidationError(f"Non-finite number is not valid JSON: {value}")


def _validate_tree(value, depth=0):
    if depth > 16:
        raise ValidationError("Event nesting exceeds 16 levels")
    if isinstance(value, dict):
        if len(value) > 200:
            raise ValidationError("An object has too many fields")
        for key, item in value.items():
            if len(key) > 128:
                raise ValidationError("Field name is too long")
            _validate_tree(item, depth + 1)
    elif isinstance(value, list):
        if len(value) > 500:
            raise ValidationError("An array has too many values")
        for item in value:
            _validate_tree(item, depth + 1)
    elif isinstance(value, str) and len(value) > 16384:
        raise ValidationError("String value is too long")


def _validate_evidence(event_type, details):
    """Spotlight adapter schema. These are not native kit or Orbit events."""
    required = {"action_id"}
    if event_type == "READING_CAPTURED":
        required |= {"reading_id", "measurement_type", "value", "unit", "quality"}
        id_fields = ("action_id", "reading_id")
        text_fields = {"measurement_type": 120, "unit": 64}
    else:
        required |= {"anomaly_id", "anomaly_type", "severity", "operator_review_required", "description"}
        id_fields = ("action_id", "anomaly_id")
        text_fields = {"anomaly_type": 120, "description": 4000}
    missing = required - details.keys()
    extra = details.keys() - required - {"asset_id", "location_id"}
    if missing or extra:
        raise ValidationError(f"{event_type} details fields: missing={sorted(missing)}, unsupported={sorted(extra)}")
    for field in id_fields:
        if not isinstance(details[field], str) or not IDENTIFIER.fullmatch(details[field]):
            raise ValidationError(f"details.{field} must be a valid identifier")
    for field, maximum in text_fields.items():
        if not isinstance(details[field], str) or not details[field].strip() or len(details[field]) > maximum:
            raise ValidationError(f"details.{field} must be nonempty text up to {maximum} characters")
    if event_type == "READING_CAPTURED":
        value = details["value"]
        try:
            finite = not isinstance(value, bool) and isinstance(value, (int, float)) and math.isfinite(value)
        except OverflowError:
            finite = False
        if not finite:
            raise ValidationError("details.value must be a finite number")
        quality = details["quality"]
        if not isinstance(quality, str) or quality not in {"GOOD", "QUESTIONABLE", "UNSPECIFIED"}:
            raise ValidationError("details.quality must be GOOD, QUESTIONABLE, or UNSPECIFIED")
    else:
        severity = details["severity"]
        if not isinstance(severity, str) or severity not in {"LOW", "MEDIUM", "HIGH", "CRITICAL"}:
            raise ValidationError("details.severity must be LOW, MEDIUM, HIGH, or CRITICAL")
        if not isinstance(details["operator_review_required"], bool):
            raise ValidationError("details.operator_review_required must be a boolean")


def validate_event(event):
    """Validate without enriching the source event or inventing a timezone."""
    if not isinstance(event, dict):
        raise ValidationError("Each event must be a JSON object")
    for key in ("event_id", "mission_id"):
        if not isinstance(event.get(key), str) or not IDENTIFIER.fullmatch(event[key]):
            raise ValidationError(f"{key} must be a 1–128 character identifier")
    if not isinstance(event.get("event_type"), str) or event["event_type"] not in EVENT_TYPES:
        raise ValidationError("event_type must be a supported challenge-kit or Spotlight adapter event type")
    timestamp = event.get("timestamp")
    if not isinstance(timestamp, str) or len(timestamp) > 40 or not TIME_FORMAT.fullmatch(timestamp):
        raise ValidationError("timestamp must be an ISO date/time with seconds")
    try:
        datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValidationError("timestamp is not a valid date/time") from exc
    details = event.get("details")
    if not isinstance(details, dict):
        raise ValidationError("details must be an object")
    if "synthetic" in event and not isinstance(event["synthetic"], bool):
        raise ValidationError("synthetic must be a boolean when supplied")
    if event["event_type"] in EVIDENCE_EVENT_TYPES:
        _validate_evidence(event["event_type"], details)
    if event["event_type"].startswith("ACTION_"):
        if not isinstance(details.get("action_id"), str) or not IDENTIFIER.fullmatch(details["action_id"]):
            raise ValidationError("Action events require details.action_id")
    for key in ("location_id", "asset_id"):
        if key in details and (not isinstance(details[key], str) or not IDENTIFIER.fullmatch(details[key])):
            raise ValidationError(f"details.{key} must be a valid identifier")
    for key in ("battery_pct", "end_battery_pct"):
        value = details.get(key)
        if value is not None and (isinstance(value, bool) or not isinstance(value, (int, float)) or not 0 <= value <= 100):
            raise ValidationError(f"details.{key} must be a number from 0 to 100")
    status = details.get("status")
    expected = {"ACTION_COMPLETED": {"SUCCESS"}, "ACTION_FAILED": {"FAILED"}, "MISSION_COMPLETED": {"COMPLETED", "FAILED"}}
    if event["event_type"] in expected and (not isinstance(status, str) or status not in expected[event["event_type"]]):
        raise ValidationError("Terminal event details.status is missing or inconsistent")
    _validate_tree(event)
    try:
        encoded = json.dumps(event, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
    except (ValueError, TypeError) as exc:
        raise ValidationError("Event must contain only finite JSON values") from exc
    if len(encoded.encode("utf-8")) > MAX_EVENT:
        raise ValidationError("Event exceeds 64 KiB")
    return event


def parse_events(raw, content_type="application/json"):
    if not raw or len(raw) > MAX_BODY:
        raise ValidationError("Request body must be between 1 byte and 1 MiB")
    try:
        source = raw.decode("utf-8")
        if content_type in {"application/x-ndjson", "application/ndjson"}:
            events = [json.loads(line, parse_constant=_reject_constant) for line in source.splitlines() if line.strip()]
        else:
            value = json.loads(source, parse_constant=_reject_constant)
            if isinstance(value, dict) and "events" in value:
                value = value["events"]
            events = value if isinstance(value, list) else [value]
    except (UnicodeDecodeError, json.JSONDecodeError, RecursionError) as exc:
        raise ValidationError("Body must contain valid UTF-8 JSON") from exc
    if not 1 <= len(events) <= MAX_BATCH:
        raise ValidationError("A request must contain 1–500 events")
    return [validate_event(event) for event in events]


class EventHub:
    def __init__(self, history_limit=HISTORY_LIMIT, seen_limit=SEEN_LIMIT, mode="manual"):
        self.condition = threading.Condition()
        self.history = deque(maxlen=history_limit)
        self.seen = OrderedDict()
        self.seen_limit = seen_limit
        self.cursor = 0
        self.clients = 0
        self.mode = mode
        self.replay_state = "idle"
        self.stopping = False

    def publish(self, events):
        """Atomically reject conflicting IDs; identical retries are idempotent."""
        prepared = []
        batch = {}
        for event in events:
            validate_event(event)
            key = (event["mission_id"], event["event_id"])
            data = json.dumps(event, ensure_ascii=False, allow_nan=False, sort_keys=True, separators=(",", ":"))
            if key in batch and batch[key] != data:
                raise ValidationError("A batch reuses an event ID with different data")
            batch[key] = data
            prepared.append((key, data))
        with self.condition:
            for key, data in prepared:
                if key in self.seen and self.seen[key] != data:
                    raise ValidationError("Event ID already exists with different data")
            accepted = 0
            for key, data in prepared:
                if key in self.seen:
                    continue
                self.cursor += 1
                self.history.append((self.cursor, data))
                self.seen[key] = data
                while len(self.seen) > self.seen_limit:
                    self.seen.popitem(last=False)
                accepted += 1
            self.condition.notify_all()
            return {"accepted": accepted, "duplicates": len(prepared) - accepted, "last_event_id": self.cursor}

    def health(self):
        with self.condition:
            return {"ok": True, "service": "spotlight-local-gateway", "mode": self.mode,
                    "replay_state": self.replay_state, "clients": self.clients,
                    "accepted_events": self.cursor, "buffered_events": len(self.history),
                    "history_limit": self.history.maxlen}

    def stop(self):
        with self.condition:
            self.stopping = True
            self.condition.notify_all()


class SpotlightHandler(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "SpotlightLocal/1.0"

    @property
    def hub(self):
        return self.server.hub

    def _trusted_request(self):
        # Restrict DNS rebinding and browser cross-origin writes to loopback.
        port = self.server.server_address[1]
        allowed = {f"127.0.0.1:{port}", f"localhost:{port}"}
        if self.headers.get("Host", "").lower() not in allowed:
            self._json(403, {"error": "Use this gateway through its loopback URL"})
            return False
        origin = self.headers.get("Origin")
        if origin and origin not in {f"http://{host}" for host in allowed}:
            self._json(403, {"error": "Cross-origin requests are not allowed"})
            return False
        return True

    def _json(self, status, value):
        body = json.dumps(value, allow_nan=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(body)
        self.close_connection = True

    def do_GET(self):
        if not self._trusted_request():
            return
        path = urlsplit(self.path).path
        if path == "/api/health":
            self._json(200, self.hub.health())
        elif path == "/api/events":
            self._events()
        elif path.startswith("/api/"):
            self._json(404, {"error": "Unknown endpoint"})
        else:
            super().do_GET()

    def do_HEAD(self):
        if self._trusted_request():
            super().do_HEAD()

    def do_POST(self):
        if not self._trusted_request():
            return
        if urlsplit(self.path).path != "/api/events":
            self._json(404, {"error": "Unknown endpoint"})
            return
        content_type = self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
        if content_type not in {"application/json", "application/x-ndjson", "application/ndjson"}:
            self._json(415, {"error": "Use application/json or application/x-ndjson"})
            return
        if self.headers.get("Transfer-Encoding"):
            self._json(400, {"error": "Chunked request bodies are not supported"})
            return
        try:
            length = int(self.headers.get("Content-Length", "-1"))
        except ValueError:
            length = -1
        if length < 1:
            self._json(411, {"error": "A positive Content-Length is required"})
            return
        if length > MAX_BODY:
            self._json(413, {"error": "Body exceeds 1 MiB"})
            return
        self.connection.settimeout(10)
        try:
            body = self.rfile.read(length)
            if len(body) != length:
                raise ValidationError("Incomplete request body")
            result = self.hub.publish(parse_events(body, content_type))
        except ValidationError as exc:
            self._json(400, {"error": str(exc)})
        except (TimeoutError, OSError):
            self.close_connection = True
        else:
            self._json(202, result)

    def _events(self):
        supplied = self.headers.get("Last-Event-ID")
        if supplied is None:
            supplied = parse_qs(urlsplit(self.path).query).get("since", [None])[0]
        try:
            cursor = int(supplied) if supplied is not None else None
            if cursor is not None and cursor < 0:
                raise ValueError
        except ValueError:
            self._json(400, {"error": "Last-Event-ID / since must be a nonnegative integer"})
            return
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache, no-transform")
        self.send_header("X-Accel-Buffering", "no")
        self.send_header("Connection", "keep-alive")
        self.end_headers()
        self.connection.settimeout(20)
        hub = self.hub
        with hub.condition:
            hub.clients += 1
            if cursor is None:
                cursor = hub.history[0][0] - 1 if hub.history else hub.cursor
            hub.condition.notify_all()
        try:
            self.wfile.write(b"retry: 2000\n: connected to local gateway\n\n")
            self.wfile.flush()
            while True:
                with hub.condition:
                    if hub.stopping:
                        break
                    oldest = hub.history[0][0] if hub.history else hub.cursor + 1
                    reset = cursor < oldest - 1 or cursor > hub.cursor
                    if reset:
                        cursor = oldest - 1
                    pending = [(seq, data) for seq, data in hub.history if seq > cursor]
                    if not pending and not reset:
                        hub.condition.wait(timeout=15)
                        if hub.stopping:
                            break
                        pending = [(seq, data) for seq, data in hub.history if seq > cursor]
                        # Recheck on the next iteration if a large concurrent batch
                        # displaced the cursor while this connection was waiting.
                        if hub.history and cursor < hub.history[0][0] - 1:
                            continue
                    last = hub.cursor
                if reset:
                    payload = json.dumps({"reason": "history_gap_or_server_restart", "oldest_available_id": oldest, "last_event_id": last})
                    self.wfile.write(f"event: stream-reset\ndata: {payload}\n\n".encode())
                if pending:
                    for seq, data in pending:
                        self.wfile.write(f"id: {seq}\nevent: mission-event\ndata: {data}\n\n".encode("utf-8"))
                        cursor = seq
                else:
                    self.wfile.write(b": heartbeat\n\n")
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, TimeoutError, OSError):
            pass
        finally:
            with hub.condition:
                hub.clients -= 1
            self.close_connection = True

    def log_message(self, format, *args):
        # Log request metadata only; event payloads and credentials are never logged.
        print(f"[{self.log_date_time_string()}] {format % args}", flush=True)


def create_server(directory, port=8765, hub=None):
    server = ThreadingHTTPServer(("127.0.0.1", port), partial(SpotlightHandler, directory=str(Path(directory).resolve())))
    server.daemon_threads = True
    server.hub = hub if hub is not None else EventHub()
    return server


def load_replay(path, mission=None):
    events = []
    with Path(path).open(encoding="utf-8-sig") as source:
        for line_number, line in enumerate(source, 1):
            if not line.strip():
                continue
            try:
                event = parse_events(line.encode("utf-8"), "application/x-ndjson")[0]
            except ValidationError as exc:
                raise ValidationError(f"Replay line {line_number}: {exc}") from exc
            if mission is None or event["mission_id"] == mission:
                events.append(event)
    if not events:
        raise ValidationError("Replay has no matching events")
    return events


def replay_events(hub, events, interval):
    # Wait for the first viewer so the opening events are visible in the demo.
    with hub.condition:
        hub.replay_state = "waiting_for_viewer"
        while not hub.clients and not hub.stopping:
            hub.condition.wait(timeout=1)
        if hub.stopping:
            return
        hub.replay_state = "playing"
    for event in events:
        with hub.condition:
            if hub.stopping:
                return
        hub.publish([event])
        # A fixed interval intentionally compresses source time for presentation.
        deadline = time.monotonic() + interval
        with hub.condition:
            while not hub.stopping and time.monotonic() < deadline:
                hub.condition.wait(timeout=deadline - time.monotonic())
    with hub.condition:
        hub.replay_state = "finished"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--directory", type=Path, default=Path(__file__).parent / "dist")
    parser.add_argument("--replay", type=Path, help="Optional kit replay.ndjson; starts when the first SSE viewer connects")
    parser.add_argument("--mission", help="Only publish this mission from --replay")
    parser.add_argument("--interval", type=float, default=0.5, help="Seconds between replay events (default: 0.5)")
    args = parser.parse_args()
    if not 1 <= args.port <= 65535 or not 0.05 <= args.interval <= 3600:
        parser.error("port must be 1–65535; interval must be 0.05–3600 seconds")
    if not (args.directory / "index.html").is_file():
        parser.error(f"No index.html in {args.directory}")
    if args.mission and not args.replay:
        parser.error("--mission requires --replay")
    try:
        events = load_replay(args.replay, args.mission) if args.replay else None
        hub = EventHub(mode="synthetic-replay" if events else "manual")
        server = create_server(args.directory, args.port, hub)
    except (OSError, ValidationError) as exc:
        parser.error(str(exc))
    if events:
        threading.Thread(target=replay_events, args=(hub, events, args.interval), daemon=True).start()
    print(f"Spotlight: http://127.0.0.1:{args.port}\nLoopback development server; Ctrl+C to stop.", flush=True)
    if events:
        print(f"Synthetic replay: {len(events)} events, {args.interval}s each. Waiting for SSE viewer.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        hub.stop()
        server.server_close()


if __name__ == "__main__":
    main()
