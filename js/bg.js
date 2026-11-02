// Pure pixel logic for Vanish (no DOM, so node can test it): the learned background and the mask helpers.
// Pixels are RGBA bytes (canvas ImageData). Masks are one byte per pixel: 0 = background, 255 = person.

/** Fit a source size inside `longSide` pixels on the long edge, keeping the aspect ratio. Even numbers (video encoders like them). */
export function fitSize(sw, sh, longSide) {
  const s = Math.min(1, longSide / Math.max(sw, sh));
  return { w: Math.max(2, Math.round(sw * s / 2) * 2), h: Math.max(2, Math.round(sh * s / 2) * 2) };
}

/**
 * Bilinear resample of the model's float mask (0..1, sw x sh) to bytes (dw x dh).
 * flip = mirror left/right (selfie view); invert = swap person and background.
 */
export function resampleMask(src, sw, sh, dst, dw, dh, { flip = false, invert = false } = {}) {
  const x0 = new Int32Array(dw), x1 = new Int32Array(dw), wx = new Float32Array(dw);
  for (let x = 0; x < dw; x++) {
    const sx = flip ? dw - 1 - x : x;
    const f = Math.min(sw - 1, Math.max(0, (sx + 0.5) * sw / dw - 0.5));
    x0[x] = f | 0; x1[x] = Math.min(sw - 1, (f | 0) + 1); wx[x] = f - (f | 0);
  }
  for (let y = 0; y < dh; y++) {
    const f = Math.min(sh - 1, Math.max(0, (y + 0.5) * sh / dh - 0.5));
    const r0 = (f | 0) * sw, r1 = Math.min(sh - 1, (f | 0) + 1) * sw, wy = f - (f | 0);
    const o = y * dw;
    for (let x = 0; x < dw; x++) {
      const a = src[r0 + x0[x]], b = src[r0 + x1[x]], c = src[r1 + x0[x]], d = src[r1 + x1[x]];
      const top = a + (b - a) * wx[x], bot = c + (d - c) * wx[x];
      let v = top + (bot - top) * wy;
      if (invert) v = 1 - v;
      dst[o + x] = v <= 0 ? 0 : v >= 1 ? 255 : (v * 255 + 0.5) | 0;
    }
  }
}

