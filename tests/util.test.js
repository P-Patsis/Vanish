import test from 'node:test';
import assert from 'node:assert/strict';
import { cameraErrorMessage, pickMime, extFor, stampName, fmtBytes, errText } from '../js/util.js';

test('camera errors: friendly text plus the real error name and message', () => {
  const m = cameraErrorMessage({ name: 'NotAllowedError', message: 'Permission denied' });
  assert.match(m, /permission was denied/i); assert.match(m, /NotAllowedError: Permission denied/);
  assert.match(cameraErrorMessage({ name: 'NotFoundError' }), /No camera/);
  assert.match(cameraErrorMessage({ name: 'NotReadableError', message: 'x' }), /another app/i);
  assert.match(cameraErrorMessage({ name: 'NoMediaDevices' }), /https/);
  const odd = cameraErrorMessage(new Error('boom')); assert.match(odd, /Error: boom/);
  assert.doesNotThrow(() => cameraErrorMessage(undefined));
});

test('pickMime: first supported wins, tolerates a throwing probe, empty when none', () => {
  assert.equal(pickMime(m => m === 'video/webm;codecs=vp9'), 'video/webm;codecs=vp9');
  assert.equal(pickMime(() => true), 'video/mp4;codecs=avc1');
  assert.equal(pickMime(() => false), '');
  assert.equal(pickMime(m => { if (m.startsWith('video/mp4')) throw new Error('x'); return m === 'video/webm'; }), 'video/webm');
  assert.equal(extFor('video/mp4;codecs=avc1'), 'mp4'); assert.equal(extFor('video/webm'), 'webm');
});

test('file names and sizes', () => {
  assert.equal(stampName('png', new Date(2026, 10, 2, 9, 5, 7)), 'vanish-20261102-090507.png');
  assert.equal(fmtBytes(500), '500 B'); assert.equal(fmtBytes(2048), '2 KB'); assert.equal(fmtBytes(3 * 1048576), '3.0 MB');
  assert.equal(errText(new TypeError('bad')), 'TypeError: bad'); assert.equal(errText('plain'), 'plain');
});
