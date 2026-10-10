# Spot Model Lab

A standalone React + Three.js prototype of a lightweight, articulated Spot robot. This demo runs entirely in the browser; it makes no backend calls and issues no robot commands.

## Run

Requires Node.js 20.19+ or 22.12+.

```sh
cd spot-3d-demo
npm install
npm run dev
```

Open the URL printed by Vite (normally http://127.0.0.1:5173).

```sh
npm test       # Geometry budget, grounded feet, and pose checks
npm run build # Production output in dist/
npm run preview
```

## Try it

- Drag to orbit and scroll/pinch to zoom. Camera buttons also work by keyboard.
- Switch between stand, walk, and sit. Walking is a cosmetic in-place gait, with pause and speed controls.
- Change body height, enable auto-rotate, hide the grid, or inspect the wireframe.
- Choose Eco mode for a 24 fps cap and 1x maximum pixel ratio.
- Export a GLB of the current pose for Blender or another 3D viewer. Named joints and materials are preserved. The exported file **does not include walking animation clips**; that animation is procedural in `spotModel.js`.

A ready-to-use standing pose is saved at `assets/spot-prototype.glb` (**30,540 bytes**). The demo generates its model in code; it does not download this file.

## Add it to your React dashboard

Install `three` and copy these three files together:

```text
src/SpotViewer.jsx
src/SpotViewer.css
src/spotModel.js
```

```jsx
import SpotViewer from './components/SpotViewer';

export function RobotPanel({ robotState }) {
  return (
    <div style={{ position: 'relative', height: 420, background: '#edf0e7' }}>
      <SpotViewer
        stance={robotState?.isMoving ? 'walk' : 'stand'}
        playing={true}
        quality="eco"
        showGrid={true}
      />
    </div>
  );
}
```

The `robotState` example is a placeholder for your team's state shape. There is no assumed telemetry contract. For Next.js, put this in a client component; use a dynamic import with SSR disabled if needed.

| Prop | Values / default |
| --- | --- |
| `stance` | `stand` (default), `walk`, `sit` |
| `playing` | `true`; `false` freezes the current walking phase |
| `speed` | `1`; demo supports `0.5`, `1`, `1.5` |
| `bodyHeight` | Meter offset; supported range `-0.09` through `0.02`, default `0` |
| `view` | `perspective`, `front`, `side`, `top` |
| `resetKey` | Increment to restore the selected camera |
| `quality` | `balanced` (30 fps, DPR ≤ 1.5) or `eco` (24 fps, DPR ≤ 1) |
| `showGrid` | `true` |
| `wireframe`, `autoRotate` | `false` |
| `onStats` | Receives `{ triangles, calls, geometries }`: model triangles plus scene draw calls and geometry allocations |

An optional React ref exposes `await ref.current.exportGLB()`. To use the model in an existing Three.js scene without the viewer, call `createSpotModel()`, add its `root` to your scene, and call `pose({ stance, time, speed, bodyHeight, moving })`. `time` is seconds; `moving: true` enables the walk cycle. Call `dispose()` when finished. The returned `body` and `legs` expose the joints for future customization.

## Performance decisions

- **4,032 model triangles**, shared geometry and materials, no external model downloads or model textures.
- A single 64 × 64 generated contact-shadow texture. No real-time shadow maps, HDR environment maps, post-processing, physics engine, or animation library.
- On-demand drawing when stationary; animation has an explicit frame cap. Actual frame rate depends on the device.
- Stops scheduling frames when the tab is hidden or the viewer is offscreen. Auto-rotation respects reduced-motion preferences.
- Pixel ratio is capped; renderer requests a low-power GPU preference (the browser decides how to honor it).
- Geometry, materials, observers, controls, and WebGL renderer are disposed on unmount.
- Three.js/viewer is loaded separately from the initial React UI; GLB exporter loads only when requested.
- Demo fonts are optional Google Fonts, with local fallback fonts. The portable viewer does not need them.

Production build sizes are printed by `npm run build`. The 3D engine is the largest download, approximately 141 kB gzip in the initial verified build; React/demo code is approximately 73 kB gzip. Those sizes exclude optional webfonts, and hosting must enable compression to deliver the gzip sizes.

## Scope and reference

This is original stylized geometry, visually inspired by [Boston Dynamics Spot](https://bostondynamics.com/products/spot/). It is not official CAD, a physically accurate simulation, or a calibrated robot digital twin. The compact yellow shell, black sensor panels, and four jointed legs are built from code and are easy to edit. Dimensions and movements are approximate. +X is forward, +Y is up, and +Z is left; model units are meters.

Model appearance and materials: `src/spotModel.js`. Rendering and camera: `src/SpotViewer.jsx`. Demo UI: `src/main.jsx` and `src/styles.css`.

## Verification

Production build and three automated model tests pass. Browser checks covered desktop and a 390px mobile viewport, pose changes, pause, camera presets, wireframe, Eco mode, and GLB download. The exported GLB header, size, and scene structure were checked. No browser console errors were observed. Device-specific CPU/GPU usage has not been benchmarked.
