import test from 'node:test';
import assert from 'node:assert/strict';
import { fitSize, resampleMask, boxBlur, emaMask, makeFeatherLut, orientVote, BackgroundModel } from '../js/bg.js';
import { Engine } from '../js/engine.js';

const W = 96, H = 72;

/** A scene: a gradient wall with a red box at fixed place, optionally a green "person" rectangle covering x0..x0+pw. */
function scene(w, h, person = null, light = 0) {
  const f = new Uint8ClampedArray(w * h * 4), m = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, p = i * 4;
    let r = 40 + x + light, g = 80 + y + light, b = 120 + light;
    if (x > 70 && y > 50) { r = 200; g = 30; b = 30; }
    if (person && x >= person.x0 && x < person.x0 + person.w && y >= 10 && y < h - 8) { r = 20; g = 220; b = 20; m[i] = 255; }
    f[p] = r; f[p + 1] = g; f[p + 2] = b; f[p + 3] = 255;
  }
  return { f, m };
}
const px = (a, w, x, y) => [a[(y * w + x) * 4], a[(y * w + x) * 4 + 1], a[(y * w + x) * 4 + 2]];
const near = (a, b, tol) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

test('fitSize keeps aspect, caps the long side, never upsizes, gives even numbers', () => {
  assert.deepEqual(fitSize(1280, 720, 480), { w: 480, h: 270 });
  assert.deepEqual(fitSize(720, 1280, 480), { w: 270, h: 480 });
  assert.deepEqual(fitSize(320, 240, 480), { w: 320, h: 240 });
  const s = fitSize(641, 481, 480); assert.equal(s.w % 2, 0); assert.equal(s.h % 2, 0);
});

test('resampleMask: scales, flips and inverts', () => {
  const src = new Float32Array([0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1]);   // 4x4, right half person
  const d = new Uint8Array(8 * 8);
  resampleMask(src, 4, 4, d, 8, 8);
  assert.equal(d[0], 0); assert.equal(d[7], 255);
  resampleMask(src, 4, 4, d, 8, 8, { flip: true });
  assert.equal(d[0], 255); assert.equal(d[7], 0);
  resampleMask(src, 4, 4, d, 8, 8, { invert: true });
  assert.equal(d[0], 255); assert.equal(d[7], 0);
  resampleMask(new Float32Array([-0.5, 1.5, 0.5, 0.5]), 2, 2, d, 2, 2);   // out-of-range model values are clamped
  assert.deepEqual([...d.slice(0, 2)], [0, 255]);
});

test('boxBlur: flat stays flat, an impulse spreads, total is kept', () => {
  const w = 20, h = 20, a = new Uint8Array(w * h).fill(100), o = new Uint8Array(w * h), t = new Uint8Array(w * h);
  boxBlur(a, o, t, w, h, 3); assert.ok(o.every(v => v === 100));
  a.fill(0); a[10 * w + 10] = 255;
  boxBlur(a, o, t, w, h, 2);
  assert.ok(o[10 * w + 10] > 0 && o[10 * w + 10] < 255); assert.equal(o[10 * w + 13], 0);
  assert.ok(o[10 * w + 12] > 0);
  const r0 = new Uint8Array(w * h); boxBlur(a, r0, t, w, h, 0); assert.deepEqual(r0, a);
});

test('emaMask: moves toward the new mask and settles exactly', () => {
  const p = new Uint8Array([0, 255, 100]), c = new Uint8Array([255, 255, 101]);
  emaMask(p, c, 128);
  assert.equal(p[0], 127); assert.equal(p[1], 255); assert.equal(p[2], 101);
  for (let i = 0; i < 12; i++) emaMask(p, c, 128);
  assert.equal(p[0], 255);
});

test('feather LUT: 0 below lo, 255 above hi, monotonic', () => {
  const l = makeFeatherLut(30, 140);
  assert.equal(l[0], 0); assert.equal(l[30], 0); assert.equal(l[140], 255); assert.equal(l[255], 255);
  for (let i = 1; i < 256; i++) assert.ok(l[i] >= l[i - 1]);
});

test('orientVote: person in the middle = +1, the inverse = -1, empty = 0', () => {
  const w = 60, h = 60, m = new Uint8Array(w * h);
  assert.equal(orientVote(m, w, h), 0);
  for (let y = 15; y < 45; y++) for (let x = 20; x < 40; x++) m[y * w + x] = 255;
  assert.equal(orientVote(m, w, h), 1);
  for (let i = 0; i < m.length; i++) m[i] = 255 - m[i];
  assert.equal(orientVote(m, w, h), -1);
});

test('BackgroundModel: first sight is copied, then it follows slowly but always moves', () => {
  const m = new BackgroundModel(2, 1, 8);
  const gate = new Uint8Array(2);
  m.update(new Uint8ClampedArray([100, 100, 100, 255, 10, 20, 30, 255]), gate, 0);
  assert.deepEqual([...m.bg.slice(0, 3)], [100, 100, 100]);
  assert.equal(m.coverage(), 1);
  const f = new Uint8ClampedArray([102, 100, 100, 255, 10, 20, 30, 255]);
  for (let i = 0; i < 50; i++) m.update(f, gate, 0);
  assert.equal(m.bg[0], 102);   // a 2-level drift is followed fully, not stuck by rounding
});

test('BackgroundModel: pixels the gate blocks are not learned; reset forgets', () => {
  const m = new BackgroundModel(2, 1, 8);
  m.update(new Uint8ClampedArray([9, 9, 9, 255, 9, 9, 9, 255]), new Uint8Array([0, 255]), 6);
  assert.equal(m.n[0], 1); assert.equal(m.n[1], 0); assert.equal(m.coverage(), 0.5);
  m.reset(); assert.equal(m.coverage(), 0);
});

