import * as THREE from 'three';

// Original, stylized geometry inspired by Spot. No downloaded meshes or textures.
// Units: meters. +X is forward, +Y is up, +Z is the robot's left.
export function createSpotModel() {
  const root = new THREE.Group();
  root.name = 'Spot';
  const body = new THREE.Group();
  body.name = 'body';
  root.add(body);
  const geometries = new Set();
  const materials = {};
  const material = (name, color, roughness = 0.65, metalness = 0.05) => {
    materials[name] = new THREE.MeshStandardMaterial({ color, roughness, metalness });
    return materials[name];
  };
  material('yellow', '#efbd28', 0.42, 0.18);
  material('edge', '#dba91b', 0.5, 0.15);
  material('dark', '#252a2b', 0.65, 0.15);
  material('rubber', '#15191a', 0.95);
  material('silver', '#909994', 0.4, 0.65);
  material('lens', '#152f3a', 0.18, 0.45);
  material('glass', '#456f7e', 0.2, 0.3);
  material('led', '#99d8b1');
  materials.led.emissive.set('#397852');

  const box = new THREE.BoxGeometry(1, 1, 1);
  const cylinder = new THREE.CylinderGeometry(1, 1, 1, 12);
  const sphere = new THREE.SphereGeometry(1, 12, 8);
  [box, cylinder, sphere].forEach(g => geometries.add(g));
  function mesh(parent, geometry, mat, position, scale, name = '') {
    const m = new THREE.Mesh(geometry, materials[mat]);
    m.position.set(...position);
    m.scale.set(...scale);
    m.name = name;
    parent.add(m);
    return m;
  }
  function block(parent, mat, position, scale, name) {
    return mesh(parent, box, mat, position, scale, name);
  }
  function axle(parent, mat, position, radius, depth, axis = 'z') {
    const m = mesh(parent, cylinder, mat, position, [radius, depth, radius]);
    if (axis === 'z') m.rotation.x = Math.PI / 2;
    if (axis === 'x') m.rotation.z = Math.PI / 2;
    return m;
  }
  // Beveled panel: one small extrusion shared by the shell and yellow limb covers.
  const shape = new THREE.Shape();
  shape.moveTo(-0.45, -0.5);
  shape.lineTo(0.45, -0.5);
  shape.lineTo(0.5, -0.28);
  shape.lineTo(0.5, 0.28);
  shape.lineTo(0.43, 0.5);
  shape.lineTo(-0.43, 0.5);
  shape.lineTo(-0.5, 0.28);
  shape.lineTo(-0.5, -0.28);
  shape.closePath();
  const panel = new THREE.ExtrudeGeometry(shape, { depth: 0.94, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.025, bevelSegments: 1, steps: 1 });
  panel.translate(0, 0, -0.47);
  geometries.add(panel);

  mesh(body, panel, 'yellow', [0, 0.015, 0], [0.98, 0.21, 0.34], 'main-shell');
  mesh(body, panel, 'dark', [0, -0.072, 0], [0.94, 0.105, 0.29], 'underbody');
  mesh(body, panel, 'dark', [-0.02, 0.127, 0], [0.69, 0.035, 0.285], 'top-deck');
  block(body, 'yellow', [-0.06, 0.15, 0], [0.44, 0.022, 0.22], 'battery-cover');
  // Payload rails and small fasteners.
  for (const z of [-0.115, 0.115]) {
    block(body, 'silver', [-0.03, 0.165, z], [0.56, 0.014, 0.017]);
    for (const x of [-0.27, -0.08, 0.15]) axle(body, 'dark', [x, 0.175, z], 0.009, 0.004, 'y');
  }
  for (const side of [-1, 1]) {
    block(body, 'dark', [0.015, 0.037, side * 0.177], [0.32, 0.038, 0.009]);
    // Side stereo sensor pod.
    mesh(body, panel, 'dark', [0.02, -0.013, side * 0.19], [0.16, 0.066, 0.029]);
    for (const x of [-0.035, 0.065]) {
      axle(body, 'silver', [x, -0.01, side * 0.209], 0.022, 0.008);
      axle(body, 'lens', [x, -0.01, side * 0.215], 0.016, 0.009);
    }
    for (let i = 0; i < 5; i++) block(body, 'dark', [-0.20 + i * 0.024, 0.077, side * 0.177], [0.009, 0.026, 0.008]);
  }
  // Flat black face and stereo lenses are Spot's most recognizable detail.
  mesh(body, panel, 'dark', [0.506, 0.01, 0], [0.046, 0.157, 0.294], 'front-sensor-panel');
  for (const z of [-0.098, 0.098]) {
    axle(body, 'rubber', [0.538, 0.035, z], 0.043, 0.024, 'x');
    axle(body, 'silver', [0.552, 0.035, z], 0.032, 0.006, 'x');
    axle(body, 'lens', [0.557, 0.035, z], 0.026, 0.007, 'x');
    axle(body, 'glass', [0.562, 0.044, z - 0.007], 0.009, 0.002, 'x');
  }
  block(body, 'rubber', [0.534, -0.033, 0], [0.02, 0.035, 0.075]);
  axle(body, 'lens', [0.548, -0.032, 0], 0.012, 0.01, 'x');
  mesh(body, panel, 'dark', [-0.498, 0, 0], [0.026, 0.133, 0.274], 'rear-panel');
  block(body, 'led', [-0.516, 0.029, 0.084], [0.009, 0.014, 0.037]);
  for (const z of [-0.05, 0.025]) axle(body, 'lens', [-0.52, 0.015, z], 0.02, 0.008, 'x');

  const legs = [];
  for (const front of [true, false]) for (const side of [-1, 1]) {
    const leg = new THREE.Group();
    leg.name = `${front ? 'front' : 'rear'}-${side > 0 ? 'left' : 'right'}`;
    leg.position.set(front ? 0.355 : -0.355, -0.047, side * 0.211);
    body.add(leg);
    axle(leg, 'dark', [0, 0, 0], 0.085, 0.12);
    axle(leg, 'yellow', [0, 0, side * 0.065], 0.071, 0.024);
    axle(leg, 'edge', [0, 0, side * 0.081], 0.037, 0.011);
    const upper = new THREE.Group();
    upper.name = `${leg.name}-hip`;
    upper.position.z = side * 0.067;
    leg.add(upper);
    mesh(upper, panel, 'yellow', [0, -0.145, 0], [0.105, 0.31, 0.059]);
    block(upper, 'dark', [-0.044, -0.155, -side * 0.026], [0.023, 0.245, 0.036]);
    const knee = new THREE.Group();
    knee.name = `${leg.name}-knee`;
    knee.position.y = -0.32;
    upper.add(knee);
    axle(knee, 'dark', [0, 0, 0], 0.052, 0.08);
    axle(knee, 'silver', [0, 0, side * 0.045], 0.022, 0.012);
    mesh(knee, panel, 'dark', [0, -0.147, 0], [0.047, 0.30, 0.037]);
    block(knee, 'silver', [0.009, -0.128, side * 0.021], [0.013, 0.19, 0.005]);
    const foot = mesh(knee, sphere, 'rubber', [0, -0.32, 0], [0.038, 0.032, 0.035], `${leg.name}-foot`);
    legs.push({ hip: leg, upper, knee, foot, front, side });
  }

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function pose({ stance = 'stand', time = 0, speed = 1, bodyHeight = 0, moving = false } = {}) {
    const sitting = stance === 'sit';
    const walking = stance === 'walk';
    body.position.y = (sitting ? 0.33 : 0.67) + bodyHeight;
    body.rotation.z = 0;
    body.rotation.x = 0;
    for (const l of legs) {
      const phase = time * speed * 4 + ((l.front === (l.side > 0)) ? 0 : Math.PI);
      const stride = walking && moving ? Math.cos(phase) * 0.105 : 0;
      const lift = walking && moving ? Math.max(0, Math.sin(phase)) * 0.075 : 0;
      // Solve a two-link leg in the sagittal plane, keeping standing feet on the floor.
      const dx = (sitting ? -0.04 : -0.015) + stride;
      const dy = -body.position.y + 0.08 + lift;
      const distance = clamp(Math.hypot(dx, dy), 0.06, 0.639);
      const bend = Math.acos(clamp((2 * 0.32 ** 2 - distance ** 2) / (2 * 0.32 ** 2), -1, 1));
      l.upper.rotation.z = Math.atan2(dx, -dy) + (Math.PI - bend) / 2;
      l.knee.rotation.z = -(Math.PI - bend);
    }
  }
  pose();
  function setWireframe(value) {
    Object.values(materials).forEach(m => { m.wireframe = value; });
  }
  function dispose() {
    geometries.forEach(g => g.dispose());
    Object.values(materials).forEach(m => m.dispose());
  }
  let triangleCount = 0;
  root.traverse(node => {
    if (node.isMesh) triangleCount += (node.geometry.index?.count ?? node.geometry.attributes.position.count) / 3;
  });
  return { root, body, legs, pose, setWireframe, dispose, triangleCount };
}
