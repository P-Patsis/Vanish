# Vanish

An invisibility toy for the browser. Point the camera at a scene, step into frame, and the app paints you out:
the live view shows the room with you removed. Installable PWA, hosted on GitHub Pages (HTTPS, so the camera works).

How it works (planned): person segmentation (MediaPipe Selfie Segmentation, from a CDN) + a background model that is
learned continuously from the pixels the person is NOT covering, so it tolerates small camera movement and lighting drift.
Prior art: Jason Mayes' "Real-Time Person Removal" (TF.js, Apache-2.0).

Capture: photo, video clip (MediaRecorder) and optional GIF.

Status and history: [PROGRESS.md](PROGRESS.md), gotchas and choices: [DECISIONS.md](DECISIONS.md).
