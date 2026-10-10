import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createSpotModel, FOOT_CLEARANCE } from './spotModel.js';

// Node can't decode the embedded PNG decals, so the textures are dropped from the GLB's JSON chunk before parsing.
const glb = readFileSync(new URL('../assets/spot-inspection.glb', import.meta.url));
const jsonLength = glb.readUInt32LE(12);
const json = JSON.parse(glb.subarray(20, 20 + jsonLength));
delete json.images; delete json.textures; delete json.samplers;
for (const m of json.materials) {
  for (const k of Object.keys(m)) if (k.endsWith('Texture')) delete m[k];
  if (m.pbrMetallicRoughness) for (const k of Object.keys(m.pbrMetallicRoughness)) if (k.endsWith('Texture')) delete m.pbrMetallicRoughness[k];
}
const text = Buffer.from(JSON.stringify(json));
const padded = Buffer.concat([text, Buffer.alloc((4 - text.length % 4) % 4, 0x20)]);
const chunkHeader = Buffer.alloc(8);
chunkHeader.writeUInt32LE(padded.length, 0);
chunkHeader.write('JSON', 4);
const rest = glb.subarray(20 + jsonLength);
const header = Buffer.from(glb.subarray(0, 12));
header.writeUInt32LE(12 + 8 + padded.length + rest.length, 8);
const file = Buffer.concat([header, chunkHeader, padded, rest]);
const loader = new GLTFLoader();
const load = async () => createSpotModel((await loader.parseAsync(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength), '')).scene);

test('model stays below a 60,000-triangle budget and has four articulated legs', async () => {
  const model = await load();
  let triangles = 0;
  model.root.traverse(node => {
    if (node.isMesh) triangles += (node.geometry.index?.count ?? node.geometry.attributes.position.count) / 3;
  });
  assert.equal(model.legs.length, 4);
  assert.ok(triangles < 60000, `${triangles} triangles exceeds budget`);
  assert.ok(triangles > 1000);
  console.log(`Model: ${triangles.toLocaleString()} triangles`);
  model.dispose();
});

test('standing and sitting feet stay grounded throughout the supported height range', async () => {
  const model = await load();
  for (const stance of ['stand', 'sit']) for (const bodyHeight of [-0.09, 0, 0.02]) {
    model.pose({ stance, bodyHeight });
    model.root.updateMatrixWorld(true);
    for (const { foot } of model.legs) {
      const world = foot.getWorldPosition(new Vector3());
      assert.ok(Math.abs(world.y - FOOT_CLEARANCE) < 0.002, `Foot height: ${world.y}`);
    }
  }
  model.dispose();
});

test('walk lifts feet, changes joints, and stays finite across supported poses', async () => {
  const model = await load();
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

test('sitting down lowers the rear first and keeps the feet near the floor the whole way', async () => {
  const model = await load();
  for (const sit of [0.1, 0.3, 0.5, 0.7, 0.9]) {
    model.pose({ stance: 'sit', sit });
    model.root.updateMatrixWorld(true);
    if (sit < 0.9) assert.ok(model.body.rotation.z > 0, `rear should be lower at sit=${sit}`);
    for (const { foot } of model.legs) {
      const y = foot.getWorldPosition(new Vector3()).y;
      assert.ok(Math.abs(y - FOOT_CLEARANCE) < 0.02, `foot at ${y} mid-sit (${sit})`);
    }
  }
  model.dispose();
});

test('walking forward: feet push backward on the ground and swing forward in the air', async () => {
  const model = await load();
  const foot = model.legs[0].foot;
  const at = t => { model.pose({ stance: 'walk', time: t, moving: true }); model.root.updateMatrixWorld(true); return foot.getWorldPosition(new Vector3()); };
  let ground = 0, air = 0;
  for (let t = 0; t < 1.6; t += 0.02) {
    const a = at(t), b = at(t + 0.01);
    if (Math.max(a.y, b.y) < FOOT_CLEARANCE + 0.0005) { ground++; assert.ok(b.x <= a.x + 1e-6, `grounded foot moved forward at t=${t.toFixed(2)}`); }
    else if (Math.min(a.y, b.y) > FOOT_CLEARANCE + 0.027) { air++; assert.ok(b.x >= a.x - 1e-6, `airborne foot moved backward at t=${t.toFixed(2)}`); }
  }
  assert.ok(ground > 5 && air > 5);
  model.dispose();
});
