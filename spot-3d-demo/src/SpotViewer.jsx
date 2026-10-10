import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createSpotModel } from './spotModel';
import './SpotViewer.css';

/**
 * Clickable parts, anchored in the robot body's local frame (+X forward, +Y up, metres) so they follow the pose.
 * `view` is where the camera sits relative to the anchor when the part is focused.
 */
export const PART_ANCHORS = {
  ptz_camera: { label: 'PTZ camera', anchor: [-0.27, 0.436, 0], view: [0.7, 0.3, 0.55] },
  thermal_camera: { label: 'Thermal camera', anchor: [-0.212, 0.356, 0.022], view: [0.75, 0.05, 0.45] },
  microphone: { label: 'Microphone', anchor: [-0.17, 0.205, 0.082], view: [-0.2, 0.4, 0.65] },
  battery: { label: 'Battery', anchor: [-0.05, 0.0, 0.18], view: [-0.2, 0.25, 0.95] },
  legs_and_body_cameras: { label: 'Legs + stereo cameras', anchor: [0.53, 0.0, 0], view: [0.95, 0.1, 0.55] },
}

/**
 * Spot CAM+IR as it's usually fitted: a black finned mount plate at the front of the deck, a black base with yellow
 * status dots, a PTZ dome with its zoom and thermal lenses, a black roll cage of two crossing hoops, a whip antenna,
 * and a small microphone on the plate.
 */
