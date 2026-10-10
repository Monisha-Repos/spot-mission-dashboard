import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { JSDOM, VirtualConsole } from "jsdom";

// Exercise React events in a DOM; geometry is checked separately in spotModel.test.js.
// This is not a screenshot, layout, or GPU test.
test("dashboard connects map findings, floor navigation, reviews, replay, search and live evidence", async (t) => {
  const data = await readFile(
    new URL("../public/data/mission-data.json", import.meta.url),
    "utf8",
  );
  const demo = await readFile(
    new URL("../public/data/live-demo.ndjson", import.meta.url),
    "utf8",
  );
  const result = await build({
    entryPoints: [
      new URL("../src/main.jsx", import.meta.url).pathname.replace(
        /^\/([A-Z]:)/i,
        "$1",
      ),
    ],
    bundle: true,
    write: false,
    format: "iife",
    loader: { ".css": "empty" },
    define: {
      "import.meta.env.BASE_URL": '"/"',
      "process.env.NODE_ENV": '"development"',
    },
    plugins: [
      {
        name: "test-viewer",
        setup(b) {
          b.onLoad({ filter: /SpotViewer\.jsx$/ }, () => ({
            contents:
              'import React from "react"; export default React.forwardRef(function Viewer(){return <div data-testid="model-viewer">Model test placeholder</div>})',
            loader: "jsx",
            resolveDir: new URL("../src", import.meta.url).pathname.replace(
              /^\/([A-Z]:)/i,
              "$1",
            ),
          }));
        },
      },
    ],
  });
  const errors = [],
    console = new VirtualConsole();
  console.on("jsdomError", (e) => errors.push(e.message));
  console.on("error", (...e) => errors.push(e.join(" ")));
  const dom = new JSDOM('<!doctype html><div id="root"></div>', {
    url: "http://localhost/",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole: console,
  });
  const w = dom.window,
    d = w.document;
  w.scrollTo = () => {};
  w.fetch = async (url) => ({
    ok: true,
    json: async () => JSON.parse(data),
    text: async () => (String(url).includes("live-demo") ? demo : data),
  });
  w.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  w.HTMLDialogElement.prototype.close = function () {
    this.open = false;
    this.dispatchEvent(new w.Event("close"));
  };
  const nativeInterval = w.setInterval.bind(w);
  w.setInterval = (fn, ms) => nativeInterval(fn, ms === 850 ? 5 : ms);
  const until = async (fn) => {
    for (let i = 0; i < 150; i++) {
      if (fn()) return;
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.fail("DOM condition did not settle");
  };
  const button = (text) =>
    Array.from(d.querySelectorAll("button")).find(
      (b) => b.textContent.trim() === text,
    );
  const click = async (b) => {
    assert.ok(b, "Expected button exists");
    b.click();
    await new Promise((r) => setTimeout(r, 20));
  };
  const setInput = async (el, value) => {
    Object.getOwnPropertyDescriptor(
      w.HTMLInputElement.prototype,
      "value",
    ).set.call(el, value);
    el.dispatchEvent(new w.Event("input", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 20));
  };
  try {
    w.eval(result.outputFiles[0].text);
    await until(
      () =>
        d.querySelector(".map-stage") &&
        d.querySelector('[data-testid="model-viewer"]'),
    );
    await t.test("mission battery displays recorded proportional fill", () => {
      const gauge = d.querySelector(".mission-facts .battery-gauge");
      const percent = Number(gauge.getAttribute("aria-valuenow"));
      assert.ok(percent > 0 && percent <= 100);
      assert.equal(
        gauge.querySelector(".battery-fill").style.width,
        `${percent}%`,
      );
      assert.ok(d.querySelector('[data-testid="model-viewer"]'));
    });
    await t.test(
      "critical waypoint opens actual finding and source evidence",
      async () => {
        await click(d.querySelector('button[aria-label^="WP07,"]'));
        assert.match(
          d.querySelector(".waypoint-inspector").textContent,
          /WP07/,
        );
        assert.ok(d.querySelector(".waypoint-inspector .badge.danger"));
        await click(d.querySelector(".map-finding"));
        assert.ok(d.querySelector("dialog").open);
        assert.match(d.querySelector("dialog").textContent, /AN014/);
        assert.match(d.querySelector("dialog").textContent, /Your next step/);
        await click(d.querySelector('[aria-label="Close dialog"]'));
        assert.equal(d.querySelector("dialog"), null);
      },
    );
    await t.test(
      "floor change resets location focus and replaces animated scene",
      async () => {
        const previous = d.querySelector(".floor-scene");
        await click(button("Floor 02"));
        assert.equal(d.querySelector(".waypoint-inspector"), null);
        assert.notEqual(d.querySelector(".floor-scene"), previous);
        assert.ok(d.querySelector(".floor-scene.enter-up"));
        const ids = Array.from(d.querySelectorAll(".waypoint")).map(
          (b) => b.getAttribute("aria-label").split(",")[0],
        );
        assert.deepEqual(
          ids,
          JSON.parse(data)
            .locations.filter((l) => l.floor === 2)
            .map((l) => l.location_id),
        );
        await click(button("Floor 01"));
        assert.ok(d.querySelector(".floor-scene.enter-down"));
      },
    );
    await t.test(
      "operator review persists without clearing source finding",
      async () => {
        await click(d.querySelector(".finding-card"));
        await click(d.querySelector('dialog input[type="checkbox"]'));
        await click(button("Save review"));
        assert.equal(d.querySelector("dialog"), null);
        assert.ok(
          Object.values(
            JSON.parse(w.localStorage.getItem("spotlight-reviews-v1")),
          ).some((r) => r.ack),
        );
        assert.ok(d.querySelector(".finding-card"));
      },
    );
    await t.test(
      "replay starts without future findings and steps forward",
      async () => {
        await click(button("Mission replay"));
        assert.equal(d.querySelectorAll(".finding-card").length, 0);
        assert.match(
          d.querySelector(".operator-brief").textContent,
          /Waiting for the first action/,
        );
        await click(button("Step →"));
        assert.equal(d.querySelector("#replay-timeline").value, "1");
      },
    );
    await t.test("command menu finds archived asset evidence", async () => {
      w.dispatchEvent(
        new w.KeyboardEvent("keydown", {
          key: "k",
          ctrlKey: true,
          bubbles: true,
        }),
      );
      await until(() => d.querySelector(".command-palette"));
      await setInput(d.querySelector(".command-input input"), "WP07");
      assert.match(
        d.querySelector(".command-results").textContent,
        /ARCHIVED INSPECTION EVIDENCE/,
      );
      const record = Array.from(
        d.querySelectorAll(".command-results button"),
      ).find((b) => b.textContent.includes("WP07"));
      await click(record);
      assert.ok(d.querySelector(".evidence-drawer").open);
      assert.equal(d.querySelector(".command-palette"), null);
      await click(d.querySelector('[aria-label="Close dialog"]'));
    });
    await t.test(
      "synthetic live events produce separate actionable evidence",
      async () => {
        await click(button("Live monitor"));
        await click(button("Run synthetic demo"));
        await until(() =>
          d.querySelector(".stream-status").textContent.includes("finished"),
        );
        assert.match(
          d.querySelector(".stream-status").textContent,
          /8 events received/,
        );
        assert.equal(d.querySelectorAll(".live-mission").length, 1);
        await click(d.querySelector(".live-findings .finding-card"));
        assert.match(d.querySelector("dialog").textContent, /RECEIVED EVENTS/);
        assert.equal(d.querySelector("dialog textarea"), null);
        await click(d.querySelector('[aria-label="Close dialog"]'));
      },
    );
    await t.test("robot explorer retains cosmetic pose controls", async () => {
      await click(button("Robot explorer"));
      await click(button("walk"));
      assert.equal(button("walk").getAttribute("aria-pressed"), "true");
      await click(button("Pause"));
      assert.ok(button("Resume"));
      assert.ok(d.querySelector('[data-testid="model-viewer"]'));
    });
    assert.deepEqual(errors, [], "No React or DOM runtime errors");
  } finally {
    dom.window.close();
  }
});
