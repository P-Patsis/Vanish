// One frame of the effect, without any DOM: smooth the person mask, feather it, learn the background where the person is not,
// and paint the person out. main.js feeds it camera pixels and the resampled mask; tests feed it synthetic scenes.
import { BackgroundModel, boxBlur, emaMask, makeFeatherLut } from './bg.js';

export const LEARN_SPEEDS = { slow: 4, normal: 8, fast: 20 };   // learning-rate floor out of 256 per frame

export class Engine {
  constructor(w, h, { learn = 'normal' } = {}) {
    this.w = w; this.h = h;
    this.model = new BackgroundModel(w, h, LEARN_SPEEDS[learn] ?? LEARN_SPEEDS.normal);
    const n = w * h;
    this.smooth = new Uint8Array(n);   // mask after temporal smoothing
    this.soft = new Uint8Array(n);     // blurred: the feathered edge
    this.wide = new Uint8Array(n);     // blurred more: "how close is the person", gates learning
    this.alpha = new Uint8Array(n);    // final person opacity used to paint over
    this.tmp = new Uint8Array(n);
    this.edgeR = Math.max(2, Math.round(w / 120));    // 4 px at 480 wide: the soft edge is about 2x this wide
    this.keepAway = Math.max(2, Math.round(w / 48));  // learn nothing within about this many px of the person
    this.lut = makeFeatherLut(20, 200);
    this.temporal = 192;               // 0..256: share of the new mask taken each frame (less = steadier, more = less lag)
    this.learning = true;
  }

  setLearn(name) { this.model.setFloor(LEARN_SPEEDS[name] ?? LEARN_SPEEDS.normal); }

  /**
   * @param frame RGBA of the camera picture
   * @param rawMask person mask bytes (w*h), or null when the segmenter gave nothing this frame (then nothing is learned or painted)
   * @param out RGBA to write
   */
  step(frame, rawMask, out) {
    if (!rawMask) { out.set(frame.subarray(0, out.length)); this.alpha.fill(0); return; }
    emaMask(this.smooth, rawMask, this.temporal);
    boxBlur(this.smooth, this.soft, this.tmp, this.w, this.h, this.edgeR);
    const { alpha, soft, lut } = this;
    for (let i = 0; i < alpha.length; i++) alpha[i] = lut[soft[i]];
    if (this.learning) {
      boxBlur(soft, this.wide, this.tmp, this.w, this.h, this.keepAway);
      this.model.update(frame, this.wide, 6);
    }
    this.model.composite(frame, alpha, out);
  }
}
