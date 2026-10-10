"""Meaningful gateway contract checks; run: python -m unittest discover -s tests -v."""
import http.client
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import threading
import unittest

SPEC = importlib.util.spec_from_file_location("spotlight_server", Path(__file__).resolve().parents[1] / "server.py")
server = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(server)
DEMO_SPEC = importlib.util.spec_from_file_location("spotlight_live_demo", Path(__file__).resolve().parents[1] / "scripts" / "send_live_demo.py")
demo = importlib.util.module_from_spec(DEMO_SPEC)
DEMO_SPEC.loader.exec_module(demo)


def temporary_directory():
    return tempfile.TemporaryDirectory(dir=os.environ.get("SPOTLIGHT_TEST_TMP"))


def event(number=1, **overrides):
    result = {"event_id": f"E{number:05}", "mission_id": "M020", "timestamp": "2026-09-20T18:00:00",
              "event_type": "MISSION_STARTED", "details": {"scenario": "IMPROVED", "configuration_version": "V2", "battery_pct": 82}}
    result.update(overrides)
    return result


def reading(**overrides):
    details = {"action_id": "LOCAL-A1", "reading_id": "LOCAL-R1", "measurement_type": "TEMPERATURE", "value": 78.4, "unit": "C", "quality": "GOOD"}
    details.update(overrides)
    return event(event_type="READING_CAPTURED", details=details)


def anomaly(**overrides):
    details = {"action_id": "LOCAL-A1", "anomaly_id": "LOCAL-N1", "anomaly_type": "EXAMPLE_ALERT", "severity": "CRITICAL", "operator_review_required": True, "description": "Synthetic flag supplied by the local example producer."}
    details.update(overrides)
    return event(2, event_type="ANOMALY_DETECTED", details=details)


