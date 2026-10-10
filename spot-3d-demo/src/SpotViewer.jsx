import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createSpotModel } from './spotModel';
import './SpotViewer.css';

/** Self-contained viewer. All animation is cosmetic; this never sends robot commands. */
const SpotViewer = forwardRef(function SpotViewer({
  stance = 'stand', playing = true, speed = 1, bodyHeight = 0,
  autoRotate = false, wireframe = false, showGrid = true, quality = 'balanced',
  view = 'perspective', resetKey = 0, onStats,
}, ref) {
  const host = useRef(null);
  const engine = useRef(null);
  const [error, setError] = useState('');
  const props = useRef({});
  props.current = { stance, playing, speed, bodyHeight, autoRotate, wireframe, showGrid, quality, onStats };

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
    renderer.setClearColor(0xf0f0e9, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.35;
    renderer.domElement.setAttribute('aria-label', 'Interactive 3D Spot robot. Drag to orbit, scroll to zoom, or use the view buttons.');
    renderer.domElement.setAttribute('role', 'img');
    element.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.05, 30);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;
    controls.enablePan = false;
    controls.minDistance = 1.3;
    controls.maxDistance = 5;
    controls.maxPolarAngle = Math.PI / 2 - 0.02;
    controls.target.set(0, 0.39, 0);
    scene.add(new THREE.HemisphereLight('#fffaf0', '#798071', 2.6));
    const key = new THREE.DirectionalLight('#fff7e0', 3.2);
    key.position.set(2, 5, 3);
    scene.add(key);
    const fill = new THREE.DirectionalLight('#e5edf4', 1.7);
    fill.position.set(-3, 2, -3);
    scene.add(fill);
    const model = createSpotModel();
    scene.add(model.root);
    const grid = new THREE.GridHelper(6, 60, '#a4ada0', '#cbd0c3');
    grid.material.transparent = true;
    grid.material.opacity = 0.42;
    grid.position.y = -0.008;
    scene.add(grid);
    // A small generated contact-shadow texture replaces expensive shadow maps.
    const shadowCanvas = document.createElement('canvas');
    shadowCanvas.width = shadowCanvas.height = 64;
    const ctx = shadowCanvas.getContext('2d');
    const gradient = ctx.createRadialGradient(32, 32, 1, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(35,43,32,0.27)');
    gradient.addColorStop(0.45, 'rgba(35,43,32,0.17)');
    gradient.addColorStop(1, 'rgba(35,43,32,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
    const shadowTexture = new THREE.CanvasTexture(shadowCanvas);
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.85, 1.25), new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = -0.003;
    scene.add(shadow);

    let frame = 0, lastDraw = -Infinity, lastTick = 0, time = 0;
    let dirty = true, alive = true, inViewport = true, lost = false;
    let lastMetrics = '';
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    function active() { return alive && !document.hidden && inViewport && !lost; }
    function schedule() { if (!frame && active()) frame = requestAnimationFrame(draw); }
    function invalidate() { dirty = true; schedule(); }
    function draw(now) {
      frame = 0;
      if (!active()) return;
      const p = props.current;
      const animate = p.playing && p.stance === 'walk';
      const rotate = p.autoRotate && !reducedMotion.matches;
      const continuous = animate || rotate;
      const interval = p.quality === 'eco' ? 1000 / 24 : 1000 / 30;
      if (now - lastDraw < interval - 0.5) { schedule(); return; }
      const dt = lastTick ? Math.min((now - lastTick) / 1000, 0.08) : 0;
      lastTick = now;
      if (animate) time += dt;
      if (dirty || continuous) {
        if (rotate) {
          const offset = camera.position.clone().sub(controls.target);
          offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), dt * 0.22);
          camera.position.copy(controls.target).add(offset);
          controls.update();
        }
        model.pose({ stance: p.stance, time, speed: p.speed, bodyHeight: p.bodyHeight, moving: p.stance === 'walk' });
        renderer.render(scene, camera);
        lastDraw = now;
        dirty = false;
        const metrics = { triangles: model.triangleCount, calls: renderer.info.render.calls, geometries: renderer.info.memory.geometries };
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
      camera.updateProjectionMatrix();
      invalidate();
    }
    function setView(name) {
      const positions = { perspective: [1.75, 1.25, 1.85], side: [0, 0.65, 2.65], front: [2.65, 0.65, 0], top: [0, 2.9, 0.001] };
      camera.position.set(...(positions[name] || positions.perspective));
      controls.target.set(0, 0.39, 0);
      controls.update();
      invalidate();
    }
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
    engine.current = { model, grid, setView, resize, invalidate };
    setView('perspective');
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
      controls.dispose();
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
    e.grid.visible = showGrid;
    e.resize();
    e.invalidate();
  }, [stance, playing, speed, bodyHeight, autoRotate, wireframe, showGrid, quality]);
  useEffect(() => { engine.current?.setView(view); }, [view, resetKey]);
  return <div className="canvas-host" ref={host}>{error && <div className="viewer-error" role="alert"><strong>Let’s get Spot back on screen.</strong><p>{error}</p><button onClick={() => window.location.reload()}>Reload viewer</button></div>}</div>;
});
export default SpotViewer;