function addPayloads(body) {
  const mats = {
    dark: new THREE.MeshStandardMaterial({ color: '#1b1e20', roughness: 0.65, metalness: 0.1 }),
    shell: new THREE.MeshStandardMaterial({ color: '#232729', roughness: 0.45, metalness: 0.15 }),
    mesh: new THREE.MeshStandardMaterial({ color: '#3a3e41', roughness: 0.85 }),
    lens: new THREE.MeshStandardMaterial({ color: '#0d171c', roughness: 0.1, metalness: 0.6 }),
    glass: new THREE.MeshStandardMaterial({ color: '#7f9aa6', roughness: 0.1, metalness: 0.3 }),
    dot: new THREE.MeshStandardMaterial({ color: '#ffc000', emissive: '#7a5800', roughness: 0.4 }),
    band: new THREE.MeshStandardMaterial({ color: '#8c949a', roughness: 0.3, metalness: 0.6 }),
    cap: new THREE.MeshStandardMaterial({ color: '#c3c7ca', roughness: 0.6 }),
    estop: new THREE.MeshStandardMaterial({ color: '#d42a1f', roughness: 0.45 }),
  };
  const geos = {
    box: new THREE.BoxGeometry(1, 1, 1),
    cyl: new THREE.CylinderGeometry(1, 1, 1, 24),
    dome: new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    arch: new THREE.TorusGeometry(1, 0.045, 6, 32, Math.PI),
    ring: new THREE.TorusGeometry(1, 0.045, 6, 32),
  };
  const group = new THREE.Group();
  group.name = 'payloads';
  const add = (geo, mat, pos, scale, rot) => {
    const m = new THREE.Mesh(geos[geo], mats[mat]);
    m.position.set(...pos);
    m.scale.set(...scale);
    if (rot) m.rotation.set(...rot);
    group.add(m);
    return m;
  };
  const X = [0, 0, Math.PI / 2];   // cylinder axis along X (lenses facing forward)
  // Order front to back (as on the real robot): stereo-camera face, lidar in the middle of the deck, PTZ camera
  // tower at the back, with a finned mount plate between the two.
  const cx = -0.27;   // PTZ tower
  const lx = 0.06;    // lidar
  // Mount plate with heat-sink ribs, from the lidar back to the PTZ tower.
  add('box', 'dark', [-0.18, 0.162, 0], [0.26, 0.022, 0.19]);
  for (let i = 0; i < 6; i++) add('box', 'mesh', [-0.12, 0.181, -0.07 + i * 0.028], [0.1, 0.016, 0.006]);
  // PTZ tower base: tall black cylinder with two yellow status dots and a small camera between them.
  add('cyl', 'dark', [cx, 0.24, 0], [0.072, 0.135, 0.072]);
  for (const z of [-0.028, 0.028]) add('box', 'dot', [cx + 0.07, 0.286, z], [0.006, 0.012, 0.009]);
  add('cyl', 'lens', [cx + 0.071, 0.265, 0], [0.008, 0.005, 0.008], X);
  // PTZ head: neck, black housing and dome, big zoom lens and a smaller thermal (IR) lens facing forward.
  add('cyl', 'dark', [cx, 0.322, 0], [0.05, 0.03, 0.05]);
  add('cyl', 'shell', [cx, 0.365, 0], [0.058, 0.062, 0.058]);
  add('dome', 'shell', [cx, 0.396, 0], [0.058, 0.04, 0.058]);
  add('cyl', 'lens', [cx + 0.056, 0.378, -0.014], [0.022, 0.008, 0.022], X);
  add('cyl', 'glass', [cx + 0.06, 0.378, -0.014], [0.012, 0.002, 0.012], X);
  add('cyl', 'lens', [cx + 0.057, 0.356, 0.022], [0.012, 0.008, 0.012], X);
  // Roll cage: two crossing hoops over the head on a base ring, plus a whip antenna.
  add('ring', 'dark', [cx, 0.318, 0], [0.098, 0.098, 0.098], [Math.PI / 2, 0, 0]);
  add('arch', 'dark', [cx, 0.318, 0], [0.098, 0.13, 0.098]);
  add('arch', 'dark', [cx, 0.318, 0], [0.098, 0.13, 0.098], [0, Math.PI / 2, 0]);
  add('cyl', 'dark', [cx - 0.018, 0.5, 0], [0.004, 0.12, 0.004], [0, 0, 0.3]);
  // Lidar in the middle of the deck: finned black base box, dark puck body with a lighter scanning band,
  // black cap with a light grey top.
  add('box', 'dark', [lx, 0.178, 0], [0.17, 0.05, 0.16]);
  for (const side of [-1, 1]) for (let i = 0; i < 6; i++) add('box', 'mesh', [lx - 0.06 + i * 0.024, 0.172, side * 0.081], [0.008, 0.032, 0.004]);
  add('cyl', 'dark', [lx, 0.222, 0], [0.058, 0.04, 0.058]);
  add('cyl', 'band', [lx, 0.256, 0], [0.056, 0.028, 0.056]);
  add('cyl', 'dark', [lx, 0.288, 0], [0.06, 0.036, 0.06]);
  add('dome', 'cap', [lx, 0.306, 0], [0.06, 0.012, 0.06]);
  // Red emergency-stop button on the front corner of the deck.
  add('cyl', 'dark', [0.42, 0.133, -0.085], [0.017, 0.008, 0.017]);
  add('cyl', 'estop', [0.42, 0.142, -0.085], [0.013, 0.01, 0.013]);
  // Microphone on the mount plate, beside the PTZ tower.
  add('cyl', 'dark', [-0.17, 0.183, 0.082], [0.012, 0.022, 0.012]);
  add('cyl', 'mesh', [-0.17, 0.196, 0.082], [0.011, 0.004, 0.011]);
  body.add(group);
  return {
    group,
    triangles: group.children.reduce((n, m) => n + (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3, 0),
    setWireframe: v => Object.values(mats).forEach(m => { m.wireframe = v; }),
    dispose() { Object.values(geos).forEach(g => g.dispose()); Object.values(mats).forEach(m => m.dispose()); group.removeFromParent(); },
  };
}

// Floor: a 6 m grid of 10 cm cells, plus the two axis lines through the starting point.
const GRID_SIZE = 6, GRID_CELL = 0.1;
const GRID_COLORS = { dark: ['#b0b0b0', '#4c4c4c'], light: ['#6e6e6e', '#d6d6d6'] };
const HOME = { position: [1.75, 1.25, 1.85], target: [0, 0.39, 0] };

/** Self-contained viewer. All animation is cosmetic; this never sends robot commands. */
export default function SpotViewer({
  stance = 'stand', playing = true, speed = 1, bodyHeight = 0,
  autoRotate = false, wireframe = false, showGrid = true, quality = 'balanced',
  view = 'perspective', resetKey = 0, onStats,
  theme = 'dark', hotspots = false, focusPart = null, onPartSelect, partStatus = {},
  shiftX = 0, // move the robot sideways on screen, as a fraction of the width (+ is right)
}) {
  const host = useRef(null);
  const engine = useRef(null);
  const markers = useRef({});
  const [error, setError] = useState('');
  const props = useRef({});
  props.current = { stance, playing, speed, bodyHeight, autoRotate, wireframe, showGrid, quality, onStats, hotspots, onPartSelect, shiftX };

  useEffect(() => {
    const element = host.current;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    } catch {
      setError('3D rendering is unavailable. Try a browser with WebGL 2 and hardware acceleration enabled.');
      return;
    }
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.35;
    renderer.domElement.setAttribute('aria-label', 'Interactive 3D Spot robot. Drag to orbit, scroll to zoom, or use the part buttons.');
    renderer.domElement.setAttribute('role', 'img');
    element.prepend(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.05, 30);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;
    controls.enablePan = false;
    controls.minDistance = 0.6;
    controls.maxDistance = 5;
    controls.maxPolarAngle = Math.PI / 2 - 0.02;
    controls.target.set(...HOME.target);
    scene.add(new THREE.HemisphereLight('#fffaf0', '#798071', 2.6));
    const key = new THREE.DirectionalLight('#fff7e0', 3.2);
    key.position.set(2, 5, 3);
    scene.add(key);
    const fill = new THREE.DirectionalLight('#e5edf4', 1.7);
    fill.position.set(-3, 2, -3);
    scene.add(fill);
    const model = createSpotModel();
    const payloads = addPayloads(model.body);
    scene.add(model.root);
    // grid = the floor group: `cells` (uniform lines, slid and wrapped every cell while walking, which is seamless)
    // and two axis lines. The axis across Spot's path slides away for good; the one along its path doesn't need to move.
    // Distance walked. Spot stays put and the floor slides back (a treadmill), so the axes move away behind it.
    let walked = 0;
    let grid = null, cells = null, axisAcross = null;
    function disposeFloor() {
      grid?.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
      if (grid) scene.remove(grid);
    }
    function makeGrid(name) {
      disposeFloor();
      const [major, minor] = GRID_COLORS[name] || GRID_COLORS.dark;
      grid = new THREE.Group();
      grid.position.y = -0.008;
      grid.visible = props.current.showGrid;
      cells = new THREE.GridHelper(GRID_SIZE, GRID_SIZE / GRID_CELL, minor, minor);
      const half = GRID_SIZE / 2;
      const axisMaterial = () => new THREE.LineBasicMaterial({ color: major, transparent: true, opacity: 0.95 });
      const line = (a, b) => new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...a), new THREE.Vector3(...b)]), axisMaterial());
      const axisAlong = line([-half, 0.001, 0], [half, 0.001, 0]);
      axisAcross = line([0, 0.001, -half], [0, 0.001, half]);
      cells.material.transparent = true;
      cells.material.opacity = 0.5;
      grid.add(cells, axisAlong, axisAcross);
      placeFloor();
      scene.add(grid);
    }
    // Spot faces +X, so the floor moves toward -X as it walks.
    function placeFloor() {
      if (!cells) return;
      cells.position.x = -(walked % GRID_CELL);
      axisAcross.position.x = -walked;
      axisAcross.visible = walked < GRID_SIZE / 2;
    }
    makeGrid(theme);
    // A small generated contact-shadow texture replaces expensive shadow maps.
    const shadowCanvas = document.createElement('canvas');
    shadowCanvas.width = shadowCanvas.height = 64;
    const ctx = shadowCanvas.getContext('2d');
    const gradient = ctx.createRadialGradient(32, 32, 1, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(0,0,0,0.35)');
    gradient.addColorStop(0.45, 'rgba(0,0,0,0.2)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
    const shadowTexture = new THREE.CanvasTexture(shadowCanvas);
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.85, 1.25), new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = -0.003;
    scene.add(shadow);

    let frame = 0, lastDraw = -Infinity, lastTick = 0, time = 0;
    let dirty = true, alive = true, inViewport = true, lost = false;
    let tween = null;
    // 0 = standing, 1 = sitting; eased toward the selected stance so sit/stand animate.
    let sitAmt = props.current.stance === 'sit' ? 1 : 0;
    // 0 = stopped, 1 = full stride; eased so Spot speeds up and slows down instead of snapping.
    let gait = props.current.stance === 'walk' && props.current.playing ? 1 : 0;
    let lastMetrics = '';
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const v = new THREE.Vector3();
    function active() { return alive && !document.hidden && inViewport && !lost; }
    function schedule() { if (!frame && active()) frame = requestAnimationFrame(draw); }
    function invalidate() { dirty = true; schedule(); }
    function anchorWorld(id, out = new THREE.Vector3()) {
      model.body.updateWorldMatrix(true, false);
      return model.body.localToWorld(out.set(...PART_ANCHORS[id].anchor));
    }
    // Hotspot buttons are HTML, positioned over the canvas every frame the scene is drawn.
    function placeMarkers() {
      const show = props.current.hotspots;
      const width = element.clientWidth, height = element.clientHeight;
      for (const [id, el] of Object.entries(markers.current)) {
        if (!el) continue;
        anchorWorld(id, v).project(camera);
        const visible = show && v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05;
        el.style.visibility = visible ? 'visible' : 'hidden';
        el.style.transform = `translate(${((v.x + 1) / 2) * width}px, ${((1 - v.y) / 2) * height}px) translate(-50%, -50%)`;
      }
    }
    function draw(now) {
      frame = 0;
      if (!active()) return;
      const p = props.current;
      // Gait eases in and out: leaving Walk slows Spot to a stop before it sits or stands still,
      // and Walk from sitting stands up first. Both are gated so the motions happen one after the other.
      const gaitTarget = p.playing && p.stance === 'walk' && sitAmt === 0 ? 1 : 0;
      const changingGait = gait !== gaitTarget;
      const animate = gait > 0 || gaitTarget > 0;
      const rotate = p.autoRotate && !reducedMotion.matches && !tween;
      const sitTarget = p.stance === 'sit' ? 1 : 0;
      const sitting = sitAmt !== sitTarget && gait === 0;
      const continuous = animate || changingGait || rotate || Boolean(tween) || sitting;
      const interval = p.quality === 'eco' ? 1000 / 24 : 1000 / 30;
      if (now - lastDraw < interval - 0.5) { schedule(); return; }
      const dt = lastTick ? Math.min((now - lastTick) / 1000, 0.08) : 0;
      lastTick = now;
      if (changingGait) {
        // About 0.5 s to get going, 1 s to slow down.
        const step = reducedMotion.matches ? 1 : gaitTarget > gait ? dt / 0.5 : dt / 1.0;
        gait = gaitTarget > gait ? Math.min(1, gait + step) : Math.max(0, gait - step);
      }
      if (animate) time += dt;
      if (sitting) {
        const step = reducedMotion.matches ? 1 : dt / 1.1;
        sitAmt = sitTarget > sitAmt ? Math.min(sitTarget, sitAmt + step) : Math.max(sitTarget, sitAmt - step);
      }
      // Ground speed matching the leg stride (0.21 m sweep per half gait cycle) scaled by the gait, so feet don't skate.
      if (animate && !reducedMotion.matches) walked += dt * p.speed * 0.267 * gait;
      if (dirty || continuous) {
        if (tween) {
          tween.t = Math.min(1, tween.t + dt / tween.duration);
          const e = 1 - Math.pow(1 - tween.t, 3);
          camera.position.lerpVectors(tween.fromPos, tween.toPos, e);
          controls.target.lerpVectors(tween.fromTarget, tween.toTarget, e);
          controls.update();
          if (tween.t >= 1) tween = null;
        }
        if (rotate) {
          const offset = camera.position.clone().sub(controls.target);
          offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), dt * 0.22);
          camera.position.copy(controls.target).add(offset);
          controls.update();
        }
        model.pose({ stance: p.stance, time, speed: p.speed, bodyHeight: p.bodyHeight, moving: gait > 0, gait, sit: sitAmt });
        placeFloor();
        renderer.render(scene, camera);
        placeMarkers();
        lastDraw = now;
        dirty = false;
        const metrics = { triangles: model.triangleCount + payloads.triangles, calls: renderer.info.render.calls, geometries: renderer.info.memory.geometries };
        const key = JSON.stringify(metrics);
        if (key !== lastMetrics) { lastMetrics = key; p.onStats?.(metrics); }
      }
      if (continuous) schedule();
      else lastTick = 0;
    }
    function resize() {
      const width = element.clientWidth, height = element.clientHeight;
      if (!width || !height) return;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, props.current.quality === 'eco' ? 1 : 1.5));
      renderer.setSize(width, height);
      camera.aspect = width / height;
      // A view offset slides the picture without moving the orbit pivot, so hotspots and picking stay aligned.
      const shift = props.current.shiftX || 0;
      if (shift) camera.setViewOffset(width, height, -shift * width, 0, width, height);
      else camera.clearViewOffset();
      camera.updateProjectionMatrix();
      invalidate();
    }
    function flyTo(position, target) {
      if (reducedMotion.matches) {
        camera.position.copy(position);
        controls.target.copy(target);
        controls.update();
        tween = null;
      } else {
        tween = { fromPos: camera.position.clone(), toPos: position, fromTarget: controls.target.clone(), toTarget: target, t: 0, duration: 0.8 };
      }
      invalidate();
    }
    function setView(name) {
      const positions = { perspective: HOME.position, side: [0, 0.65, 2.65], front: [2.65, 0.65, 0], top: [0, 2.9, 0.001] };
      flyTo(new THREE.Vector3(...(positions[name] || positions.perspective)), new THREE.Vector3(...HOME.target));
    }
    function focus(id) {
      if (!id || !PART_ANCHORS[id]) { setView('perspective'); return; }
      const target = anchorWorld(id);
      flyTo(target.clone().add(new THREE.Vector3(...PART_ANCHORS[id].view)), target);
    }
    // Click a mesh to pick the nearest part (a drag to orbit is not a click).
    const raycaster = new THREE.Raycaster();
    let down = null;
    const onDown = e => { down = { x: e.clientX, y: e.clientY }; };
    const onUp = e => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5 || !props.current.onPartSelect) return;
      const rect = renderer.domElement.getBoundingClientRect();
      raycaster.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), camera);
      const hit = raycaster.intersectObject(model.root, true)[0];
      if (!hit) return;
      const local = model.body.worldToLocal(hit.point.clone());
      let best = null, bestDist = 0.22;
      for (const [id, { anchor }] of Object.entries(PART_ANCHORS)) {
        const d = local.distanceTo(new THREE.Vector3(...anchor));
        if (d < bestDist) { best = id; bestDist = d; }
      }
      // Anything else on the body is the legs + body cameras.
      props.current.onPartSelect(best || 'legs_and_body_cameras');
    };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);

    const observer = new ResizeObserver(resize);
    observer.observe(element);
    const intersection = new IntersectionObserver(([entry]) => {
      inViewport = entry.isIntersecting;
      lastTick = 0;
      if (inViewport) invalidate();
      else { cancelAnimationFrame(frame); frame = 0; }
    });
    intersection.observe(element);
    const visibility = () => { lastTick = 0; if (document.hidden) { cancelAnimationFrame(frame); frame = 0; } else invalidate(); };
    const contextLost = e => { e.preventDefault(); lost = true; cancelAnimationFrame(frame); frame = 0; setError('The graphics context was interrupted. Waiting for your browser to restore it…'); };
    const contextRestored = () => { lost = false; setError(''); resize(); };
    renderer.domElement.addEventListener('webglcontextlost', contextLost);
    renderer.domElement.addEventListener('webglcontextrestored', contextRestored);
    document.addEventListener('visibilitychange', visibility);
    reducedMotion.addEventListener('change', invalidate);
    controls.addEventListener('change', invalidate);
    engine.current = {
      model, payloads, setView, focus, resize, invalidate, makeGrid,
      get grid() { return grid; },
    };
    camera.position.set(...HOME.position);
    controls.update();
    resize();
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      observer.disconnect();
      intersection.disconnect();
      document.removeEventListener('visibilitychange', visibility);
      reducedMotion.removeEventListener('change', invalidate);
      renderer.domElement.removeEventListener('webglcontextlost', contextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', contextRestored);
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointerup', onUp);
      controls.dispose();
      payloads.dispose();
      model.dispose();
      disposeFloor();
      shadow.geometry.dispose();
      shadow.material.dispose();
      shadowTexture.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      engine.current = null;
    };
  }, []);

  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    e.model.setWireframe(wireframe);
    e.payloads.setWireframe(wireframe);
    e.grid.visible = showGrid;
    e.resize();
    e.invalidate();
  }, [stance, playing, speed, bodyHeight, autoRotate, wireframe, showGrid, quality, hotspots, shiftX]);
  useEffect(() => { engine.current?.makeGrid(theme); engine.current?.invalidate(); }, [theme]);
  useEffect(() => { engine.current?.setView(view); }, [view, resetKey]);
  useEffect(() => { if (hotspots) engine.current?.focus(focusPart); }, [focusPart, hotspots]);

  return (
    <div className="canvas-host" ref={host}>
      {hotspots && Object.entries(PART_ANCHORS).map(([id, part]) => (
        <button
          key={id}
          ref={el => { markers.current[id] = el; }}
          type="button"
          className={`hotspot tone-${partStatus[id] || 'muted'}${focusPart === id ? ' is-active' : ''}`}
          onClick={() => onPartSelect?.(focusPart === id ? null : id)}
          aria-pressed={focusPart === id}
          aria-label={`${part.label}: show what it measured`}
        >
          <span className="hotspot-dot" aria-hidden="true" />
          <span className="hotspot-label">{part.label}</span>
        </button>
      ))}
      {error && <div className="viewer-error" role="alert"><strong>Let’s get Spot back on screen.</strong><p>{error}</p><button onClick={() => window.location.reload()}>Reload viewer</button></div>}
    </div>
  );
}
