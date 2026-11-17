// Real immersive-session code path via the installed IWER runtime. NOT a physical Quest FPS benchmark.
import { chromium } from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const output = process.env.OUT || '/private/tmp/mobius-forest-performance/immersive-before.json';
const browser = await chromium.launch({ executablePath: process.env.CHROME, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--ignore-certificate-errors', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 720 } });
const errors = [], warnings = [], views = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') warnings.push(m.text()); });
const runtime = fs.readFileSync(new URL('../../node_modules/iwer/build/iwer.js', import.meta.url), 'utf8');
await page.addInitScript({ content: `${runtime}\nwindow.__forestXR = new IWER.XRDevice(IWER.metaQuest3, {stereoEnabled:true}); window.__forestXR.installRuntime({forceInstall:true}); window.__forestXR.controlMode='programmatic';` });
try {
  await page.goto(process.env.URL || 'https://localhost:8463/', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__mobius && !document.getElementById('enter').disabled, null, { timeout: 60000 });
  await page.evaluate(() => { const a = window.__mobius; a.audioOff = true; a.pendingMap = 'forest'; a.enterXR(); });
  await page.waitForFunction(() => { const a = window.__mobius; return a.renderer.xr.isPresenting && a.state === 'world' && !a.loader.visible && a.worldChase.renderer?.extras?.stats.assets === 'ready'; }, null, { timeout: 60000 });
  await page.evaluate(() => window.__mobius.worldChase.pause());
  for (const heading of [0, 60, 120, 180, 240, 300, 0]) {
    await page.evaluate(angle => { const h = angle * Math.PI / 360; window.__forestXR.quaternion.set(0, Math.sin(h), 0, Math.cos(h)); }, heading);
    await page.waitForTimeout(200);
    views.push(await page.evaluate(heading => {
      const a = window.__mobius, r = a.renderer, c = r.xr.getCamera(), d = a.worldChase.renderer.extras;
      return { heading, presenting: r.xr.isPresenting, eyes: c.cameras.length, quality: d.stats.quality, stats: { ...d.stats }, calls: r.info.render.calls, tris: r.info.render.triangles, geo: r.info.memory.geometries, tex: r.info.memory.textures, matrices: c.cameras.map(e => ({ position: e.matrixWorld.elements.slice(12, 15), projection: e.projectionMatrix.elements.slice() })) };
    }, heading));
  }
  assert.ok(views.every(v => v.presenting && v.eyes === 2), 'immersive renderer receives two actual IWER eye cameras');
  if (process.env.EXPECT_QUALITY) assert.ok(views.every(v => v.quality === process.env.EXPECT_QUALITY), `automatic profile: ${views.map(v => v.quality)}`);
  await page.evaluate(async () => { await window.__mobius.renderer.xr.getSession().end(); });
  await page.waitForFunction(() => { const a = window.__mobius; return !a.renderer.xr.isPresenting && !a.worldChase.renderer; }, null, { timeout: 15000 });
  assert.deepEqual(errors, []);
} finally {
  fs.writeFileSync(output, JSON.stringify({ emulated: true, physicalQuestFps: null, errors, warnings, views }, null, 1));
  await browser.close();
}
console.log(JSON.stringify({ errors, views: views.map(v => ({ heading: v.heading, quality: v.quality, calls: v.calls, tris: v.tris })) }));
