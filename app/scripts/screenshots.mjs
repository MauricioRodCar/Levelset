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
  { name: 'paper', path: '/paper', lang: 'en', theme: 'navy-teal' },
  { name: 'analyst', path: '/analyst', lang: 'en', theme: 'navy-teal', prepare: analystTsla },
  { name: 'congress', path: '/pelosi', lang: 'en', theme: 'navy-teal' },
  { name: 'ai', path: '/settings/ai', lang: 'en', theme: 'navy-teal', prepare: aiChat },
];

/** Analyst: look up TSLA (the page starts with an empty search). */
async function analystTsla(page) {
  const box = page.getByRole('searchbox').or(page.getByRole('textbox')).first();
  await box.fill('TSLA');
  await box.press('Enter');
}

/** AI: switch it on in Settings (the mock keeps state per page load), open the chat on the
 * pipeline and ask a question the mock answers from the demo ticket. */
async function aiChat(page) {
  await page.getByRole('switch', { name: 'Use the AI assistant' }).click();
  await page.waitForTimeout(500);
  await page
    .getByRole('link', { name: /Pipeline/ })
    .first()
    .click();
  await page.getByTestId('ai-toggle').click();
  const box = page.getByPlaceholder(/Ask about your tickets/);
  await box.fill('How much does my TSLA ticket risk at the stop?');
  await box.press('Enter');
}

const browser = await chromium.launch({ channel: 'msedge' });
for (const s of shots) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    locale: s.lang === 'es' ? 'es-MX' : 'en-US',
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
  if (s.prepare) {
    await s.prepare(page);
    await page.waitForTimeout(2000);
  }
  const file = fileURLToPath(new URL(`${s.name}.png`, outDir));
  await page.screenshot({ path: file });
  console.log('saved', file);
  await context.close();
}
await browser.close();
