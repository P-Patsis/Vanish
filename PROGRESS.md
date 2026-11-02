# Vanish: progress

Newest first. After every verified build: add an entry (Changed / Verified on device / Open), then commit and push.

## 2026-11-02: project set up
**Changed**
- Folder, git repo (branch `main`), `.gitignore`, README, this file and DECISIONS.md created. Listed in `/root/projects/README.md`.

**Verified on device**
- Nothing yet (no app code).

**Open**
- GitHub remote: waiting for the repo URL (`Vanish`) and a token, then push the initial commit.

## Plan
1. **Core (v1):** camera with clear errors; MediaPipe Selfie Segmentation (lazy, loading state); continuously learned background
   (updated only where the person is not); optional "capture clean background" button; feathered mask edges; fps readout; simple UI.
2. **Capture:** photo (PNG/JPEG download), video (canvas to MediaRecorder), GIF (optional; library size reported before adding).
3. **PWA:** manifest, icon, self-updating service worker (same pattern as Finger Fight: hashed VERSION, network-first shell,
   cache-first for the heavy model files, `skipWaiting` + `clients.claim`, reload on `controllerchange`).
4. **Tests** for the pure logic (background blending, mask feathering maths, service-worker version stamp); list what needs a real device.