class ValidationTests(unittest.TestCase):
    def test_evidence_can_arrive_before_action_without_inventing_location(self):
        hub = server.EventHub()
        result = hub.publish([reading(), anomaly()])
        self.assertEqual(result["accepted"], 2)
        payload = json.loads(hub.history[0][1])
        self.assertEqual(payload["details"]["value"], 78.4)
        self.assertNotIn("location_id", payload["details"])
        self.assertNotIn("status", payload["details"])

    def test_reading_extension_strict_fields(self):
        invalid = [reading(value=True), reading(value="78.4"), reading(value=float("inf")),
                   reading(value=10 ** 400), reading(quality="VERY_CONFIDENT"), reading(quality=[]),
                   reading(unit=""), reading(reading_id="line\nbreak"), reading(extra_threshold=80)]
        missing = reading()
        del missing["details"]["reading_id"]
        invalid.append(missing)
        for candidate in invalid:
            with self.subTest(candidate=candidate), self.assertRaises(server.ValidationError):
                server.validate_event(candidate)
        self.assertEqual(server.validate_event(reading(quality="UNSPECIFIED"))["details"]["quality"], "UNSPECIFIED")

    def test_anomaly_extension_does_not_infer_severity(self):
        invalid = [anomaly(severity="DANGER"), anomaly(severity={}), anomaly(operator_review_required="true"),
                   anomaly(description=""), anomaly(description="x" * 4001), anomaly(anomaly_type=""),
                   anomaly(location_id=None)]
        missing = anomaly()
        del missing["details"]["severity"]
        invalid.append(missing)
        for candidate in invalid:
            with self.subTest(candidate=candidate), self.assertRaises(server.ValidationError):
                server.validate_event(candidate)
        self.assertEqual(server.validate_event(anomaly(severity="LOW"))["details"]["severity"], "LOW")

    def test_synthetic_live_demo_is_valid_and_has_real_payloads(self):
        events = demo.build_demo("LOCAL-DEMO-test")
        self.assertEqual(len(events), 8)
        for candidate in events:
            server.validate_event(candidate)
            self.assertTrue(candidate["synthetic"])
            self.assertEqual(candidate["mission_id"], "LOCAL-DEMO-test")
        captured = [candidate for candidate in events if candidate["event_type"] == "READING_CAPTURED"]
        self.assertEqual(captured[0]["details"]["value"], 78.4)
        self.assertEqual(events[-1]["details"]["status"], "COMPLETED")
        self.assertEqual(sum(candidate["event_type"] == "ACTION_FAILED" for candidate in events), 1)

    def test_json_and_ndjson_and_envelope(self):
        for body, media in [(event(), "application/json"), ([event()], "application/json"), ({"events": [event()]}, "application/json")]:
            self.assertEqual(server.parse_events(json.dumps(body).encode(), media), [event()])
        self.assertEqual(len(server.parse_events((json.dumps(event()) + "\n" + json.dumps(event(2))).encode(), "application/x-ndjson")), 2)

    def test_invalid_values_and_types_rejected(self):
        cases = [event(event_type=[]), event(timestamp="2026-02-30T10:00:00"), event(timestamp="2026-09-20"),
                 event(details=[]), event(details={"battery_pct": 101}), event(details={"battery_pct": True}),
                 event(event_id="bad\nid"), event(event_type="ACTION_STARTED", details={}),
                 event(event_type="ACTION_FAILED", details={"action_id": "A1", "status": []}),
                 event(event_type="ACTION_FAILED", details={"action_id": "A1", "status": "SUCCESS"})]
        for candidate in cases:
            with self.subTest(candidate=candidate), self.assertRaises(server.ValidationError):
                server.parse_events(json.dumps(candidate).encode())
        with self.assertRaises(server.ValidationError):
            server.parse_events(b'{"battery_pct":NaN}')

    def test_failed_mission_terminal_is_valid(self):
        candidate = event(event_type="MISSION_COMPLETED", details={"status": "FAILED", "end_battery_pct": 12})
        self.assertEqual(server.validate_event(candidate)["details"]["status"], "FAILED")

    def test_atomic_batch_and_idempotent_retry(self):
        hub = server.EventHub(history_limit=2)
        self.assertEqual(hub.publish([event()])["accepted"], 1)
        self.assertEqual(hub.publish([event()])["duplicates"], 1)
        conflicting = event(details={"battery_pct": 80})
        with self.assertRaises(server.ValidationError):
            hub.publish([event(2), conflicting])
        self.assertEqual(hub.cursor, 1)
        self.assertEqual(len(hub.history), 1)
        hub.publish([event(2), event(3)])
        self.assertEqual([sequence for sequence, _ in hub.history], [2, 3])

    def test_invalid_batch_does_not_partially_publish(self):
        hub = server.EventHub()
        with self.assertRaises(server.ValidationError):
            hub.publish([event(), event(2, timestamp="invalid")])
        self.assertEqual(hub.cursor, 0)

    def test_bounds(self):
        for body in (b"", b" " * (server.MAX_BODY + 1), json.dumps([event()] * 501).encode(), json.dumps(event(details={"text": "x" * 16385})).encode()):
            with self.assertRaises(server.ValidationError):
                server.parse_events(body)

    def test_load_replay_filters_mission_and_rejects_bad_line(self):
        with temporary_directory() as folder:
            path = Path(folder) / "events.ndjson"
            path.write_text(json.dumps(event()) + "\n" + json.dumps(event(2, mission_id="M021")), encoding="utf-8")
            self.assertEqual(server.load_replay(path, "M020"), [event()])
            with self.assertRaises(server.ValidationError):
                server.load_replay(path, "M099")
            path.write_text("{}", encoding="utf-8")
            with self.assertRaisesRegex(server.ValidationError, "Replay line 1"):
                server.load_replay(path)


