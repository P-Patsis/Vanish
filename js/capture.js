// Photo, video and GIF capture of the canvas, and handing the result to the user (share sheet or download).
import { pickMime, extFor, stampName } from './util.js';
import { encodeGif } from './gif.js';

export const canvasBlob = (canvas, type = 'image/png', q) => new Promise((res, rej) => canvas.toBlob(b => (b ? res(b) : rej(new Error('The canvas could not be turned into an image.'))), type, q));

export function canShareFile(file) {
  try { return !!(navigator.canShare && navigator.share && navigator.canShare({ files: [file] })); } catch { return false; }
}

/** Plain download: works everywhere. */
export function download(blob, name) {
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name; a.rel = 'noopener'; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export async function share(blob, name) {
  const file = new File([blob], name, { type: blob.type });
  await navigator.share({ files: [file], title: 'Vanish' });
}

/** Records the canvas as it is drawn. stop() resolves with { blob, name }. */
export class VideoRecorder {
  constructor(canvas, fps = 30) {
    if (typeof MediaRecorder === 'undefined' || !canvas.captureStream) throw new Error('This browser cannot record video from a canvas (no MediaRecorder / captureStream).');
    this.mime = pickMime(m => MediaRecorder.isTypeSupported(m));
    this.stream = canvas.captureStream(fps);
    this.rec = new MediaRecorder(this.stream, this.mime ? { mimeType: this.mime, videoBitsPerSecond: 2500000 } : { videoBitsPerSecond: 2500000 });
    this.chunks = []; this.started = 0; this.error = null;
    this.rec.ondataavailable = e => { if (e.data && e.data.size) this.chunks.push(e.data); };
    this.rec.onerror = e => { this.error = e.error || new Error('MediaRecorder error'); };
  }
  start() { this.rec.start(500); this.started = performance.now(); }
  get seconds() { return (performance.now() - this.started) / 1000; }
  stop() {
    return new Promise((res, rej) => {
      this.rec.onstop = () => {
        this.stream.getTracks().forEach(t => t.stop());
        if (this.error) return rej(this.error);
        const type = this.rec.mimeType || this.mime || 'video/webm';
        const blob = new Blob(this.chunks, { type });
        if (!blob.size) return rej(new Error('The recording is empty.'));
        res({ blob, name: stampName(extFor(type)) });
      };
      try { this.rec.state !== 'inactive' ? this.rec.stop() : this.rec.onstop(); } catch (e) { rej(e); }
    });
  }
}

/** Collects small frames of the canvas at a fixed rate, then encodes them as a looping GIF. */
export class GifRecorder {
  constructor(canvas, { width = 240, fps = 10, seconds = 3 } = {}) {
    this.src = canvas; this.fps = fps; this.max = fps * seconds;
    this.w = width; this.h = Math.max(2, Math.round(canvas.height * width / canvas.width));
    this.small = document.createElement('canvas'); this.small.width = this.w; this.small.height = this.h;
    this.ctx = this.small.getContext('2d', { willReadFrequently: true });
    this.frames = []; this.last = 0;
  }
  get progress() { return this.frames.length / this.max; }
  get done() { return this.frames.length >= this.max; }
  /** Call every drawn frame; takes a frame when it is time. */
  tick(now) {
    if (this.done || now - this.last < 1000 / this.fps) return;
    this.last = now;
    this.ctx.drawImage(this.src, 0, 0, this.w, this.h);
    this.frames.push(this.ctx.getImageData(0, 0, this.w, this.h).data);
  }
  async encode() {
    await new Promise(r => setTimeout(r, 20));   // let the "encoding" message paint first
    const bytes = encodeGif(this.frames, this.w, this.h, Math.round(100 / this.fps));
    return { blob: new Blob([bytes], { type: 'image/gif' }), name: stampName('gif') };
  }
}
