import * as THREE from 'three';

// Wraps the Spot CAM+IR mesh from assets/spot-inspection.glb (loaded by the caller) and makes its legs posable.
// Units: meters. +X is forward, +Y is up, +Z is the robot's left.
// The file has one rigid node per leg, so each leg is split at the knee here. Points are in the leg's own frame
// (hip at the origin), measured from the file: the knee joint cap and the centre of the rubber foot.
const KNEE = new THREE.Vector2(-0.208, -0.275);
const FOOT = new THREE.Vector2(0.01, -0.622);
/** Height of the foot centre above the floor when the sole is touching it. */
export const FOOT_CLEARANCE = 0.027;
const HIP_X = 0.397;          // hips sit ±HIP_X along the body
const HIP_Y = 0.676 - 0.026;  // hip height in the file (leg node + scene offset), i.e. standing height
const STAND = 0.65, SIT = 0.33;
const LEGS = { Front_left_leg: [true, 1], Front_right_leg: [true, -1], Rear_left_leg: [false, 1], Rear_right_leg: [false, -1] };

const L1 = KNEE.length();
const L2 = FOOT.clone().sub(KNEE).length();
const REST_UPPER = Math.atan2(KNEE.y, KNEE.x);
const REST_LOWER = Math.atan2(FOOT.y - KNEE.y, FOOT.x - KNEE.x);

const tmpA = new THREE.Vector2(), tmpB = new THREE.Vector2();
function segmentDistance(p, a, b) {
  const ab = tmpA.copy(b).sub(a);
  const t = Math.max(0, Math.min(1, tmpB.copy(p).sub(a).dot(ab) / ab.lengthSq()));
  return p.distanceTo(tmpB.copy(a).addScaledVector(ab, t));
}

/** Moves a leg's meshes under `upper` (hip to knee) and `knee` (knee to foot), splitting any mesh that spans both. */
function splitLeg(leg, upper, knee) {
  const origin = new THREE.Vector2();
  const isLower = p => segmentDistance(p, KNEE, FOOT) < segmentDistance(p, origin, KNEE);
  for (const mesh of [...leg.children]) {
    if (!mesh.isMesh) continue;
    mesh.updateMatrix();
    const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrix);
    mesh.geometry.dispose();
    const pos = geometry.attributes.position;
    const index = geometry.index ? Array.from(geometry.index.array) : [...Array(pos.count).keys()];
    const parts = { upper: [], lower: [] };
    const c = new THREE.Vector2();
    for (let i = 0; i < index.length; i += 3) {
      c.set(0, 0);
      for (let k = 0; k < 3; k++) c.x += pos.getX(index[i + k]) / 3, c.y += pos.getY(index[i + k]) / 3;
      parts[isLower(c) ? 'lower' : 'upper'].push(index[i], index[i + 1], index[i + 2]);
    }
    // Small stray bits (a cover lip near the knee) follow the rest of their mesh rather than tearing it.
    const share = parts.lower.length / index.length;
    if (share < 0.15) parts.upper = index, parts.lower = [];
    else if (share > 0.85) parts.lower = index, parts.upper = [];
    for (const [side, ids] of Object.entries(parts)) {
      if (!ids.length) continue;
      const g = geometry.clone();
      g.setIndex(ids);
      if (side === 'lower') g.translate(-KNEE.x, -KNEE.y, 0);
      const m = new THREE.Mesh(g, mesh.material);
      m.name = mesh.name;
      (side === 'lower' ? knee : upper).add(m);
    }
    geometry.dispose();
    mesh.removeFromParent();
  }
}

