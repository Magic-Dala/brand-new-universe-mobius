// Foldscape art upgrade — browser verification (desktop Chromium, SwiftShader). Needs a dev server (`npx vite --port 8461`).
//   MODE=preview  fixed viewpoints of /foldscape-preview.html → OUT/<view>.png + OUT/metrics.json (calls, tris, geo, tex…)
//                 VIEWS=front,rear,left,right,up,sky,start,street,… (surround = the player's eye on the route) Q=high|low|off (quality; ignored by the legacy renderer)
//   MODE=travel   preview: move along the route (streaming + recycling + a floating-origin rebase) and switch the
//                 quality repeatedly → resource counts must stay bounded; build-step CPU timings
//   MODE=gputime  preview: per view and quality, mean / p90 of 30 × (render + 1-pixel readPixels sync) — run with GPU=metal for the
//                 Mac's real GPU (DESKTOP number, not a Quest 3 measurement)
//   MODE=flow     the game: title → foldscape → another map → foldscape (×N) → main menu; page errors, missing
//                 requests, geometry / texture / program counts per step
// URL=https://localhost:8461  OUT=/private/tmp/...  (exit code 1 on page errors / failed requests / unbounded growth)
import { chromium } from 'playwright';
import fs from 'node:fs';
const URL = process.env.URL || 'https://localhost:8461';
const OUT = process.env.OUT || '/private/tmp/mobius-foldscape-review/e2e';
const MODE = process.env.MODE || 'preview';
fs.mkdirSync(OUT, { recursive: true });
const GL = process.env.GPU === 'metal' ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: [...GL, '--autoplay-policy=no-user-gesture-required', '--ignore-certificate-errors'] });
const p = await b.newPage({ viewport: { width: +(process.env.W || 1280), height: +(process.env.H || 720) }, ignoreHTTPSErrors: true });
const logs = [], failed = [];
p.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
p.on('requestfailed', (r) => failed.push(`${r.url()} ${r.failure()?.errorText}`));
p.on('response', (r) => { if (r.status() >= 400) failed.push(`${r.url()} HTTP ${r.status()}`); });
let bad = false;
const finish = async (extra = {}) => {
  const errs = logs.filter((l) => l.startsWith('[pageerror]') || /GLSL|shader|WebGL: INVALID|Program Info Log/i.test(l));
  const res = { mode: MODE, pageErrors: errs, failedRequests: failed, warnings: logs.filter((l) => !errs.includes(l)).slice(0, 40), ...extra };
  fs.writeFileSync(`${OUT}/${MODE}-result.json`, JSON.stringify(res, null, 1));
  console.log(JSON.stringify({ pageErrors: errs.length, failedRequests: failed.length, bad }, null, 0));
  if (errs.length) console.log(errs.join('\n'));
  if (failed.length) console.log(failed.join('\n'));
  await b.close();
  process.exit(errs.length || failed.length || bad ? 1 : 0);
};

