import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { shellFiles, versionFor } from '../tools/stamp.mjs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('sw.js VERSION is stamped from the current files (run: node tools/stamp.mjs)', () => {
  assert.equal(read('sw.js').match(/const VERSION = '([^']*)'/)[1], versionFor());
});

test('every precached file exists', () => {
  for (const f of shellFiles()) assert.ok(existsSync(new URL('../' + f, import.meta.url)), f + ' is listed in SHELL but missing');
});

test('every script, stylesheet and module the page loads is precached', () => {
  const shell = new Set(shellFiles());
  const html = read('index.html');
  for (const m of html.matchAll(/(?:src|href)="([^":]+)"/g)) assert.ok(shell.has(m[1]) || m[1] === 'manifest.webmanifest', m[1] + ' is not in SHELL');
  for (const f of shellFiles().filter(f => f.startsWith('js/'))) {
    for (const m of read(f).matchAll(/from '\.\/([^']+)'/g)) assert.ok(shell.has('js/' + m[1]), `${f} imports ${m[1]}, which is not in SHELL`);
  }
});

test('the service worker updates itself: skipWaiting, clients.claim, network-first, never cache-first for our own files', () => {
  const sw = read('sw.js');
  assert.match(sw, /skipWaiting\(\)/); assert.match(sw, /clients\.claim\(\)/); assert.match(sw, /cache: 'no-cache'/); assert.match(sw, /cache: 'reload'/);
  assert.match(read('js/pwa.js'), /updateViaCache: 'none'/); assert.match(read('js/pwa.js'), /controllerchange/);
});

test('manifest: installable (name, start_url, standalone, 192 + 512 icons that exist)', () => {
  const m = JSON.parse(read('manifest.webmanifest'));
  assert.ok(m.name && m.start_url && m.display === 'standalone');
  const sizes = m.icons.map(i => i.sizes); assert.ok(sizes.includes('192x192') && sizes.includes('512x512'));
  for (const i of m.icons) assert.ok(existsSync(new URL('../' + i.src, import.meta.url)), i.src);
});
