// Forest of Shadow Ruins art upgrade — browser verification (desktop Chromium). Needs a dev server (`npx vite --port 8461`).
//   MODE=preview  fixed viewpoints of /forest-preview.html → OUT/<view>.png + OUT/metrics.json (calls, tris, geo, tex…)
//                 VIEWS=start,street,… Q=high|low|off (quality; ignored by the legacy renderer)
//   MODE=travel   preview: move along the route STEPS × 40 m (streaming + recycling + floating-origin rebases) and switch
//                 the quality repeatedly → resource counts must stay bounded; build-slice CPU timings
//   MODE=gputime  preview: per view and quality, mean / p90 of 30 × (render + 1-pixel readPixels sync) — run with GPU=metal for the
//                 Mac's real GPU (DESKTOP number, not a Quest 3 measurement)
//   MODE=flow     the game: title → forest (assets ready before the loader hides) → another map → forest (×N), a
//                 switch-away while the forest assets are still loading, a live bench run, main menu; page errors,
//                 failed requests, geometry / texture / program counts per step
// URL=https://localhost:8461  OUT=/private/tmp/...  GPU=metal  (exit code 1 on page errors / failed requests / unbounded growth)
import { chromium } from 'playwright';
import fs from 'node:fs';
const URL = process.env.URL || 'https://localhost:8461';
const OUT = process.env.OUT || '/private/tmp/mobius-forest-review/e2e';
const MODE = process.env.MODE || 'preview';
fs.mkdirSync(OUT, { recursive: true });
const GL = process.env.GPU === 'metal' ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: [...GL, '--autoplay-policy=no-user-gesture-required', '--ignore-certificate-errors'] });
const p = await b.newPage({ viewport: { width: +(process.env.W || 1280), height: +(process.env.H || 720) }, ignoreHTTPSErrors: true });
const logs = [], failed = [];
p.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
p.on('requestfailed', (r) => { const e = r.failure()?.errorText || ''; if (!/ERR_ABORTED/.test(e) || !/\/models\/forest\//.test(r.url())) failed.push(`${r.url()} ${e}`); });
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
const openPreview = async (view = 'start') => {
  const q = process.env.Q ? `&q=${process.env.Q}` : '';
  await p.goto(`${URL}/forest-preview.html?clean#view=${view}${q}`, { waitUntil: 'load' });
  await p.waitForFunction(() => window.__fp?.ready, null, { timeout: 300000, polling: 500 });
};

if (MODE === 'gputime') {
  const rows = [];
  for (const q of (process.env.QS || 'off,low,high').split(',')) {
    await p.goto(`${URL}/forest-preview.html?clean#view=start&q=${q}`, { waitUntil: 'load' });
    await p.waitForFunction(() => window.__fp?.ready, null, { timeout: 300000, polling: 500 });
    for (const v of (process.env.VIEWS || 'start,street,turn,landmark,bridge,vista,trunk,ruin,front,rear').split(',')) {
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
} else if (MODE === 'preview') {
  await openPreview();
  const views = (process.env.VIEWS || 'start,heroes,street,turn,landmark,bridge,vista,ground,low,trunk,ruin,front,rear,left,right,up,roots,wrapped,guardian,altar').split(',');
  const metrics = {};
  for (const v of views) {
    const t0 = Date.now();
    await p.evaluate(async (v) => { window.__fp.setView(v); await window.__fp.whenReady(); }, v);
    await p.waitForTimeout(700);
    await p.screenshot({ path: `${OUT}/${v}.png`, timeout: 240000 });
    metrics[v] = { ...(await p.evaluate(() => window.__fp.info())), wallMs: Date.now() - t0 };
    console.log(v, JSON.stringify(metrics[v]));
  }
  fs.writeFileSync(`${OUT}/metrics.json`, JSON.stringify(metrics, null, 1));
  await finish({ metrics });
} else if (MODE === 'travel') {
  await openPreview();
  // travel the route in 40 m steps (each step streams + builds in 2.5 ms slices like the game), then quality switches
  const N = +(process.env.STEPS || 100), rows = [];
  for (let k = 0; k < N; k++) {
    const r = await p.evaluate(async (s) => {
      const fp = window.__fp, t0 = performance.now();
      fp.placeAt(s);
      let steps = 0, maxStep = 0; const wr = fp.wr();
      while (wr.pending > 0 && steps < 5000) { const a = performance.now(); wr.pump(2.5); maxStep = Math.max(maxStep, performance.now() - a); steps++; }
      const u0 = performance.now(); fp.render(); const renderMs = performance.now() - u0;
      const i = fp.info();
      return { s, ms: +(performance.now() - t0).toFixed(1), slices: steps, maxSliceMs: +maxStep.toFixed(2), renderMs: +renderMs.toFixed(1), geo: i.geo, tex: i.tex, mods: i.mods, calls: i.calls, tris: i.tris, rebases: i.rebases, detail: i.detail };
    }, 20 + k * 40);
    rows.push(r);
    if (k % 10 === 0) console.log(JSON.stringify(r));
  }
  const geo = rows.map((r) => r.geo), tex = rows.map((r) => r.tex), half = geo.slice(Math.floor(geo.length / 2));
  const growth = Math.max(...half) - Math.min(...half);
  const switches = [];
  for (const q2 of ['low', 'high', 'off', 'high', 'low', 'high']) {
    await p.evaluate(async (q2) => { const fp = window.__fp; await fp.setQuality(q2); fp.setView('street'); await fp.whenReady(); fp.render(); }, q2);
    await p.waitForTimeout(500);
    const r = await p.evaluate(() => window.__fp.info());
    switches.push({ q: q2, geo: r.geo, tex: r.tex, progs: r.progs, calls: r.calls, tris: r.tris, detail: r.detail });
    console.log('quality', q2, JSON.stringify({ geo: r.geo, tex: r.tex, progs: r.progs, calls: r.calls }));
  }
  const sg = switches.filter((x) => x.q === 'high').map((x) => x.geo), st = switches.filter((x) => x.q === 'high').map((x) => x.tex);
  if (growth > 40 || Math.max(...sg) - Math.min(...sg) > 4 || Math.max(...st) - Math.min(...st) > 0 || Math.max(...tex) - Math.min(...tex.slice(1)) > 0) { bad = true; console.log('UNBOUNDED resources', growth, sg, st); }
  const sorted = rows.map((r) => r.maxSliceMs).sort((a, b) => a - b);
  await finish({ travel: rows, switches, distanceM: 20 + (N - 1) * 40, geoRangeSecondHalf: [Math.min(...half), Math.max(...half)], texRange: [Math.min(...tex), Math.max(...tex)], sliceMaxMs: sorted.at(-1), sliceP90Ms: sorted[Math.floor(sorted.length * 0.9)], rebases: rows.at(-1).rebases });
} else if (MODE === 'flow') {
  const other = (process.env.OTHER || 'foldscape,neon,molten').split(',');
  await p.goto(`${URL}/`, { waitUntil: 'load' });
  await p.waitForFunction(() => window.__mobius && !document.getElementById('enter').disabled, null, { timeout: 300000, polling: 500 });
  const waitWorld = (id) => p.waitForFunction((id) => { const a = window.__mobius; return a && a.state === 'world' && a.worldChase?.state && a.worldChase.mapId === id && !a.loader.visible; }, id, { timeout: 900000, polling: 500 });
  const info = () => p.evaluate(() => { const a = window.__mobius, w = a.worldChase, r = a.renderer.info; return { map: w.mapId, mods: w.world?.live.size, ready: [...(w.world?.live.values() || [])].filter((c) => c.ready).length, anchors: w.renderer?.anchorMesh.count, detail: w.renderer?.extras?.stats ? { ...w.renderer.extras.stats } : null, geo: r.memory.geometries, tex: r.memory.textures, progs: r.programs?.length, calls: r.render.calls, tris: r.render.triangles, sceneChildren: a.scene.children.length }; });
  await p.evaluate(() => { window.__mobius.audioOff = true; });
  const steps = [];
  const go = async (id, shot) => {
    await p.evaluate((id) => { const a = window.__mobius; if (!a.desktop) { a.pendingMap = id; a.enterDesktop(); } else a.startWorld(id); }, id);
    await waitWorld(id);
    // production readiness: the forest assets must be attached when the loader hides (not popping in later)
    const atHide = await p.evaluate(() => window.__mobius.worldChase.renderer?.extras?.stats?.assets ?? null);
    await p.waitForTimeout(2500);
    const i = { ...(await info()), assetsAtLoaderHide: atHide }; steps.push(i); console.log(id, JSON.stringify(i));
    if (id === 'forest' && atHide !== 'ready') { bad = true; console.log('forest assets not ready when the loader hid:', atHide); }
    if (shot) await p.screenshot({ path: `${OUT}/flow-${shot}.png`, timeout: 240000 });
  };
  await go('forest', 'forest-1');
  await go(other[0], 'other-map');
  // switch away the moment the forest load job ends (the app ignores startWorld during a load job, so this is the
  // earliest real switch: module builds may still be queued; mid-load disposal is covered by tests/forest-art.test.mjs)
  const race = await p.evaluate(async () => {
    const a = window.__mobius; a.startWorld('forest');
    for (let i = 0; i < 12000; i++) { await new Promise((r) => setTimeout(r, 5)); if (a.state === 'world' && a.worldChase.mapId === 'forest' && !a._loadJob) break; }
    const st = { assets: a.worldChase.renderer?.extras?.stats?.assets, queued: a.worldChase.renderer?.pending }; a.startWorld('neon'); return st;
  });
  console.log('switched away from forest with asset state', race);
  await waitWorld('neon'); await p.waitForTimeout(2500); steps.push({ ...(await info()), raceAssets: race });
  await go('forest', 'forest-2');
  for (let k = 0; k < +(process.env.ROUNDS || 3); k++) { await go(other[(k + 1) % other.length]); await go('forest'); }
  // a live bench run on the forest (streaming + recycling during play)
  await p.evaluate(() => { const w = window.__mobius.worldChase; w.lastBench = null; w.startBench(+(window.__benchSecs || 40), 18); });
  await p.waitForFunction(() => !!window.__mobius.worldChase.lastBench, null, { timeout: 1800000, polling: 1000 });
  const bench = await p.evaluate(() => window.__mobius.worldChase.lastBench);
  const after = await info(); console.log('bench', JSON.stringify(bench), JSON.stringify(after));
  await p.screenshot({ path: `${OUT}/flow-after-run.png`, timeout: 240000 });
  await p.evaluate(() => window.__mobius.go('menu'));
  await p.waitForTimeout(3000);
  const menu = await p.evaluate(() => { const a = window.__mobius, r = a.renderer.info; return { state: a.state, world: a.worldName, geo: r.memory.geometries, tex: r.memory.textures }; });
  const fo = steps.filter((x) => x.map === 'forest'), fg = fo.map((x) => x.geo), ft = fo.map((x) => x.tex);
  if (Math.max(...fg) - Math.min(...fg) > 12 || Math.max(...ft) - Math.min(...ft) > 2) { bad = true; console.log('forest resources grow across switches', fg, ft); }
  await finish({ steps, bench, after, menu });
}