if (MODE === 'gputime') {
  const rows = [];
  for (const q of (process.env.QS || 'off,low,high').split(',')) {
    await p.goto(`${URL}/foldscape-preview.html?clean#view=start&q=${q}`, { waitUntil: 'load' });
    await p.waitForFunction(() => window.__fp?.ready, null, { timeout: 300000, polling: 500 });
    for (const v of (process.env.VIEWS || 'start,street,turn,landmark,vista,near,roof').split(',')) {
      const r = await p.evaluate(async (v) => {
        const fp = window.__fp; fp.setView(v); await fp.whenReady(); const gl = fp.renderer.getContext(), px = new Uint8Array(4), sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        for (let i = 0; i < 5; i++) { fp.render(); sync(); }
        const t = []; for (let i = 0; i < 30; i++) { const a = performance.now(); fp.render(); sync(); t.push(performance.now() - a); }
        t.sort((x, y) => x - y); const i = fp.info();
        return { view: v, meanMs: +(t.reduce((a, b) => a + b, 0) / t.length).toFixed(2), p90Ms: +t[27].toFixed(2), calls: i.calls, tris: i.tris, renderer: gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info')?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER) };
      }, v);
      rows.push({ q, ...r }); console.log(q, JSON.stringify(r));
    }
  }
  fs.writeFileSync(`${OUT}/gputime.json`, JSON.stringify(rows, null, 1));
  await finish({ rows });
} else if (MODE === 'preview' || MODE === 'travel') {
  const q = process.env.Q ? `&q=${process.env.Q}` : '';
  await p.goto(`${URL}/foldscape-preview.html?clean#view=start${q}`, { waitUntil: 'load' });
  await p.waitForFunction(() => window.__fp?.ready, null, { timeout: 300000, polling: 500 });
  // v0.42: the remote sky districts are part of every capture — wait for their three images
  await p.waitForFunction(() => (window.__fp.info().sky?.loaded ?? 3) >= (window.__fp.info().sky?.textures ?? 0), null, { timeout: 120000, polling: 300 });
  if (MODE === 'preview') {
    const views = (process.env.VIEWS || 'front,rear,left,right,up,sky,start,street,turn,landmark,vista,near,roof,ground').split(',');
    const metrics = {};
    for (const v of views) {
      const t0 = Date.now();
      await p.evaluate(async (v) => { window.__fp.setView(v); await window.__fp.whenReady(); }, v);
      await p.waitForTimeout(900);
      await p.screenshot({ path: `${OUT}/${v}.png`, timeout: 240000 });
      metrics[v] = { ...(await p.evaluate(() => window.__fp.info())), wallMs: Date.now() - t0 };
      console.log(v, JSON.stringify(metrics[v]));
    }
    fs.writeFileSync(`${OUT}/metrics.json`, JSON.stringify(metrics, null, 1));
    await finish({ metrics });
  } else {
    // travel the route in 40 m steps (each step streams + builds like the game's loading path), then quality switches
    const N = +(process.env.STEPS || 70), rows = [];
    for (let k = 0; k < N; k++) {
      const r = await p.evaluate(async (s) => {
        const fp = window.__fp, w = fp.world(), t0 = performance.now();
        fp.placeAt(s);
        let steps = 0, maxStep = 0; const wr = fp.wr();
        while (wr.pending > 0 && steps < 5000) { const a = performance.now(); wr.pump(2.5); maxStep = Math.max(maxStep, performance.now() - a); steps++; }
        fp.render();
        const i = fp.info();
        return { s, ms: +(performance.now() - t0).toFixed(1), slices: steps, maxSliceMs: +maxStep.toFixed(2), geo: i.geo, tex: i.tex, mods: i.mods, rebases: i.rebases, detail: i.detail };
      }, 20 + k * 40);
      rows.push(r);
      if (k % 10 === 0) console.log(JSON.stringify(r));
    }
    const geo = rows.map((r) => r.geo), half = geo.slice(Math.floor(geo.length / 2));
    const growth = Math.max(...half) - Math.min(...half);
    const switches = [];
    for (const q2 of ['low', 'high', 'off', 'high', 'low', 'high']) {
      await p.evaluate(async (q2) => { const fp = window.__fp; fp.setQuality(q2); fp.setView('street'); await fp.whenReady(); fp.render(); }, q2);
      await p.waitForTimeout(600);
      const r = await p.evaluate(() => window.__fp.info());
      switches.push({ q: q2, geo: r.geo, tex: r.tex, progs: r.progs, detail: r.detail });
      console.log('quality', q2, JSON.stringify({ geo: r.geo, tex: r.tex, progs: r.progs }));
    }
    const sg = switches.filter((x) => x.q === 'high').map((x) => x.geo);
    if (growth > 40 || Math.max(...sg) - Math.min(...sg) > 4) { bad = true; console.log('UNBOUNDED geometry', growth, sg); }
    const sliceMax = Math.max(...rows.map((r) => r.maxSliceMs));
    const sorted = rows.map((r) => r.maxSliceMs).sort((a, b) => a - b);
    await finish({ travel: rows, switches, geoRangeSecondHalf: [Math.min(...half), Math.max(...half)], sliceMaxMs: sliceMax, sliceP90Ms: sorted[Math.floor(sorted.length * 0.9)], rebases: rows.at(-1).rebases });
  }
} else if (MODE === 'flow') {
  const other = (process.env.OTHER || 'neon,forest,molten').split(',');
  await p.goto(`${URL}/`, { waitUntil: 'load' });
  await p.waitForFunction(() => window.__mobius && !document.getElementById('enter').disabled, null, { timeout: 300000, polling: 500 });
  const waitWorld = (id) => p.waitForFunction((id) => { const a = window.__mobius; return a && a.state === 'world' && a.worldChase?.state && a.worldChase.mapId === id && !a.loader.visible; }, id, { timeout: 900000, polling: 500 });
  const info = () => p.evaluate(() => { const a = window.__mobius, w = a.worldChase, r = a.renderer.info; return { map: w.mapId, mods: w.world?.live.size, ready: [...(w.world?.live.values() || [])].filter((c) => c.ready).length, anchors: w.renderer?.anchorMesh.count, detail: w.renderer?.extras?.stats || null, geo: r.memory.geometries, tex: r.memory.textures, progs: r.programs?.length, calls: r.render.calls, tris: r.render.triangles, sceneChildren: a.scene.children.length }; });
  await p.evaluate(() => { window.__mobius.audioOff = true; });
  const steps = [];
  const go = async (id, shot) => {
    await p.evaluate((id) => { const a = window.__mobius; if (!a.desktop) { a.pendingMap = id; a.enterDesktop(); } else a.startWorld(id); }, id);
    await waitWorld(id);
    await p.waitForTimeout(2500);
    const i = await info(); steps.push(i); console.log(id, JSON.stringify(i));
    if (shot) await p.screenshot({ path: `${OUT}/flow-${shot}.png`, timeout: 240000 });
  };
  await go('foldscape', 'foldscape-1');
  await go(other[0], 'other-map');
  // switch away the moment foldscape finishes loading (its kit fetch may still be in flight: the cache was released)
  const race = await p.evaluate(async () => {
    const a = window.__mobius; a.startWorld('foldscape');
    for (let i = 0; i < 6000; i++) { await new Promise((r) => setTimeout(r, 5)); if (a.state === 'world' && a.worldChase.mapId === 'foldscape' && !a.loader.visible && !a._loadJob) break; }
    const kit = a.worldChase.renderer?.extras?.stats.kit; a.startWorld(window.__otherMap || 'forest'); return kit;
  });
  console.log('switched away from foldscape with kit state', race);
  await waitWorld('forest'); await p.waitForTimeout(2500); steps.push({ ...(await info()), raceKit: race });
  await p.screenshot({ path: `${OUT}/flow-after-race.png`, timeout: 240000 });
  await go('foldscape', 'foldscape-2');
  for (let k = 0; k < +(process.env.ROUNDS || 3); k++) { await go(other[k % other.length]); await go('foldscape'); }
  // a short live run on foldscape (streaming + recycling during play)
  await p.evaluate(() => { const w = window.__mobius.worldChase; w.lastBench = null; w.startBench(+(window.__benchSecs || 25), 18); });
  await p.waitForFunction(() => !!window.__mobius.worldChase.lastBench, null, { timeout: 1800000, polling: 1000 });
  const bench = await p.evaluate(() => window.__mobius.worldChase.lastBench);
  const after = await info(); console.log('bench', JSON.stringify(bench), JSON.stringify(after));
  await p.screenshot({ path: `${OUT}/flow-after-run.png`, timeout: 240000 });
  await p.evaluate(() => window.__mobius.go('menu'));
  await p.waitForTimeout(3000);
  const menu = await p.evaluate(() => { const a = window.__mobius, r = a.renderer.info; return { state: a.state, world: a.worldName, geo: r.memory.geometries, tex: r.memory.textures }; });
  const fold = steps.filter((x) => x.map === 'foldscape').map((x) => x.geo);
  if (Math.max(...fold) - Math.min(...fold) > 12) { bad = true; console.log('foldscape geometry count grows across switches', fold); }
  await finish({ steps, bench, after, menu });
}
