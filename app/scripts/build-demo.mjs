// Static web demo for GitHub Pages: the UI against the in-browser mock engine.
//   npm run build:demo                     -> dist-demo/ for https://<user>.github.io/Levelset/
//   VITE_BASE=/other/ npm run build:demo   -> another sub-path ("/" for a root domain)
// Flags: VITE_MOCK=1 (MSW mock engine), VITE_ROUTER=hash (no server rewrites needed),
// VITE_BASE (sub-path; also where mockServiceWorker.js is served and its scope).
import { writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { build } from 'vite';

const root = path.resolve(import.meta.dirname, '..');
let base = process.env.VITE_BASE || '/Levelset/';
if (!base.startsWith('/')) base = `/${base}`;
if (!base.endsWith('/')) base = `${base}/`;

process.env.VITE_MOCK = '1';
process.env.VITE_ROUTER = 'hash';
process.env.VITE_BASE = base;

const outDir = path.join(root, 'dist-demo');
await build({ root, mode: 'mock', base, build: { outDir, emptyOutDir: true } });

if (!existsSync(path.join(outDir, 'mockServiceWorker.js'))) {
  throw new Error('mockServiceWorker.js missing from dist-demo (expected from public/)');
}
// GitHub Pages: skip Jekyll processing
writeFileSync(path.join(outDir, '.nojekyll'), '');
console.log(`demo build ready: ${path.relative(root, outDir)} (base ${base})`);
