import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeGif, quantize } from '../js/gif.js';

/** Independent GIF reader: walks the blocks and LZW-decodes every frame back to palette indices. */
function decodeGif(b) {
  assert.equal(String.fromCharCode(...b.slice(0, 6)), 'GIF89a');
  const w = b[6] | (b[7] << 8), h = b[8] | (b[9] << 8);
  let p = 13 + 768; const frames = []; let delays = [];
  while (b[p] !== 0x3B) {
    if (b[p] === 0x21) {
      if (b[p + 1] === 0xF9) delays.push(b[p + 4] | (b[p + 5] << 8));
      p += 2; while (b[p]) p += b[p] + 1; p++;
    } else if (b[p] === 0x2C) {
      p += 10; const min = b[p++]; const data = [];
      while (b[p]) { for (let i = 0; i < b[p]; i++) data.push(b[p + 1 + i]); p += b[p] + 1; }
      p++;
      frames.push(lzwDecode(min, data, w * h));
    } else throw new Error('bad block 0x' + b[p].toString(16) + ' at ' + p);
  }
  return { w, h, frames, delays };
}
function lzwDecode(min, data, want) {
  const CLEAR = 1 << min, EOI = CLEAR + 1; let bits = min + 1, next = EOI + 1, table = [], prev = null;
  const out = []; let cur = 0, nb = 0, di = 0;
  const reset = () => { table = []; for (let i = 0; i < CLEAR; i++) table[i] = [i]; table[CLEAR] = null; table[EOI] = null; next = EOI + 1; bits = min + 1; prev = null; };
  reset();
  for (;;) {
    while (nb < bits) { if (di >= data.length) return Uint8Array.from(out); cur |= data[di++] << nb; nb += 8; }
    const code = cur & ((1 << bits) - 1); cur >>>= bits; nb -= bits;
    if (code === CLEAR) { reset(); continue; }
    if (code === EOI) break;
    let entry;
    if (code < next) entry = table[code]; else if (prev) entry = [...prev, prev[0]]; else throw new Error('bad code');
    out.push(...entry);
    if (prev) { table[next++] = [...prev, entry[0]]; if (next === (1 << bits) && bits < 12) bits++; }
    prev = entry;
  }
  assert.equal(out.length, want);
  return Uint8Array.from(out);
}

function noisyFrame(w, h, seed) {
  const f = new Uint8ClampedArray(w * h * 4); let s = seed;
  for (let i = 0; i < w * h; i++) { s = (s * 1103515245 + 12345) >>> 0; f[i * 4] = (s >> 8) & 255; f[i * 4 + 1] = (i % w) * 3; f[i * 4 + 2] = (s >> 16) & 255; f[i * 4 + 3] = 255; }
  return f;
}

test('GIF: decodes back to exactly the palette indices (noise stresses the 4096-code table reset)', () => {
  const w = 120, h = 90, frames = [noisyFrame(w, h, 1), noisyFrame(w, h, 2)];
  const gif = decodeGif(encodeGif(frames, w, h, 10));
  assert.equal(gif.w, w); assert.equal(gif.h, h); assert.equal(gif.frames.length, 2);
  assert.deepEqual(gif.delays, [10, 10]);
  frames.forEach((f, i) => assert.deepEqual(gif.frames[i], quantize(f, w, h)));
});

test('GIF: flat colour compresses well and still round-trips; ends with the trailer', () => {
  const w = 64, h = 64, f = new Uint8ClampedArray(w * h * 4).fill(255);
  const bytes = encodeGif([f, f, f], w, h, 5);
  assert.equal(bytes[bytes.length - 1], 0x3B);
  assert.ok(bytes.length < 3000, `${bytes.length} bytes`);
  const g = decodeGif(bytes); assert.equal(g.frames.length, 3);
  assert.deepEqual(g.frames[0], quantize(f, w, h));
});

test('GIF: odd sizes work', () => {
  const w = 37, h = 23, f = noisyFrame(w, h, 7);
  assert.deepEqual(decodeGif(encodeGif([f], w, h)).frames[0], quantize(f, w, h));
});

test('quantize: white and black land on the palette ends', () => {
  const px = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]);
  const q = quantize(px, 2, 1); assert.equal(q[0], 255); assert.equal(q[1], 0);
});