/** Separable box blur with clamped edges. src and dst may not be the same array; tmp is scratch (same size). */
export function boxBlur(src, dst, tmp, w, h, r) {
  if (r <= 0) { dst.set(src); return; }
  const d = 2 * r + 1, half = d >> 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += src[row + Math.min(w - 1, Math.max(0, k))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = ((sum + half) / d) | 0;
      sum += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  const col = new Int32Array(w);
  for (let k = -r; k <= r; k++) { const o = Math.min(h - 1, Math.max(0, k)) * w; for (let x = 0; x < w; x++) col[x] += tmp[o + x]; }
  for (let y = 0; y < h; y++) {
    const o = y * w, add = Math.min(h - 1, y + r + 1) * w, sub = Math.max(0, y - r) * w;
    for (let x = 0; x < w; x++) { dst[o + x] = ((col[x] + half) / d) | 0; col[x] += tmp[add + x] - tmp[sub + x]; }
  }
}

/** Moves `prev` toward `cur` (k256 = how much of the new value to take, 0..256). Tiny differences snap, so nothing lingers at 1-2/255. */
export function emaMask(prev, cur, k256) {
  for (let i = 0; i < prev.length; i++) {
    const d = cur[i] - prev[i];
    prev[i] = (d <= 2 && d >= -2) ? cur[i] : prev[i] + ((d * k256) >> 8);
  }
}

/** Soft edge: smoothstep from lo to hi (byte values). Applied to the BLURRED mask, so it feathers and grows the person slightly. */
export function makeFeatherLut(lo, hi) {
  const lut = new Uint8Array(256);
  for (let v = 0; v < 256; v++) {
    const t = Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
    lut[v] = Math.round(t * t * (3 - 2 * t) * 255);
  }
  return lut;
}

/**
 * Some segmentation models give one mask whose meaning is not obvious. A person is usually in the middle of the picture and
 * the border is background. +1 = this mask looks like "person", -1 = it looks inverted, 0 = cannot tell from this frame.
 */
export function orientVote(mask, w, h) {
  let cs = 0, cn = 0, rs = 0, rn = 0;
  const bx = Math.round(w * 0.15), by = Math.round(h * 0.15);
  for (let y = 0; y < h; y += 4) for (let x = 0; x < w; x += 4) {
    const v = mask[y * w + x];
    if (x >= w / 3 && x < 2 * w / 3 && y >= h / 4 && y < 3 * h / 4) { cs += v; cn++; }
    else if (x < bx || x >= w - bx || y < by || y >= h - by) { rs += v; rn++; }
  }
  if (!cn || !rn) return 0;
  const diff = (cs / cn - rs / rn) / 255;
  return diff > 0.2 ? 1 : diff < -0.2 ? -1 : 0;
}

/**
 * The background the person is painted out with. Per pixel: the colour, and `n` = how many frames it has been learned from.
 * n = 0 means "never seen as background" (the person has been there since the start), so the live pixel is shown instead.
 * The learning rate starts at 1 (first sight is copied) and settles to a floor, so lighting drift and a nudged camera are followed.
 */
export class BackgroundModel {
  constructor(w, h, floor256 = 8) {
    this.w = w; this.h = h;
    this.bg = new Uint8ClampedArray(w * h * 4);
    this.n = new Uint8Array(w * h);
    this.setFloor(floor256);
  }

  setFloor(floor256) {
    this.floor = floor256;
    this.lut = new Uint16Array(256);
    for (let c = 0; c < 256; c++) this.lut[c] = Math.min(256, Math.max(floor256, Math.round(256 / (c + 1))));
  }

  reset() { this.bg.fill(0); this.n.fill(0); }

  /** Quick start: take the whole frame as the background (the user stepped out of view). */
  captureAll(frame, strength = 40) { this.bg.set(frame.subarray(0, this.bg.length)); this.n.fill(strength); }

  /** Learn from every pixel where gate[i] <= gateMax (that is: well away from the person). */
  update(frame, gate, gateMax) {
    const { bg, n, lut } = this;
    for (let i = 0, p = 0; i < n.length; i++, p += 4) {
      if (gate[i] > gateMax) continue;
      const c = n[i];
      if (c === 0) { bg[p] = frame[p]; bg[p + 1] = frame[p + 1]; bg[p + 2] = frame[p + 2]; bg[p + 3] = 255; n[i] = 1; continue; }
      const a = lut[c];
      const dr = frame[p] - bg[p], dg = frame[p + 1] - bg[p + 1], db = frame[p + 2] - bg[p + 2];
      let s;
      if (dr) { s = (dr * a) >> 8; bg[p] += s === 0 ? (dr > 0 ? 1 : -1) : s; }
      if (dg) { s = (dg * a) >> 8; bg[p + 1] += s === 0 ? (dg > 0 ? 1 : -1) : s; }
      if (db) { s = (db * a) >> 8; bg[p + 2] += s === 0 ? (db > 0 ? 1 : -1) : s; }
      // the scene itself changed here (something moved, the camera shifted): forget some history so it is relearned fast
      if (Math.abs(dr) + Math.abs(dg) + Math.abs(db) > 120) n[i] = c > 2 ? c >> 1 : 1;
      else if (c < 255) n[i] = c + 1;
    }
  }

  /** out = frame where alpha is 0 or the background is unknown; the learned background where alpha is 255; blended between. */
  composite(frame, alpha, out) {
    const { bg, n } = this;
    for (let i = 0, p = 0; i < n.length; i++, p += 4) {
      const a = alpha[i];
      if (a === 0 || n[i] === 0) { out[p] = frame[p]; out[p + 1] = frame[p + 1]; out[p + 2] = frame[p + 2]; out[p + 3] = 255; continue; }
      const t = a + (a >> 7);   // 0..256
      out[p] = frame[p] + (((bg[p] - frame[p]) * t) >> 8);
      out[p + 1] = frame[p + 1] + (((bg[p + 1] - frame[p + 1]) * t) >> 8);
      out[p + 2] = frame[p + 2] + (((bg[p + 2] - frame[p + 2]) * t) >> 8);
      out[p + 3] = 255;
    }
  }

  /** Share of pixels with a learned background, 0..1. */
  coverage() { let k = 0; for (let i = 0; i < this.n.length; i++) if (this.n[i]) k++; return k / this.n.length; }
}
