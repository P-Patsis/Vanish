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
