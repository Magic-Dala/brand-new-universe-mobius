// Production cancellation/fallback, with actual GLB/image requests held in flight.
// CHROME=<installed chromium> URL=https://localhost:8461 node tests/e2e/forest-lifecycle.e2e.mjs
import { chromium } from 'playwright';
import fs from 'node:fs';
const browser = await chromium.launch({ executablePath: process.env.CHROME, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--ignore-certificate-errors', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 720 } });
const errors = [], results = [];
page.on('pageerror', e => errors.push(e.message));
const assert = (v, text) => { if (!v) throw new Error(text); };
const state = () => page.evaluate(() => {
  const a = window.__mobius, detail = a.worldChase.renderer?.extras, retired = window.__retiredForest;
  return { state: a.state, job: !!a._loadJob, world: !!a.worldChase.renderer, assets: detail?.stats.assets, held: !!detail?._held, retired: retired ? { disposed: retired.disposed, held: retired._held, attached: !!retired.assets, pools: retired.pools.size } : null, memory: { ...a.renderer.info.memory } };
});
try {
  await page.goto(`${process.env.URL || 'https://localhost:8461'}/`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__mobius && !document.getElementById('enter').disabled, null, { timeout: 60000 });
  await page.evaluate(() => { window.__mobius.audioOff = true; });
  // returnHome is the production desktop exit path; unlike startWorld it cancels the loader job.
  for (const mode of ['cancel', 'timeout']) {
    let release; const gate = new Promise(r => { release = r; });
    const handler = async route => { await gate; await route.continue(); };
    await page.route('**/models/forest/**', handler);
    await page.evaluate(() => {
      const a = window.__mobius; a.pendingMap = 'forest'; a.enterDesktop();
    });
    await page.waitForFunction(() => window.__mobius.worldChase.renderer?.extras?.loading, null, { timeout: 15000, polling: 10 });
    const loading = await state(); assert(loading.held, 'loading forest must hold its cache reference');
    if (mode === 'cancel') {
      await page.evaluate(() => { window.__retiredForest = window.__mobius.worldChase.renderer.extras; window.__mobius.returnHome(); });
      const cancelled = await state(); assert(cancelled.state === 'title' && !cancelled.job && !cancelled.world && cancelled.retired.disposed && !cancelled.retired.held, 'returnHome must cancel and release the pending forest');
      release();
      await page.waitForLoadState('networkidle', { timeout: 15000 });
      const late = await state(); assert(late.state === 'title' && !late.world && !late.retired.attached && !late.retired.pools, 'late requests must not resurrect a forest');
      results.push({ mode, loading, cancelled, late });
    } else {
      await page.waitForFunction(() => { const a = window.__mobius; return a.state === 'world' && !a.loader.visible && a.worldChase.renderer?.extras?.stats.assets === 'failed'; }, null, { timeout: 40000 });
      const fallback = await state(); assert(!fallback.held, 'fallback must release the timed-out request');
      release();
      await page.waitForLoadState('networkidle', { timeout: 15000 });
      const late = await state(); assert(late.assets === 'failed' && !late.held, 'late assets must not replace fallback cells');
      results.push({ mode, loading, fallback, late });
      await page.evaluate(() => window.__mobius.returnHome());
    }
    await page.unroute('**/models/forest/**', handler);
  }
  // A fresh normal entry after both cancellation and timeout must acquire a clean, usable cache.
  await page.evaluate(() => {
    const a = window.__mobius; a.pendingMap = 'forest'; a.enterDesktop();
  });
  await page.waitForFunction(() => { const a = window.__mobius; return a.state === 'world' && !a.loader.visible && a.worldChase.renderer?.extras?.stats.assets === 'ready'; }, null, { timeout: 30000 });
  results.push({ mode: 'reentry', ...(await state()) });
  assert(!errors.length, errors.join('\n'));
} finally {
  const output = process.env.OUT || '/private/tmp/mobius-forest-review/coordinator-lifecycle.json';
  fs.writeFileSync(output, JSON.stringify({ errors, results }, null, 2));
  await browser.close();
}
console.log(JSON.stringify({ errors, cases: results.map(r => r.mode) }));
