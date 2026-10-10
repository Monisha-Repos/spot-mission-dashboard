import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createSpotModel } from './spotModel';
import './SpotViewer.css';

/**
 * Clickable parts, anchored in the robot body's local frame (+X forward, +Y up, metres) so they follow the pose.
 * `view` is where the camera sits relative to the anchor when the part is focused.
 */
export const PART_ANCHORS = {
  ptz_camera: { label: 'PTZ camera', anchor: [0.25, 0.31, 0], view: [0.75, 0.35, 0.65] },
  thermal_camera: { label: 'Thermal camera', anchor: [0.345, 0.215, 0], view: [0.8, 0.15, -0.45] },
  microphone: { label: 'Microphone', anchor: [-0.24, 0.25, 0.09], view: [-0.55, 0.4, 0.6] },
  radio: { label: 'Radio', anchor: [-0.36, 0.42, -0.1], view: [-0.6, 0.35, -0.7] },
  battery: { label: 'Battery', anchor: [-0.1, 0.0, 0.2], view: [-0.2, 0.25, 0.95] },
  legs_and_body_cameras: { label: 'Legs + stereo cameras', anchor: [0.57, 0.04, 0], view: [0.95, 0.1, 0.55] },
};

/** Spot CAM+IR, a microphone and a radio antenna: payloads the base model doesn't have, so the parts can be clicked. */
function addPayloads(body) {
  const mats = {
    dark: new THREE.MeshStandardMaterial({ color: '#202426', roughness: 0.6, metalness: 0.2 }),
    lens: new THREE.MeshStandardMaterial({ color: '#13262f', roughness: 0.15, metalness: 0.5 }),
    dome: new THREE.MeshStandardMaterial({ color: '#3b5560', roughness: 0.1, metalness: 0.3, transparent: true, opacity: 0.85 }),
    silver: new THREE.MeshStandardMaterial({ color: '#9aa29e', roughness: 0.35, metalness: 0.7 }),
    gold: new THREE.MeshStandardMaterial({ color: '#ffc000', roughness: 0.4, metalness: 0.2 }),
  };
  const geos = { box: new THREE.BoxGeometry(1, 1, 1), cyl: new THREE.CylinderGeometry(1, 1, 1, 16), sph: new THREE.SphereGeometry(1, 16, 12) };
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
  // Spot CAM+IR: mast, head with a forward IR lens, PTZ dome on top.
  add('box', 'dark', [0.25, 0.19, 0], [0.06, 0.05, 0.06]);
  add('box', 'dark', [0.27, 0.225, 0], [0.13, 0.07, 0.12]);
  add('box', 'gold', [0.27, 0.262, 0], [0.13, 0.006, 0.12]);
  add('cyl', 'silver', [0.338, 0.215, 0], [0.03, 0.01, 0.03], [0, 0, Math.PI / 2]);
  add('cyl', 'lens', [0.344, 0.215, 0], [0.022, 0.006, 0.022], [0, 0, Math.PI / 2]);
  add('sph', 'dome', [0.25, 0.29, 0], [0.05, 0.045, 0.05]);
  add('cyl', 'lens', [0.285, 0.29, 0], [0.014, 0.01, 0.014], [0, 0, Math.PI / 2]);
  // Microphone on the rear rail.
  add('cyl', 'dark', [-0.24, 0.2, 0.09], [0.016, 0.07, 0.016]);
  add('sph', 'silver', [-0.24, 0.245, 0.09], [0.022, 0.022, 0.022]);
  // Radio antenna.
  add('cyl', 'dark', [-0.36, 0.19, -0.1], [0.022, 0.03, 0.022]);
  add('cyl', 'dark', [-0.36, 0.32, -0.1], [0.005, 0.24, 0.005]);
  add('sph', 'gold', [-0.36, 0.44, -0.1], [0.01, 0.01, 0.01]);
  body.add(group);
  return {
    group,
    triangles: group.children.reduce((n, m) => n + (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3, 0),
    setWireframe: v => Object.values(mats).forEach(m => { m.wireframe = v; }),
    dispose() { Object.values(geos).forEach(g => g.dispose()); Object.values(mats).forEach(m => m.dispose()); group.removeFromParent(); },
  };
}

const GRID_COLORS = { dark: ['#5a5a5a', '#2c2c2c'], light: ['#a0a0a0', '#d6d6d6'] };
const HOME = { position: [1.75, 1.25, 1.85], target: [0, 0.39, 0] };

/** Self-contained viewer. All animation is cosmetic; this never sends robot commands. */
const SpotViewer = forwardRef(function SpotViewer({
  stance = 'stand', playing = true, speed = 1, bodyHeight = 0,
  autoRotate = false, wireframe = false, showGrid = true, quality = 'balanced',
  view = 'perspective', resetKey = 0, onStats,
  theme = 'dark', hotspots = false, focusPart = null, onPartSelect, partStatus = {},
  shiftX = 0, // move the robot sideways on screen, as a fraction of the width (+ is right)
}, ref) {
  const host = useRef(null);
  const engine = useRef(null);
  const markers = useRef({});
  const [error, setError] = useState('');
  const props = useRef({});
  props.current = { stance, playing, speed, bodyHeight, autoRotate, wireframe, showGrid, quality, onStats, hotspots, onPartSelect, shiftX };

  useImperativeHandle(ref, () => ({
    async exportGLB() {
      if (!engine.current) throw new Error('The model is not ready.');
      const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
      const model = engine.current.model;
      const wasWireframe = props.current.wireframe;
      model.setWireframe(false);
      try {
        const buffer = await new GLTFExporter().parseAsync(model.root, { binary: true });
        const url = URL.createObjectURL(new Blob([buffer], { type: 'model/gltf-binary' }));
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = 'spot-prototype.glb';
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } finally {
        model.setWireframe(wasWireframe);
        engine.current?.invalidate();
      }
    },
  }), []);

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
    let grid = null;
    function makeGrid(name) {
      if (grid) { scene.remove(grid); grid.geometry.dispose(); grid.material.dispose(); }
      const [major, minor] = GRID_COLORS[name] || GRID_COLORS.dark;
      grid = new THREE.GridHelper(6, 60, major, minor);
      grid.material.transparent = true;
      grid.material.opacity = 0.5;
      grid.position.y = -0.008;
      grid.visible = props.current.showGrid;
      scene.add(grid);
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
      const animate = p.playing && p.stance === 'walk';
      const rotate = p.autoRotate && !reducedMotion.matches && !tween;
      const continuous = animate || rotate || Boolean(tween);
      const interval = p.quality === 'eco' ? 1000 / 24 : 1000 / 30;
      if (now - lastDraw < interval - 0.5) { schedule(); return; }
      const dt = lastTick ? Math.min((now - lastTick) / 1000, 0.08) : 0;
      lastTick = now;
      if (animate) time += dt;
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
        model.pose({ stance: p.stance, time, speed: p.speed, bodyHeight: p.bodyHeight, moving: p.stance === 'walk' });
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
      grid.geometry.dispose();
      grid.material.dispose();
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
});
export default SpotViewer;
