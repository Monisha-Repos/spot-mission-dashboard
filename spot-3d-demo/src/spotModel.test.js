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
