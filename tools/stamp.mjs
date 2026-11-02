// Writes the cache version into sw.js: a hash of every precached file, so ANY change to the app changes the version.
// Run `node tools/stamp.mjs` before committing (tests/sw.test.js fails if you forget).
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const root = new URL('../', import.meta.url);
export function shellFiles() {
  const sw = readFileSync(new URL('sw.js', root), 'utf8');
  const list = sw.match(/const SHELL = \[([\s\S]*?)\];/)[1];
  return [...list.matchAll(/'([^']+)'/g)].map(m => m[1]).map(p => (p === './' ? 'index.html' : p));
}
export function versionFor() {
  const h = createHash('sha1');
  for (const f of [...new Set(shellFiles())].sort()) { h.update(f); h.update(readFileSync(new URL(f, root))); }
  return 'vn-' + h.digest('hex').slice(0, 8);
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const p = new URL('sw.js', root);
  const sw = readFileSync(p, 'utf8');
  writeFileSync(p, sw.replace(/const VERSION = '[^']*';/, `const VERSION = '${versionFor()}';`));
  console.log('sw.js VERSION =', versionFor());
}
