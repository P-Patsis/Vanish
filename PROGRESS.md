# Vanish: progress

Newest first. After every verified build: add an entry (Changed / Verified on device / Open), then commit and push.

## 2026-11-02: v1 written (NOT yet run on a device)
**Changed**
- Core: `js/bg.js` (learned background + mask maths), `js/engine.js` (one frame: smooth mask, feather, learn, paint out), `js/seg.js` (MediaPipe
  tasks-vision ImageSegmenter, selfie model, lazy from CDN, GPU then CPU fallback), `js/main.js` (camera, loop, UI).
- Capture: photo (PNG), video (canvas to MediaRecorder, mp4 or webm by browser, 60 s cap), GIF (own 3 KB encoder, no library; 240 px, 10 fps, 3 s).
  Result sheet with Save (download) and Share (where the browser supports sharing files).
- PWA: manifest, ghost icon (192, 512, maskable), self-updating service worker (`tools/stamp.mjs` stamps the version; test fails if forgotten).
- Errors: camera and model failures show the real error name and text on screen with a Try again button; no silent hang.
- Download sizes: model 250 KB, runtime JS 137 KB, runtime wasm 9.4 MB (once, then cached), GIF code 3 KB, whole app code about 40 KB.

**Verified**
- `npm test` / `node --test tests/*.test.js`: 28 tests pass. They cover the background learning (a simulated person walking across a room is painted out
  using background learned while they moved; standing still does not get absorbed; lighting drift is followed; edges are feathered), mask maths,
  the GIF encoder (decoded back by an independent reader), error wording, recorder format choice, service-worker/manifest consistency.
- NOT verified on a device: camera, MediaPipe loading, real fps, mask orientation, MediaRecorder, share sheet, install, service-worker update. No browser exists in this container.

**Open**
- Device test, in this order: (1) camera permission and denial messages, (2) model loads, (3) fps (tap the fps pill for details), (4) turn on
  "Show the person mask" and check it covers YOU (if the room is red instead, tick Invert), (5) walk across the view, then stand still, (6) photo, video, GIF,
  (7) Flip camera, (8) Add to Home screen, then push a change and check the app updates itself.
- (done) Repo made public at the user's request and Pages enabled (branch `main`, `/`): https://p-patsis.github.io/Vanish/ . Served files checked: page, sw.js (same VERSION as local), manifest, main.js, icon all return 200.

## 2026-11-02: project set up
**Changed**
- Folder, git repo (branch `main`), `.gitignore`, README, this file and DECISIONS.md created. Listed in `/root/projects/README.md`.

**Verified on device**
- Nothing yet (no app code).

**Open**
- (done) GitHub remote `P-Patsis/Vanish` added and the initial commit pushed.

## Plan
1. **Core (v1):** camera with clear errors; MediaPipe Selfie Segmentation (lazy, loading state); continuously learned background
   (updated only where the person is not); optional "capture clean background" button; feathered mask edges; fps readout; simple UI.
2. **Capture:** photo (PNG/JPEG download), video (canvas to MediaRecorder), GIF (optional; library size reported before adding).
3. **PWA:** manifest, icon, self-updating service worker (same pattern as Finger Fight: hashed VERSION, network-first shell,
   cache-first for the heavy model files, `skipWaiting` + `clients.claim`, reload on `controllerchange`).
4. **Tests** for the pure logic (background blending, mask feathering maths, service-worker version stamp); list what needs a real device.
