import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { createSpotModel } from './spotModel.js';

test('model stays below a 15,000-triangle budget and has four articulated legs', () => {
  const model = createSpotModel();
  let triangles = 0;
  model.root.traverse(node => {
    if (node.isMesh) triangles += (node.geometry.index?.count ?? node.geometry.attributes.position.count) / 3;
  });
  assert.equal(model.legs.length, 4);
  assert.ok(triangles < 15000, `${triangles} triangles exceeds budget`);
  assert.ok(triangles > 1000);
  console.log(`Model: ${triangles.toLocaleString()} triangles`);
  model.dispose();
});

test('standing and sitting feet stay grounded throughout the supported height range', () => {
  const model = createSpotModel();
  for (const stance of ['stand', 'sit']) for (const bodyHeight of [-0.09, 0, 0.02]) {
    model.pose({ stance, bodyHeight });
    model.root.updateMatrixWorld(true);
    for (const { foot } of model.legs) {
      const world = foot.getWorldPosition(new Vector3());
      assert.ok(Math.abs(world.y - 0.033) < 0.002, `Foot height: ${world.y}`);
    }
  }
  model.dispose();
});

test('walk lifts feet, changes joints, and stays finite across supported poses', () => {
  const model = createSpotModel();
  model.pose({ stance: 'walk', time: 0, moving: true });
  const original = model.legs[0].upper.rotation.z;
  model.pose({ stance: 'walk', time: 0.4, moving: true });
  assert.notEqual(model.legs[0].upper.rotation.z, original);
  for (const stance of ['stand', 'sit', 'walk']) for (const bodyHeight of [-0.09, 0.02]) {
    model.pose({ stance, bodyHeight, time: 0.4, moving: true });
    model.root.updateMatrixWorld(true);
    model.root.traverse(n => assert.ok(n.matrixWorld.elements.every(Number.isFinite)));
  }
  model.dispose();
});

test('sitting down lowers the rear first and keeps the feet near the floor the whole way', () => {
  const model = createSpotModel();
  for (const sit of [0.1, 0.3, 0.5, 0.7, 0.9]) {
    model.pose({ stance: 'sit', sit });
    model.root.updateMatrixWorld(true);
    if (sit < 0.9) assert.ok(model.body.rotation.z > 0, `rear should be lower at sit=${sit}`);
    for (const { foot } of model.legs) {
      const y = foot.getWorldPosition(new Vector3()).y;
      assert.ok(Math.abs(y - 0.033) < 0.02, `foot at ${y} mid-sit (${sit})`);
    }
  }
  model.dispose();
});

test('walking forward: feet push backward on the ground and swing forward in the air', () => {
  const model = createSpotModel();
  const foot = model.legs[0].foot;
  const at = t => { model.pose({ stance: 'walk', time: t, moving: true }); model.root.updateMatrixWorld(true); return foot.getWorldPosition(new Vector3()); };
  let ground = 0, air = 0;
  for (let t = 0; t < 1.6; t += 0.02) {
    const a = at(t), b = at(t + 0.01);
    if (Math.max(a.y, b.y) < 0.0335) { ground++; assert.ok(b.x <= a.x + 1e-6, `grounded foot moved forward at t=${t.toFixed(2)}`); }
    else if (Math.min(a.y, b.y) > 0.06) { air++; assert.ok(b.x >= a.x - 1e-6, `airborne foot moved backward at t=${t.toFixed(2)}`); }
  }
  assert.ok(ground > 5 && air > 5);
  model.dispose();
});
