// Captures README screenshots from the mock engine with the locally installed Edge.
// Usage: start `npm run dev:mock -- --port 5174`, then `node scripts/screenshots.mjs [baseUrl]`.
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const base = process.argv[2] ?? 'http://localhost:5174';
const outDir = new URL('../../docs/screenshots/', import.meta.url);
await mkdir(outDir, { recursive: true });

const shots = [
  { name: 'dashboard', path: '/', lang: 'en', theme: 'navy-teal' },
  { name: 'pipeline', path: '/pipeline', lang: 'en', theme: 'navy-teal' },
  { name: 'appearance', path: '/settings/appearance', lang: 'en', theme: 'navy-teal' },
  { name: 'connections', path: '/connections', lang: 'en', theme: 'navy-teal' },
  { name: 'dashboard-es-daylight', path: '/', lang: 'es', theme: 'daylight' },
];

const browser = await chromium.launch({ channel: 'msedge' });
for (const s of shots) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
  });
  await context.addInitScript(
    ([lang, theme]) => {
      const set = (k, v) => localStorage.setItem('levelset.' + k, JSON.stringify(v));
      set('language', lang);
      set('theme.activeId', theme);
      set('onboarding.completed', true);
      set('disclaimer.acceptedAt', '2026-10-19T14:00:00Z');
    },
    [s.lang, s.theme],
  );
  const page = await context.newPage();
  await page.goto(base + s.path, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const file = fileURLToPath(new URL(`${s.name}.png`, outDir));
  await page.screenshot({ path: file });
  console.log('saved', file);
  await context.close();
}
await browser.close();