class EndpointTests(unittest.TestCase):
    def setUp(self):
        self.temp = temporary_directory()
        Path(self.temp.name, "index.html").write_text("<h1>Spotlight</h1>", encoding="utf-8")
        self.hub = server.EventHub(history_limit=2)
        self.server = server.create_server(self.temp.name, port=0, hub=self.hub)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.port = self.server.server_address[1]

    def tearDown(self):
        self.hub.stop()
        self.server.shutdown()
        self.server.server_close()
        self.temp.cleanup()

    def request(self, method, path, body=None, headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=3)
        connection.request(method, path, body=body, headers=headers or {})
        response = connection.getresponse()
        status, payload = response.status, response.read()
        connection.close()
        return status, payload

    def test_health_and_static_and_post(self):
        status, payload = self.request("GET", "/")
        self.assertEqual(status, 200)
        self.assertIn(b"Spotlight", payload)
        status, payload = self.request("POST", "/api/events", json.dumps([event()]), {"Content-Type": "application/json"})
        self.assertEqual(status, 202)
        self.assertEqual(json.loads(payload)["accepted"], 1)
        status, payload = self.request("GET", "/api/health")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(payload)["accepted_events"], 1)

    def test_evidence_post_is_transported_and_invalid_batch_rejected(self):
        status, payload = self.request("POST", "/api/events", json.dumps([reading(), anomaly()]), {"Content-Type": "application/json"})
        self.assertEqual(status, 202)
        self.assertEqual(json.loads(payload)["accepted"], 2)
        frames = self.read_sse_frames(None, 2)
        self.assertIn('"event_type":"READING_CAPTURED"', frames[0])
        self.assertIn('"value":78.4', frames[0])
        self.assertIn('"severity":"CRITICAL"', frames[1])
        status, payload = self.request("POST", "/api/events", json.dumps([event(3), reading(value="78.4")]), {"Content-Type": "application/json"})
        self.assertEqual(status, 400)
        self.assertEqual(self.hub.cursor, 2)

    def test_rejects_cross_origin_bad_media_and_oversized_body(self):
        self.assertEqual(self.request("GET", "/api/health", headers={"Host": "attacker.example"})[0], 403)
        self.assertEqual(self.request("POST", "/api/events", "{}", {"Content-Type": "application/json", "Origin": "https://other.example"})[0], 403)
        self.assertEqual(self.request("POST", "/api/events", "{}", {"Content-Type": "text/plain"})[0], 415)
        self.assertEqual(self.request("POST", "/api/events", "{}", {"Content-Type": "application/json", "Content-Length": str(server.MAX_BODY + 1)})[0], 413)
        self.assertEqual(self.request("POST", "/api/events", '{"event_type":[]}', {"Content-Type": "application/json"})[0], 400)

    def read_sse_frames(self, cursor, count):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=3)
        headers = {"Last-Event-ID": str(cursor)} if cursor is not None else {}
        connection.request("GET", "/api/events", headers=headers)
        response = connection.getresponse()
        self.assertEqual(response.status, 200)
        frames, current = [], []
        while len(frames) < count:
            line = response.readline().decode().rstrip("\n\r")
            if line:
                current.append(line)
            elif current:
                if any(entry.startswith("event:") for entry in current):
                    frames.append("\n".join(current))
                current = []
        response.close()
        connection.close()
        return frames

    def test_sse_reconnect_resumes_only_after_cursor(self):
        self.hub.publish([event(), event(2)])
        frames = self.read_sse_frames(1, 1)
        self.assertIn("id: 2", frames[0])
        self.assertIn("event: mission-event", frames[0])
        self.assertIn('"event_id":"E00002"', frames[0])
        self.assertNotIn('"event_id":"E00001"', frames[0])

    def test_sse_reports_buffer_gap(self):
        self.hub.publish([event(), event(2), event(3)])
        frames = self.read_sse_frames(0, 3)
        self.assertIn("event: stream-reset", frames[0])
        self.assertIn('"oldest_available_id": 2', frames[0])
        self.assertIn("id: 2", frames[1])
        self.assertIn("id: 3", frames[2])

    def test_sse_reports_restart_cursor(self):
        self.hub.publish([event()])
        frames = self.read_sse_frames(500, 2)
        self.assertIn("event: stream-reset", frames[0])
        self.assertIn("id: 1", frames[1])


if __name__ == "__main__":
    unittest.main()
