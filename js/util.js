// Small pure helpers: error wording, recorder format choice, file names.

/** A readable message for a getUserMedia failure. The real error name and text are always appended, never hidden. */
export function cameraErrorMessage(e) {
  const name = e?.name || 'Error', detail = e?.message ? `${name}: ${e.message}` : name;
  let say;
  switch (name) {
    case 'NotAllowedError': case 'PermissionDeniedError':
      say = 'Camera permission was denied. Allow the camera for this site in the browser settings, then tap Try again.'; break;
    case 'NotFoundError': case 'DevicesNotFoundError':
      say = 'No camera was found on this device.'; break;
    case 'NotReadableError': case 'TrackStartError': case 'AbortError':
      say = 'The camera could not be started. Another app may be using it. Close that app and tap Try again.'; break;
    case 'OverconstrainedError': say = 'This camera does not support the requested settings.'; break;
    case 'SecurityError': say = 'The browser blocked the camera on this page. The camera needs https (or localhost).'; break;
    case 'NoMediaDevices': say = 'This page cannot reach the camera. It needs https (or localhost), and a browser that supports it.'; break;
    default: say = 'The camera failed to start.';
  }
  return `${say}\n(${detail})`;
}

/** First video format the browser's MediaRecorder can make. `isSupported` is MediaRecorder.isTypeSupported. */
export function pickMime(isSupported) {
  const list = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  for (const m of list) { try { if (isSupported(m)) return m; } catch { /* try the next */ } }
  return '';
}

export const extFor = mime => (/mp4/.test(mime) ? 'mp4' : 'webm');

export function stampName(ext, d = new Date()) {
  const p = (n, k = 2) => String(n).padStart(k, '0');
  return `vanish-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.${ext}`;
}

export const fmtBytes = n => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);

/** Any thrown value as one line of text. */
export const errText = e => (e?.name && e?.message ? `${e.name}: ${e.message}` : String(e?.message || e));