test('BackgroundModel: a big change is relearned fast', () => {
  const m = new BackgroundModel(1, 1, 8), gate = new Uint8Array(1);
  const a = new Uint8ClampedArray([50, 50, 50, 255]), b = new Uint8ClampedArray([200, 200, 200, 255]);
  for (let i = 0; i < 100; i++) m.update(a, gate, 0);
  let frames = 0; while (m.bg[0] < 195 && frames < 100) { m.update(b, gate, 0); frames++; }
  assert.ok(frames < 25, `took ${frames} frames`);
});

test('composite: alpha 0 shows the frame, 255 the background, unknown background shows the frame', () => {
  const m = new BackgroundModel(3, 1, 8);
  m.bg.set([0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255]); m.n.set([5, 5, 0]);
  const frame = new Uint8ClampedArray([200, 200, 200, 255, 200, 200, 200, 255, 200, 200, 200, 255]);
  const out = new Uint8ClampedArray(12);
  m.composite(frame, new Uint8Array([0, 255, 255]), out);
  assert.equal(out[0], 200); assert.equal(out[4], 0); assert.equal(out[8], 200);
  m.composite(frame, new Uint8Array([128, 0, 0]), out);
  assert.ok(out[0] > 90 && out[0] < 110);
});

test('Engine: a person who walks across an empty room is painted out, using background learned while they moved', () => {
  const e = new Engine(W, H), out = new Uint8ClampedArray(W * H * 4);
  // nobody for 20 frames, then a person walks in from the left and across; the room behind the person is only ever seen in pieces
  for (let t = 0; t < 20; t++) { const s = scene(W, H); e.step(s.f, s.m, out); }
  for (let x0 = -20; x0 < W; x0 += 3) { const s = scene(W, H, { x0, w: 20 }); e.step(s.f, s.m, out); }
  // the person stands in the middle: they must be invisible, the wall + red box intact
  const s = scene(W, H, { x0: 40, w: 20 });
  for (let k = 0; k < 6; k++) e.step(s.f, s.m, out);
  const clean = scene(W, H).f;
  for (const [x, y] of [[50, 30], [45, 20], [55, 60], [50, 40]]) assert.ok(near(px(out, W, x, y), px(clean, W, x, y), 6), `pixel ${x},${y}: ${px(out, W, x, y)} vs ${px(clean, W, x, y)}`);
  assert.ok(px(out, W, 50, 30)[1] < 200, 'no green person left');
  assert.ok(e.model.coverage() > 0.99);
});

test('Engine: standing still from the start leaves the person visible (nothing known behind them) and says so via coverage', () => {
  const e = new Engine(W, H), out = new Uint8ClampedArray(W * H * 4);
  const s = scene(W, H, { x0: 40, w: 20 });
  for (let k = 0; k < 10; k++) e.step(s.f, s.m, out);
  assert.deepEqual(px(out, W, 50, 30), [20, 220, 20]);
  assert.ok(e.model.coverage() < 0.9 && e.model.coverage() > 0.6);
});

test('Engine: the person is not learned into the background while they stand still', () => {
  const e = new Engine(W, H), out = new Uint8ClampedArray(W * H * 4);
  for (let t = 0; t < 20; t++) { const s = scene(W, H); e.step(s.f, s.m, out); }
  const s = scene(W, H, { x0: 40, w: 20 });
  for (let k = 0; k < 200; k++) e.step(s.f, s.m, out);
  assert.ok(px(out, W, 50, 30)[1] < 200, 'still invisible after 200 frames of standing still');
});

test('Engine: follows lighting drift in the visible background; what is hidden behind a still person keeps its old value (cannot be seen)', () => {
  const e = new Engine(W, H), out = new Uint8ClampedArray(W * H * 4);
  for (let t = 0; t < 20; t++) { const s = scene(W, H); e.step(s.f, s.m, out); }
  for (let t = 0; t <= 60; t++) { const s = scene(W, H, { x0: 40, w: 20 }, Math.round(t / 3)); e.step(s.f, s.m, out); }   // +20 brightness
  const want = px(scene(W, H, null, 20).f, W, 10, 30), got = px(out, W, 10, 30);
  assert.ok(near(got, want, 4), `visible: ${got} vs ${want}`);
  assert.ok(near(px(out, W, 50, 30), px(scene(W, H).f, W, 50, 30), 8), 'hidden area still shows the old, unbrightened wall');
});

test('Engine: a frame with no mask passes the camera through and learns nothing', () => {
  const e = new Engine(W, H), out = new Uint8ClampedArray(W * H * 4), s = scene(W, H);
  e.step(s.f, null, out);
  assert.deepEqual(out, s.f); assert.equal(e.model.coverage(), 0);
});

test('Engine: edges are feathered, not a hard cut', () => {
  const e = new Engine(W, H), out = new Uint8ClampedArray(W * H * 4);
  for (let t = 0; t < 20; t++) { const s = scene(W, H); e.step(s.f, s.m, out); }
  const s = scene(W, H, { x0: 40, w: 20 });
  for (let k = 0; k < 6; k++) e.step(s.f, s.m, out);
  const row = 30, edge = [];
  for (let x = 30; x < 42; x++) edge.push(e.alpha[row * W + x]);
  const mid = edge.filter(v => v > 0 && v < 255).length;
  assert.ok(mid >= 3, `only ${mid} soft pixels: ${edge}`);
});