/** `scene` is the loaded glTF scene; it becomes part of the returned model. */
export function createSpotModel(scene) {
  const root = new THREE.Group();
  root.name = 'Spot';
  const body = new THREE.Group();
  body.name = 'body';
  root.add(body);
  // Hips end up at the body origin, so the body's height is the hip height.
  scene.position.y = -HIP_Y;
  body.add(scene);

  const legs = [];
  for (const [name, [front, side]] of Object.entries(LEGS)) {
    const hip = scene.getObjectByName(name);
    const upper = new THREE.Group();
    upper.name = `${name}-hip`;
    const knee = new THREE.Group();
    knee.name = `${name}-knee`;
    knee.position.set(KNEE.x, KNEE.y, 0);
    splitLeg(hip, upper, knee);
    const foot = new THREE.Object3D();
    foot.name = `${name}-foot`;
    foot.position.set(FOOT.x - KNEE.x, FOOT.y - KNEE.y, 0);
    knee.add(foot);
    upper.add(knee);
    hip.add(upper);
    legs.push({ hip, upper, knee, foot, front, side });
  }

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const ease = t => t * t * (3 - 2 * t);
  const lerp = (a, b, t) => a + (b - a) * t;
  /**
   * sit: 0 = standing, 1 = sitting; values in between are the sit-down / stand-up motion.
   * Defaults to the stance, so pose({ stance: 'sit' }) still gives the final sitting pose.
   */
  function pose({ stance = 'stand', time = 0, speed = 1, bodyHeight = 0, moving = false, sit, gait } = {}) {
    // gait: stride size from 0 (stopped) to 1 (full); defaults to full while walking.
    const stepSize = clamp(gait ?? (stance === 'walk' && moving ? 1 : 0), 0, 1);
    const s = clamp(sit ?? (stance === 'sit' ? 1 : 0), 0, 1);
    // Like the real robot, the rear goes down first and comes up last; the front follows.
    const legSit = { rear: ease(clamp(s / 0.65, 0, 1)), front: ease(clamp((s - 0.35) / 0.65, 0, 1)) };
    const height = { rear: lerp(STAND, SIT, legSit.rear) + bodyHeight, front: lerp(STAND, SIT, legSit.front) + bodyHeight };
    const pitch = Math.asin(clamp((height.front - height.rear) / (2 * HIP_X), -1, 1));
    body.position.y = (height.front + height.rear) / 2;
    body.rotation.z = pitch;
    const cos = Math.cos(pitch), sin = Math.sin(pitch);
    for (const l of legs) {
      const end = l.front ? 'front' : 'rear';
      const phase = time * speed * 4 + ((l.front === (l.side > 0)) ? 0 : Math.PI);
      const stride = Math.cos(phase) * 0.105 * stepSize;
      // Lift while the foot swings forward (cos rising); on the ground it pushes back, so Spot walks toward +X.
      const lift = Math.max(0, -Math.sin(phase)) * 0.075 * stepSize;
      // Foot target from the hip in world axes, keeping standing feet on the floor, then turned into the pitched body frame.
      const wx = FOOT.x + lerp(0, -0.03, legSit[end]) + stride;
      const wy = -height[end] + FOOT_CLEARANCE + lift;
      const x = wx * cos + wy * sin, y = -wx * sin + wy * cos;
      // Two-link leg; the knee bends backward (toward -X), like the real robot.
      const d = clamp(Math.hypot(x, y), Math.abs(L1 - L2) + 1e-3, L1 + L2 - 1e-4);
      const thigh = Math.atan2(y, x) - Math.acos(clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1));
      const shin = Math.atan2(y - L1 * Math.sin(thigh), x - L1 * Math.cos(thigh));
      l.upper.rotation.z = thigh - REST_UPPER;
      l.knee.rotation.z = (shin - thigh) - (REST_LOWER - REST_UPPER);
    }
  }
  pose();

  const materials = new Set();
  let triangleCount = 0;
  root.traverse(node => {
    if (!node.isMesh) return;
    triangleCount += (node.geometry.index?.count ?? node.geometry.attributes.position.count) / 3;
    [node.material].flat().forEach(m => materials.add(m));
  });
  function setWireframe(value) {
    materials.forEach(m => { m.wireframe = value; });
  }
  function dispose() {
    root.traverse(node => node.geometry?.dispose());
    materials.forEach(m => {
      Object.values(m).forEach(v => { if (v?.isTexture) v.dispose(); });
      m.dispose();
    });
  }
  return { root, body, legs, pose, setWireframe, dispose, triangleCount };
}
