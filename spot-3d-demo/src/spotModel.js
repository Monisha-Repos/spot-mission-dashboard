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
  // Matte finish like the real robot: yellow shells, black actuators and payload rail, no shiny trim.
  material('yellow', '#f4c20d', 0.58, 0);
  material('dark', '#1d2022', 0.7, 0.05);
  material('mesh', '#34383b', 0.85, 0.05);
  material('rubber', '#121416', 0.95);
  material('lens', '#0e1a20', 0.15, 0.5);
  material('glass', '#2c4a56', 0.2, 0.3);
  material('led', '#99d8b1');
  materials.led.emissive.set('#397852');
  material('ledWhite', '#ffffff');
  materials.ledWhite.emissive.set('#f2f6ff');
  material('ledAmber', '#ffb347');
  materials.ledAmber.emissive.set('#ff7a00');

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
  // Top: black payload deck with two low mounting rails.
  mesh(body, panel, 'dark', [-0.02, 0.127, 0], [0.69, 0.035, 0.285], 'top-deck');
  for (const z of [-0.1, 0.1]) block(body, 'dark', [-0.03, 0.152, z], [0.62, 0.012, 0.022]);
  for (const side of [-1, 1]) {
    // Side stereo camera: a small black window toward the rear, and a black vent strip along the lower edge.
    mesh(body, panel, 'dark', [-0.2, 0.03, side * 0.168], [0.17, 0.05, 0.03], 'side-camera-window');
    for (const x of [-0.255, -0.222]) axle(body, 'lens', [x, 0.03, side * 0.184], 0.009, 0.004);
    block(body, 'glass', [-0.16, 0.03, side * 0.184], [0.05, 0.016, 0.003]);
    block(body, 'mesh', [0.1, -0.03, side * 0.171], [0.46, 0.018, 0.006], 'side-vent');
    // Heat-sink fins on the black belly.
    for (let i = 0; i < 9; i++) block(body, 'mesh', [-0.3 + i * 0.07, -0.095, side * 0.136], [0.012, 0.03, 0.006]);
  }
  // Front: yellow bezel around a recessed black face with a centre mesh grille and a camera column either side,
  // thin light strips on the bezel and an amber light underneath.
  block(body, 'dark', [0.512, 0.012, 0], [0.012, 0.118, 0.218], 'front-face');
  block(body, 'mesh', [0.519, 0.008, 0], [0.003, 0.092, 0.05], 'front-grille');
  for (let i = 0; i < 9; i++) block(body, 'dark', [0.521, -0.03 + i * 0.0095, 0], [0.002, 0.0025, 0.05]);
  axle(body, 'lens', [0.52, 0.035, -0.06], 0.016, 0.006, 'x');
  for (const y of [0.005, -0.03]) block(body, 'glass', [0.52, y, -0.06], [0.003, 0.02, 0.026]);
  for (const y of [0.04, 0.016, -0.008]) axle(body, 'lens', [0.52, y, 0.06], 0.009, 0.006, 'x');
  block(body, 'glass', [0.52, -0.036, 0.06], [0.003, 0.018, 0.026]);
  for (const z of [-0.128, 0.128]) block(body, 'ledWhite', [0.515, 0.012, z], [0.004, 0.072, 0.005], 'light-strip');
  block(body, 'ledAmber', [0.49, -0.088, 0], [0.012, 0.012, 0.07], 'status-light');
  // Rear: plain panel with a status light (no camera "eyes", so the back doesn't read as a face).
  mesh(body, panel, 'dark', [-0.498, 0, 0], [0.026, 0.133, 0.274], 'rear-panel');
  block(body, 'led', [-0.516, 0.029, 0.084], [0.009, 0.014, 0.037]);

  const legs = [];
  for (const front of [true, false]) for (const side of [-1, 1]) {
    const leg = new THREE.Group();
    leg.name = `${front ? 'front' : 'rear'}-${side > 0 ? 'left' : 'right'}`;
    leg.position.set(front ? 0.355 : -0.355, -0.047, side * 0.211);
    body.add(leg);
    // Black hip actuator under a chunky yellow thigh cover.
    axle(leg, 'dark', [0, 0, 0], 0.085, 0.12);
    axle(leg, 'mesh', [0, 0, side * 0.064], 0.06, 0.012);
    const upper = new THREE.Group();
    upper.name = `${leg.name}-hip`;
    upper.position.z = side * 0.067;
    leg.add(upper);
    mesh(upper, panel, 'yellow', [0, -0.14, 0], [0.12, 0.33, 0.072]);
    block(upper, 'dark', [-0.05, -0.16, -side * 0.028], [0.022, 0.24, 0.036]);
    const knee = new THREE.Group();
    knee.name = `${leg.name}-knee`;
    knee.position.y = -0.32;
    upper.add(knee);
    // Slim black lower leg that forks near the foot, ending in a rubber foot.
    axle(knee, 'dark', [0, 0, 0], 0.05, 0.08);
    mesh(knee, panel, 'dark', [0, -0.13, 0], [0.04, 0.27, 0.034]);
    const fork = block(knee, 'dark', [0.014, -0.262, 0], [0.008, 0.085, 0.026]);
    fork.rotation.z = -0.28;
    const foot = mesh(knee, sphere, 'rubber', [0, -0.32, 0], [0.042, 0.036, 0.04], `${leg.name}-foot`);
    legs.push({ hip: leg, upper, knee, foot, front, side });
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
    const height = { rear: lerp(0.67, 0.33, legSit.rear) + bodyHeight, front: lerp(0.67, 0.33, legSit.front) + bodyHeight };
    const pitch = Math.atan2(height.front - height.rear, 0.71);
    body.position.y = (height.front + height.rear) / 2;
    body.rotation.z = pitch;
    body.rotation.x = 0;
    for (const l of legs) {
      const end = l.front ? 'front' : 'rear';
      const phase = time * speed * 4 + ((l.front === (l.side > 0)) ? 0 : Math.PI);
      const stride = Math.cos(phase) * 0.105 * stepSize;
      // Lift while the foot swings forward (cos rising); on the ground it pushes back, so Spot walks toward +X.
      const lift = Math.max(0, -Math.sin(phase)) * 0.075 * stepSize;
      // Solve a two-link leg in the sagittal plane, keeping standing feet on the floor.
      const dx = lerp(-0.015, -0.04, legSit[end]) + stride;
      const dy = -height[end] + 0.08 + lift;
      const distance = clamp(Math.hypot(dx, dy), 0.06, 0.639);
      const bend = Math.acos(clamp((2 * 0.32 ** 2 - distance ** 2) / (2 * 0.32 ** 2), -1, 1));
      // Knees bend backward (toward -X), like the real robot. The body's pitch is undone so feet stay planted.
      l.upper.rotation.z = Math.atan2(dx, -dy) - pitch - (Math.PI - bend) / 2;
      l.knee.rotation.z = Math.PI - bend;
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
