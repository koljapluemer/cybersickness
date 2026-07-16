# Cybersickness HUD Intervention

A WebXR (A-Frame) test scene that auto-flies the viewer along a scripted path over
a 3D landscape, used to study **cybersickness during passive vection** (motion
perceived visually while the vestibular system reports no self-motion). The
contribution of this repo is a **HUD instrument overlay** that gives the viewer a
constant visual reference for their true head attitude, implementing the
"independent visual background" / rest-frame mitigation strategy from the
cybersickness literature (e.g. Duh et al., Prothero & Parker) directly as a
head-locked instrument cluster, similar to an aircraft attitude indicator.

## Origin of the codebase

This project was bootstrapped from a university template originally built for a
spatial-preposition VR exercise (see package name `acquire-propositions-3d` and
the `public/data` git submodule pointing at `acquire-prepositions-data`). Commit
`65239b8` ("take over structure from prepo repo") is the unmodified baseline:
plain Vite + TypeScript + A-Frame scaffold with no scene content. Everything
after that commit — the flight path, the landscape, and the HUD — was added for
this cybersickness experiment.

## Core files

| File | Role |
|---|---|
| `src/main.ts` | Entire application: scene bootstrap + all A-Frame components/shaders. Single file by design (see `AGENTS.md`). |
| `src/style.css` | Fullscreen layout reset for the embedded `<a-scene>`. |
| `index.html` | Entry point, mounts the scene into `#app`, loads a GoatCounter analytics beacon. |
| `public/tour-path.json` | `{ duration, points: [{ t, position }] }` — the pre-baked flight path (600 samples over 120s), keyframe-interpolated at runtime. |
| `public/export_tour_path.py` | Blender script: samples a curve object named `TourPath` in a `.blend` file and exports it to `tour-path.json`, converting Blender's Z-up axis convention to A-Frame's Y-up. Run inside Blender's scripting console, not part of the app build. |
| `public/mountains/` | The glTF landscape flown over. |
| `issues/` | Free-form dev notes/TODOs, not formal issue tracking. `compass-auto-rotate.md` documents the one known unresolved bug in the HUD (see below). |

## Scene structure (`src/main.ts`)

- **`tour-flight` component** — drives the camera rig. On `init` it fetches
  `tour-path.json`; on every `tick` it samples the current position and a
  short look-ahead position (`samplePath`, linear interpolation between
  keyframes), transforms both into world space (`applyWorldTransform`: scale →
  rotate by a fixed `rotationY` → offset), then sets `object3D.position` and
  calls `object3D.lookAt(lookTarget)` before applying a fixed pitch tilt. This
  is what makes the camera *bank and turn on its own* — the source of the
  vection the HUD is meant to counteract.
- The `<a-camera>` is nested inside the `tour-flight` entity with
  `look-controls-enabled="false"` and `wasd-controls-enabled="false"`: the user
  cannot steer, only physically rotate their head inside the HMD. In VR mode,
  WebXR still writes the headset's real orientation onto the camera object on
  top of whatever the `tour-flight` component sets on its parent.

## The intervention: attitude/compass HUD

Four head-locked "instruments" are mounted as children of `<a-camera>` so they
stay fixed in the viewer's field of view (front, bottom, left, right — an
arrangement noted in `issues/cockpit.md` as deliberately evoking a B‑17-style
gunner cockpit canopy frame). Each instrument is two stacked entities:

1. **A static reference ring** (`geometry="primitive: ring"`) — a dim,
   always-visible annulus that acts as the fixed "track" the moving indicator
   runs along.
2. **A moving indicator bar** — a flat plane textured with the custom
   `horizon-bar` shader (`AFRAME.registerShader`), which discards fragments
   outside an `[innerRadius, outerRadius]` band so the plane renders as a thin
   arc rather than a full rectangle. Its `rotation.z` is recomputed every tick
   from the real camera quaternion, so the arc sweeps around the static ring
   in proportion to head rotation, the way a needle sweeps a dial.

### Components and their math

- **`horizon-hud` (roll / front ring):** takes the camera's world quaternion,
  inverts it, and applies it to the world-up vector `(0,1,0)` to express "true
  up" in camera-local space. `atan2(x, y)` of that vector gives the roll angle
  relative to gravity, which is negated and written to `rotation.z`. Net
  effect: as the viewer tilts their head, the indicator counter-rotates so it
  keeps pointing at true world-up — an artificial-horizon roll cue.
- **`compass-hud` (yaw / bottom ring):** projects the camera's forward vector
  `(0,0,-1)` onto the world XZ-plane and takes `atan2(x, -z)` to get yaw. The
  first yaw sample observed becomes `initialYaw` (a runtime-captured reference
  "north"); `rotation.z` is set to `yaw - initialYaw`, so the ring shows
  cumulative heading change since the scene started.
- **`pitch-hud` (two side rings, mirrored L/R):** same up-vector projection as
  `horizon-hud`, but reads `atan2(z, y)` instead of `atan2(x, y)` to get pitch.
  One instance is mounted with `flip: true` so the two side rings rotate in
  mirrored directions, matching left/right symmetry.

All three read orientation via `sceneEl.camera.getWorldQuaternion(...)`, i.e.
the camera's **world** transform, not its local one — this is why the
indicators currently respond to the combined rotation of the automated flight
path *and* real head movement, not real head movement alone (see Known
limitations).

### Desktop fallback

Outside `vr-mode`, `look-controls`/`wasd-controls` are disabled and there is no
real head input to visualize, so each component instead spins its ring at a
fixed rate (roll clockwise, compass counter-clockwise, pitch clockwise) purely
so a developer without a headset can visually confirm the ring/shader renders
and rotates in the expected direction. This path is dev-verification only and
carries no experimental meaning.

## Known limitation

`issues/compass-auto-rotate.md`: the compass ring still rotates when the
simulated flight path turns the rig, even if the viewer's physical head is held
still — because `getWorldQuaternion` bakes in both the `tour-flight` rig's
automated rotation and the WebXR head pose together. Two fix attempts are in
the history (`1096fe3`, `1b4b7cd`): reading `cameraObject.quaternion` (local,
parent-relative) instead of the world quaternion was tried and then reverted,
since A-Frame/WebXR's local-vs-world split between the rig and the camera
object didn't cleanly isolate "real head movement only" either. As shipped, the
HUD reflects **net visual rotation**, not isolated physical head rotation —
worth stating explicitly when interpreting any user study results.

## Running

```bash
npm install
npm run build   # tsc + vite build
npm run lint
```

(Do not run `npm run dev` / `vite` in this environment — see `AGENTS.md`.)
