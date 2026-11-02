# Vanish: decisions and gotchas

## 2026-11-02: starting decisions
- **Web only, GitHub Pages.** No Android build. HTTPS is what makes `getUserMedia` work off localhost.
- **Folder is `vanish`** (repo name is Vanish), not `invisibility-toy`.
- **Continuously learned background, not one frozen frame.** Pixels outside the person mask are blended into a stored background
  every frame; pixels under the mask are left alone, so what the person uncovers is learned as they move. A "capture clean
  background" button is only a quick start.
- **Libraries from a CDN** (MediaPipe), as in Finger Fight. No bundler, no build step.
- **Self-updating service worker**, copied from Finger Fight's pattern. Remember to run the stamp tool before committing.
- **Commits:** author is the user, no AI attribution trailer (per `/root/projects/CLAUDE.md`, which overrides the global reminder).
- **Never commit or print the GitHub token.** Push using a one-off credential, not a URL stored in `.git/config`.

## Gotchas to watch
- Phone RAM and CPU are the limit: segment at low resolution, keep the background model small, report real fps.
- Mask edges: a hard cutout looks jagged; blur/feather the mask before compositing.
- `MediaRecorder` mime types differ by browser (Safari: mp4, Chrome/Firefox: webm). Pick with `isTypeSupported`.

## 2026-11-02: how v1 is built, and what it cannot do
- **MediaPipe tasks-vision `ImageSegmenter` + `selfie_segmenter.tflite` (250 KB, versioned URL `float16/1`)**, same CDN/version as Finger Fight (0.10.14).
  Not the old `@mediapipe/selfie_segmentation` solution and not TF.js BodyPix: smaller, one loader for the whole portfolio.
- **Mask meaning is unverified.** Docs say two categories (background 0, person 1). `seg.js` uses mask 1 when two masks come back; if only one comes back
  it is assumed to be "person" and `orientVote` (person in the middle, border = background) auto-inverts it after 8 decisive frames. Settings also has a
  manual Invert. Check on device with "Show the person mask".
- **Processing happens at 320/480/720 px on the long side, not at camera size.** Photos, videos and GIFs are therefore that size too (Sharp = 720).
- **Background model per pixel: colour + age n.** Age 0 = never seen, so the live pixel is shown (the person stays visible there until they move and
  uncover it; the hint shows the percentage learned). Learning rate = 1/(n+1) down to a floor (slow 4, normal 8, fast 20 out of 256 per frame).
  A pixel that differs from its model by more than 120 (sum of RGB) loses half its age, so a moved object or a bumped camera is relearned fast.
- **Learning is gated.** Nothing is learned within about w/48 px of the person (blurred mask), and nothing at all on frames where the segmenter gave no mask,
  otherwise the person would be absorbed into the background.
- **Known limits (by design for v1):** (1) the area hidden behind a still person cannot follow lighting changes, because it cannot be seen; global
  brightness compensation would fix that, not done. (2) If the camera moves a lot, the old background is wrong until it is relearned (about a second at Fast).
  (3) A person who is still for a long time while the mask misses a limb will slowly get learned at that spot. (4) Shadows and reflections of the person remain.
- **Mirror**: the front camera is mirrored in the pixels themselves (not CSS), so photos/videos match what is on screen.
- **GIF encoder is our own (fixed 3-3-2 palette + ordered dither + LZW), ~3 KB, no library.** Cost: banded colours compared with an adaptive palette. Chosen
  because palette quantising is the slow part on a phone. A library (e.g. gif.js, about 15 KB plus a worker) would look better; not needed for a toy.
- **Service worker** copied from Finger Fight. Heavy cache `vn-heavy` is cache-first (jsdelivr mediapipe + mediapipe-models), shell is network-first
  with versioned precache. `node tools/stamp.mjs` before every commit that changes a precached file.
- **GitHub Pages is not available on the free plan for a private repo.** The repo was created private; on the user's yes it was made public and Pages enabled (2026-11-02). Live: https://p-patsis.github.io/Vanish/ . Alternative if it must go private again: Cloudflare Pages / Netlify connected to the repo.
