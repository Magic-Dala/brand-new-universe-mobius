// Redrock (v0.46) through a real immersive session via the installed IWER runtime (Meta Quest 3 profile, stereo).
// Checks: the automatic Quest profile is resolved before any cell streams, two actual eye cameras, view selection on the
// XR union camera across a full head turn, the four Tripo types drawn, session end disposes the world. NOT a physical
// Quest FPS benchmark (desktop GPU, emulated device).
import { chromium } from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const output = process.env.OUT || '/private/tmp/mobius-redrock-art/e2e/redrock-immersive.json';
const browser = await chromium.launch({ executablePath: process.env.CHROME, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--ignore-certificate-errors', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 720 } });
const errors = [], warnings = [], views = [];
let diagnostics;
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') warnings.push(m.text()); });
const runtime = fs.readFileSync(new URL('../../node_modules/iwer/build/iwer.js', import.meta.url), 'utf8');
await page.addInitScript({ content: `${runtime}\nwindow.__rrXR = new IWER.XRDevice(IWER.metaQuest3, {stereoEnabled:true}); window.__rrXR.installRuntime({forceInstall:true}); window.__rrXR.controlMode='programmatic';` });
try {
  await page.goto(process.env.URL || 'https://localhost:8464/', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__mobius && !document.getElementById('enter').disabled, null, { timeout: 60000 });
  await page.evaluate(() => {
    const a = window.__mobius, W = a.worldChase, orig = W.__steps || (W.__steps = W.steps); a.audioOff = true; window.__trace = [];
    W.steps = function* (id) { for (const s of orig.call(this, id)) { const d = this.renderer?.extras; window.__trace.push({ s, q: d?.stats.quality ?? null, reason: d?.stats.reason ?? null, live: this.world?.live.size ?? 0, presenting: a.renderer.xr.isPresenting }); yield s; } };
    a.pendingMap = 'redrock'; a.enterXR();
  });
  await page.waitForFunction(() => { const a = window.__mobius; return a.renderer.xr.isPresenting && a.state === 'world' && !a.loader.visible && a.worldChase.renderer?.extras?.stats.assets === 'ready'; }, null, { timeout: 60000 });
  await page.evaluate(() => window.__mobius.worldChase.pause());
  for (const heading of [0, 60, 120, 180, 240, 300, 0]) {
    await page.evaluate(angle => { const h = angle * Math.PI / 360; window.__rrXR.quaternion.set(0, Math.sin(h), 0, Math.cos(h)); }, heading);
    await page.waitForTimeout(200);
    views.push(await page.evaluate(heading => {
      const a = window.__mobius, r = a.renderer, c = r.xr.getCamera(), d = a.worldChase.renderer.extras;
      return { heading, cull: d.stats.cull, heroes: { ...d.stats.heroes }, detailTris: d.stats.tris, culled: d.stats.culled, presenting: r.xr.isPresenting, eyes: c.cameras.length, quality: d.stats.quality, stats: { ...d.stats }, calls: r.info.render.calls, tris: r.info.render.triangles, geo: r.info.memory.geometries, tex: r.info.memory.textures, matrices: c.cameras.map(e => ({ position: e.matrixWorld.elements.slice(12, 15), projection: e.projectionMatrix.elements.slice() })) };
    }, heading));
  }
  assert.ok(views.every(v => v.presenting && v.eyes === 2), 'immersive renderer receives two actual IWER eye cameras');
  const trace = await page.evaluate(() => window.__trace), created = trace.find(t => t.s === 'created'), first = trace.find(t => t.live > 0);
  assert.ok(created && created.q === 'quest' && created.reason === 'xr' && created.live === 0, `quest before streaming ${JSON.stringify(created)}`);
  assert.ok(first && first.q === 'quest', 'first streamed cell under quest');
  assert.ok(views.every(v => v.quality === 'quest' && v.cull === 'view'), `automatic profile + view selection: ${views.map(v => v.quality + '/' + v.cull)}`);
  const seen = {}; for (const v of views) for (const [h, n] of Object.entries(v.heroes)) seen[h] = Math.max(seen[h] || 0, n);
  assert.ok(Object.values(seen).length === 4 && Object.values(seen).every(n => n > 0), `all four Tripo types drawn over the turn: ${JSON.stringify(seen)}`);
  assert.ok(new Set(views.map(v => v.culled)).size > 1, 'the selection follows the head');
  const eyeX = views[0].matrices.map(m => m.position[0]); assert.ok(Math.abs(eyeX[0] - eyeX[1]) > 0.03 || Math.abs(views[0].matrices[0].position[2] - views[0].matrices[1].position[2]) > 0.03, 'two distinct eye positions');
  if (process.env.EXPECT_QUALITY) assert.ok(views.every(v => v.quality === process.env.EXPECT_QUALITY), `automatic profile: ${views.map(v => v.quality)}`);
  diagnostics = await page.evaluate(() => {
    const a = window.__mobius, save = a.savePerfReport;
    a.savePerfReport = () => {};
    try {
      const report = a.exportPerf();
      return { line: a.devStats().find(l => l.startsWith('redrock ')), redrock: report.redrock, forest: report.forest };
    } finally { a.savePerfReport = save; }
  });
  assert.ok(diagnostics.line?.startsWith('redrock '), 'the developer overlay identifies the active map');
  assert.equal(diagnostics.redrock?.map, 'redrock', 'performance export attributes detail to Redrock');
  assert.equal(diagnostics.forest, undefined, 'Redrock does not contaminate forest reports');
  await page.evaluate(async () => { await window.__mobius.renderer.xr.getSession().end(); });
  await page.waitForFunction(() => { const a = window.__mobius; return !a.renderer.xr.isPresenting && !a.worldChase.renderer; }, null, { timeout: 15000 });
  assert.deepEqual(errors, []);
} finally {
  fs.writeFileSync(output, JSON.stringify({ emulated: true, physicalQuestFps: null, errors, warnings, views, diagnostics }, null, 1));
  await browser.close();
}
console.log(JSON.stringify({ errors, views: views.map(v => ({ heading: v.heading, quality: v.quality, cull: v.cull, calls: v.calls, tris: v.tris, detailTris: v.detailTris, culled: v.culled, heroes: v.heroes })) }));
