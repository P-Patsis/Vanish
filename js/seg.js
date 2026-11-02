// MediaPipe person segmentation (tasks-vision ImageSegmenter, selfie model, ~250 KB) loaded lazily from the CDN.
// The runtime (~9 MB wasm) is downloaded once and kept by the service worker.
export const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
export const MODEL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite';

export class Segmenter {
  constructor() { this.seg = null; this.delegate = null; this.make = null; this.personIndex = 1; this.maskCount = 0; this.labels = []; }

  async load() {
    if (this.seg) return;
    const mod = await import(MP + '/vision_bundle.mjs');
    const fileset = await mod.FilesetResolver.forVisionTasks(MP + '/wasm');
    this.make = delegate => mod.ImageSegmenter.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL, delegate }, runningMode: 'VIDEO', outputConfidenceMasks: true, outputCategoryMask: false });
    try { this.seg = await this.make('GPU'); this.delegate = 'GPU'; } catch { this.seg = await this.make('CPU'); this.delegate = 'CPU'; }
    try { this.labels = this.seg.getLabels?.() || []; } catch { this.labels = []; }
  }

  /** Some phones create the GPU delegate fine and then fail on the first frame: switch to CPU once. Returns true if it switched. */
  async fallbackToCpu() {
    if (this.delegate !== 'GPU' || !this.make) return false;
    try { this.seg?.close?.(); } catch { /* ignore */ }
    this.delegate = 'CPU'; this.seg = await this.make('CPU');
    return true;
  }

  /**
   * Segments one video frame. Calls `use(floats, w, h)` with the person-probability mask (0..1) and returns true,
   * or returns false if the model produced no mask.
   * With two masks (background, person) the person one is used; a single mask is taken as person and main.js checks its orientation.
   */
  segment(video, tsMs, use) {
    let ok = false;
    this.seg.segmentForVideo(video, tsMs, result => {
      const masks = result?.confidenceMasks;
      if (!masks || !masks.length) return;
      this.maskCount = masks.length;
      const i = masks.length > 1 ? this.personIndex : 0;
      const m = masks[i];
      use(m.getAsFloat32Array(), m.width, m.height);
      ok = true;
      for (const x of masks) x.close?.();
    });
    return ok;
  }

  close() { try { this.seg?.close?.(); } catch { /* ignore */ } this.seg = null; }
}
