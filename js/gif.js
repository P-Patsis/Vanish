// A small GIF encoder (no library): fixed 3-3-2 colour palette with ordered dithering, LZW, looping animation.
// A fixed palette costs no time for colour quantising, which is what makes GIF slow on a phone. About 3 KB of code.

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** RGBA -> palette indices (3 bits red, 3 green, 2 blue) with a 4x4 ordered dither. */
export function quantize(rgba, w, h, out = new Uint8Array(w * h)) {
  for (let y = 0, i = 0; y < h; y++) {
    for (let x = 0; x < w; x++, i++) {
      const m = (BAYER[(y & 3) * 4 + (x & 3)] - 7.5) / 16, p = i * 4;
      const r = Math.round(Math.min(255, Math.max(0, rgba[p] + m * 36)) * 7 / 255);
      const g = Math.round(Math.min(255, Math.max(0, rgba[p + 1] + m * 36)) * 7 / 255);
      const b = Math.round(Math.min(255, Math.max(0, rgba[p + 2] + m * 85)) * 3 / 255);
      out[i] = (r << 5) | (g << 2) | b;
    }
  }
  return out;
}

function palette() {
  const p = new Uint8Array(768);
  for (let i = 0; i < 256; i++) { p[i * 3] = Math.round(((i >> 5) & 7) * 255 / 7); p[i * 3 + 1] = Math.round(((i >> 2) & 7) * 255 / 7); p[i * 3 + 2] = Math.round((i & 3) * 255 / 3); }
  return p;
}

class Bytes {
  constructor() { this.a = new Uint8Array(1 << 16); this.n = 0; }
  push(...v) { for (const b of v) this.byte(b); }
  byte(b) { if (this.n === this.a.length) { const t = new Uint8Array(this.n * 2); t.set(this.a); this.a = t; } this.a[this.n++] = b; }
  u16(v) { this.byte(v & 255); this.byte(v >> 8); }
  bytes(arr) { for (let i = 0; i < arr.length; i++) this.byte(arr[i]); }
  done() { return this.a.slice(0, this.n); }
}

/** LZW with 8-bit symbols, packed into GIF sub-blocks of at most 255 bytes. */
export function lzw(indices, out) {
  const MIN = 8, CLEAR = 1 << MIN, EOI = CLEAR + 1, HS = 1 << 14;
  const keys = new Int32Array(HS), vals = new Int32Array(HS);
  let next = EOI + 1, bits = MIN + 1, cur = 0, nbits = 0;
  const block = new Uint8Array(255); let bn = 0;
  const flush = () => { if (bn) { out.byte(bn); out.bytes(block.subarray(0, bn)); bn = 0; } };
  const emit = code => {
    cur |= code << nbits; nbits += bits;
    while (nbits >= 8) { block[bn++] = cur & 255; cur >>>= 8; nbits -= 8; if (bn === 255) flush(); }
  };
  const resetTable = () => { keys.fill(-1); next = EOI + 1; bits = MIN + 1; };
  out.byte(MIN);
  resetTable(); emit(CLEAR);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const c = indices[i], key = (prefix << 8) | c;
    let h = Math.imul(key, 2654435761) >>> 18;           // 14 bits
    let hit = -1;
    while (keys[h] !== -1) { if (keys[h] === key) { hit = vals[h]; break; } h = (h + 1) & (HS - 1); }
    if (hit >= 0) { prefix = hit; continue; }
    emit(prefix);
    if (next === 4096) { emit(CLEAR); resetTable(); }
    else { if (next >= (1 << bits)) bits++; keys[h] = key; vals[h] = next++; }
    prefix = c;
  }
  emit(prefix); emit(EOI);
  if (nbits > 0) block[bn++] = cur & 255;
  flush();
  out.byte(0);
}

/**
 * @param frames array of RGBA Uint8ClampedArray, each w*h*4
 * @param delayCs delay between frames in hundredths of a second (10 = 10 fps)
 * @returns Uint8Array of the .gif file
 */
export function encodeGif(frames, w, h, delayCs = 10) {
  const o = new Bytes();
  o.push(0x47, 0x49, 0x46, 0x38, 0x39, 0x61);                  // GIF89a
  o.u16(w); o.u16(h); o.push(0xF7, 0, 0);                      // global 256-colour table
  o.bytes(palette());
  o.push(0x21, 0xFF, 0x0B, 0x4E, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2E, 0x30, 3, 1, 0, 0, 0);   // loop forever
  const idx = new Uint8Array(w * h);
  for (const f of frames) {
    quantize(f, w, h, idx);
    o.push(0x21, 0xF9, 4, 0x04); o.u16(delayCs); o.push(0, 0);  // frame delay, keep previous frame underneath
    o.push(0x2C); o.u16(0); o.u16(0); o.u16(w); o.u16(h); o.push(0);
    lzw(idx, o);
  }
  o.byte(0x3B);
  return o.done();
}
