#!/usr/bin/env python3
"""Publish invented, clearly synthetic Spotlight adapter events to loopback.

Start server.py, connect the app's live feed, then run this in another terminal.
The example sends actual readings and flags over HTTP; it is not robot telemetry.
"""
import argparse
from datetime import datetime, timedelta, timezone
import json
import time
from urllib.error import HTTPError, URLError
from urllib.request import ProxyHandler, Request, build_opener
import uuid


def build_demo(mission_id, base_time=None, interval=0.8):
    base_time = base_time or datetime.now(timezone.utc)
    first_action, second_action = f"{mission_id}-A1", f"{mission_id}-A2"
    context = {"action_id": first_action, "asset_id": "DEMO-PUMP-01", "location_id": "DEMO-WP-01"}
    records = [
        ("MISSION_STARTED", {"scenario": "LOCAL_SYNTHETIC", "configuration_version": "ADAPTER_DEMO", "battery_pct": 85}),
        ("ACTION_STARTED", {**context, "action_type": "THERMAL_INSPECTION", "battery_pct": 84}),
        ("READING_CAPTURED", {**context, "reading_id": f"{mission_id}-R1", "measurement_type": "TEMPERATURE", "value": 78.4, "unit": "C", "quality": "GOOD"}),
        ("ANOMALY_DETECTED", {**context, "anomaly_id": f"{mission_id}-N1", "anomaly_type": "TEMPERATURE_ALERT", "severity": "CRITICAL", "operator_review_required": True,
          "description": "Synthetic demonstration flag supplied by the example producer. Review the linked 78.4 C observation; no operating limit or diagnosis is inferred."}),
        ("ACTION_COMPLETED", {"action_id": first_action, "status": "SUCCESS", "failure_type": ""}),
        ("ACTION_STARTED", {"action_id": second_action, "asset_id": "DEMO-VALVE-02", "location_id": "DEMO-WP-02", "action_type": "VISUAL_INSPECTION", "battery_pct": 82}),
        ("ACTION_FAILED", {"action_id": second_action, "status": "FAILED", "failure_type": "SYNTHETIC_OBSTRUCTED_VIEW"}),
        ("MISSION_COMPLETED", {"status": "COMPLETED", "end_battery_pct": 81}),
    ]
    return [{"event_id": f"{mission_id}-E{index + 1}", "mission_id": mission_id,
             "timestamp": (base_time + timedelta(seconds=index * interval)).isoformat(timespec="milliseconds"),
             "event_type": kind, "synthetic": True, "details": details}
            for index, (kind, details) in enumerate(records)]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--interval", type=float, default=0.8)
    parser.add_argument("--dry-run", action="store_true", help="Print NDJSON without sending network requests")
    args = parser.parse_args()
    if not 1 <= args.port <= 65535 or not 0.05 <= args.interval <= 60:
        parser.error("port must be 1–65535; interval must be 0.05–60 seconds")
    mission_id = f"LOCAL-DEMO-{uuid.uuid4().hex[:8]}"
    events = build_demo(mission_id, interval=args.interval)
    if args.dry_run:
        for event in events:
            print(json.dumps(event, ensure_ascii=False, allow_nan=False))
        return
    endpoint = f"http://127.0.0.1:{args.port}/api/events"
    # Loopback must stay loopback even if a shell has an HTTP proxy configured.
    opener = build_opener(ProxyHandler({}))
    print(f"SYNTHETIC adapter demo: {mission_id}\nTarget: {endpoint}", flush=True)
    print("Connect the live feed before sending to watch events arrive. This is invented example data.", flush=True)
    for index, event in enumerate(events):
        body = json.dumps(event, ensure_ascii=False, allow_nan=False).encode("utf-8")
        request = Request(endpoint, data=body, headers={"Content-Type": "application/json"}, method="POST")
        try:
            with opener.open(request, timeout=5) as response:
                result = json.load(response)
        except HTTPError as exc:
            parser.exit(1, f"Gateway rejected event {index + 1}: HTTP {exc.code}. {exc.read(1024).decode('utf-8', errors='replace')}\n")
        except URLError as exc:
            parser.exit(1, f"Cannot reach the local gateway. Start python server.py --port {args.port} first. {exc.reason}\n")
        print(f"{index + 1}/{len(events)} {event['event_type']} | accepted={result.get('accepted', 0)}", flush=True)
        if index < len(events) - 1:
            time.sleep(args.interval)
    print("Done: completed mission, one successful action with a supplied critical flag, one failed action without a reading.", flush=True)


if __name__ == "__main__":
    main()
