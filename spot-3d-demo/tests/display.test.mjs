import test from "node:test";
import assert from "node:assert/strict";
import { batteryState, waypointFindings } from "../src/lib/display.js";

test("battery retains proportional fill and requested color boundaries", () => {
  for (const [percent, tone] of [
    [100, "full"],
    [61, "full"],
    [60, "medium"],
    [50, "medium"],
    [31, "medium"],
    [30, "low"],
    [0, "low"],
  ]) {
    assert.deepEqual(batteryState(percent), { percent, tone });
  }
});
test("battery never invents a percentage for missing or invalid telemetry", () => {
  for (const value of [null, undefined, NaN, Infinity, "50"])
    assert.deepEqual(batteryState(value), { percent: null, tone: "unknown" });
  assert.equal(batteryState(150).percent, 100);
  assert.equal(batteryState(-20).percent, 0);
});
test("map details stay at selected location and surface highest severity first without mutating input", () => {
  const actions = [
    {
      action_id: "a",
      location_id: "WP01",
      classification: { rank: 1 },
      timestamp: "2026-10-10T10:00:00",
    },
    {
      action_id: "b",
      location_id: "WP02",
      classification: { rank: 4 },
      timestamp: "2026-10-10T11:00:00",
    },
    {
      action_id: "c",
      location_id: "WP01",
      classification: { rank: 3 },
      timestamp: "2026-10-10T09:00:00",
    },
  ];
  assert.deepEqual(
    waypointFindings(actions, "WP01").map((a) => a.action_id),
    ["c", "a"],
  );
  assert.deepEqual(
    actions.map((a) => a.action_id),
    ["a", "b", "c"],
  );
  assert.deepEqual(waypointFindings(actions, "WP99"), []);
});
