// Redrock art (v0.46) in the production game page (index.html, WorldChase → WorldRenderer → RedrockDetail). Desktop
// timings are a proxy only — NOT a Quest measurement.
//   CHROME=<chromium> URL=https://localhost:8464 node tests/e2e/redrock-art.e2e.mjs
// 1. desktop entry: assets ready before the first cell streams and before the loader hides; all four Tripo types placed
//    in the start window; quality high.
// 2. immersive flag (app.xrActive, as main.js sets on sessionstart) ×3: quest resolved at 'created' (no cell yet), view
//    selection, head-only turn reselects without moving, XR exit / re-entry switches the profile without rebuilding;
//    4+ km bench at 60 m/s with per-frame selection / pump timings and bounded pools / slots / cells / textures.
// 3. other maps in the same session (neon: no extras; forest: its own profile), redrock re-entry: no resource growth;
//    global render settings untouched.
// 4. lifecycle with real requests: hero GLB failure → legacy canyon; cancel while loading (returnHome) → released, late
//    requests attach nothing; timeout → fallback before streaming, late result ignored; clean re-entry afterwards.
import { chromium } from 'playwright';
import fs from 'node:fs';
const URL = process.env.URL || 'https://localhost:8464';
const SHOTS = process.env.SHOTS || 'docs/screenshots/redrock-upgrade/production';
const OUT = process.env.OUT || '/private/tmp/mobius-redrock-art/e2e/redrock-art-e2e.json';
fs.mkdirSync(SHOTS, { recursive: true }); fs.mkdirSync(OUT.replace(/\/[^/]+$/, ''), { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--ignore-certificate-errors', '--autoplay-policy=no-user-gesture-required'] });
const errors = [], out = { desktopProxyOnly: true };
const fail = (m) => { throw new Error(m); };
const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => errors.push(e.message));
const log = []; page.on('console', (m) => { if (m.type() !== 'debug') log.push(`${m.type()}: ${m.text()}`.slice(0, 300)); }); page.on('framenavigated', (f) => { if (f === page.mainFrame()) log.push(`NAVIGATED ${f.url()}`); });
const frames = (n) => page.evaluate((n) => new Promise((r) => { let i = 0; const f = () => (++i >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
try {
  await page.goto(`${URL}/`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__mobius && !document.getElementById('enter').disabled, null, { timeout: 60000 });
  // (imports the app's own module instances: Vite may version the module URL after edits)
  const settings = () => page.evaluate(async () => { const a = window.__mobius, url = (n) => performance.getEntriesByType('resource').map((e) => e.name).find((u) => u.includes(`/src/worlds/art/${n}`)) || `/src/worlds/art/${n}`, R = await import(url('redrockArt.js')), F = await import(url('forestArt.js')); window.__rart = R; return JSON.stringify({ rq: R.REDROCK_ART.quality, ro: R.REDROCK_ART.override, fq: F.FOREST_ART.quality, fo: F.FOREST_ART.override, scale: a.renderer.xr.getFramebufferScaleFactor?.() ?? null, pr: a.renderer.getPixelRatio() }); });
  const settings0 = await settings();
  await page.evaluate(() => { window.__mobius.audioOff = true; });
  const enter = async (map, xr, { wait = 'ready' } = {}) => {
    await page.evaluate(({ map, xr }) => {
      const a = window.__mobius, W = a.worldChase, orig = W.__steps || (W.__steps = W.steps);
      window.__trace = [];
      W.steps = function* (id) { for (const s of orig.call(this, id)) { const d = this.renderer?.extras; window.__trace.push({ s, q: d?.stats.quality ?? null, reason: d?.stats.reason ?? null, assets: d?.stats.assets ?? null, live: this.world?.live.size ?? 0, loader: a.loader.visible }); yield s; } };
      a.xrActive = xr; a.pendingMap = map; a.enterDesktop();
    }, { map, xr });
    await page.waitForFunction((wait) => { const a = window.__mobius, d = a.worldChase.renderer?.extras; return a.state === 'world' && !a.loader.visible && (!d || wait === 'any' || d.stats.assets === wait); }, wait, { timeout: 90000 });
    await frames(30);
    return page.evaluate(() => {
      const a = window.__mobius, d = a.worldChase.renderer.extras;
      const counts = d?.count ? Object.fromEntries(window.__rart.REDROCK_ART.heroes.map((h) => [h, d.count(h)])) : null;
      return { trace: window.__trace, stats: d ? { ...d.stats, byPool: undefined, heroes: { ...d.stats.heroes } } : null, counts, map: a.worldChase.mapId, mem: { ...a.renderer.info.memory }, calls: a.renderer.info.render.calls, tris: a.renderer.info.render.triangles, line: (() => { try { return a.devStats().find((l) => l.startsWith(`${a.worldChase.mapId} `)) || null; } catch (e) { return `devStats: ${e.message}`; } })() };
    });
  };
  const leave = async () => { await page.evaluate(() => { const a = window.__mobius; a.xrActive = false; a.returnHome(); }); await frames(20); return page.evaluate(() => ({ state: window.__mobius.state, mem: { ...window.__mobius.renderer.info.memory }, cache: window.__rart.redrockCacheState() })); };
  const bench = () => page.evaluate(async () => {
    const a = window.__mobius, W = a.worldChase, d = W.renderer.extras, R = W.renderer;
    const sel = [], pump = [], frame = []; let r0 = d.stats.rebuilds, maxPools = 0, maxCap = 0, maxCells = 0, last = performance.now();
    W.startBench(75, 60);
    await new Promise((res) => { const f = () => { const now = performance.now(); frame.push(now - last); last = now; if (d.stats.rebuilds !== r0) { sel.push(d.stats.rebuildMs); r0 = d.stats.rebuilds; } pump.push(R.stats.buildMs); maxPools = Math.max(maxPools, d.pools.size); maxCells = Math.max(maxCells, d.cells.size); let cap = 0; for (const p of d.pools.values()) cap += p.cap; maxCap = Math.max(maxCap, cap); if (W.bench) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
    const q = (v, p) => { const s = [...v].sort((x, y) => x - y); return +(s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? 0).toFixed(2); };
    return { result: W.lastBench, selections: sel.length, selectP50: q(sel, 0.5), selectP90: q(sel, 0.9), selectMax: q(sel, 1), pumpP90: q(pump, 0.9), pumpMax: q(pump, 1), frameP90: q(frame, 0.9), frameMax: q(frame, 1), maxPools, maxInstanceSlots: maxCap, maxCells, cells: d.cells.size, live: W.world.live.size, textures: d.assets?.tex.size ?? 0, mem: { ...a.renderer.info.memory }, quality: d.stats.quality, cull: d.stats.cull, tris: d.stats.tris };
  });

  // ------------------------------------------------------------------------------------------- 1. desktop
  const D = out.desktop = await enter('redrock', false);
  const firstStream = D.trace.find((x) => x.live > 0);
  if (!firstStream || firstStream.assets !== 'ready') fail(`streamed before the assets: ${JSON.stringify(firstStream)}`);
  if (D.trace.some((x) => !x.loader)) fail('loader hidden during the load steps');
  if (D.stats.quality !== 'high' || D.stats.reason !== 'default' || D.stats.cull !== 'off') fail(`desktop profile ${JSON.stringify(D.stats)}`);
  for (const [h, n] of Object.entries(D.counts)) if (!(n > 0)) fail(`${h} not placed in the start window`);
  await page.screenshot({ path: `${SHOTS}/desktop-start.png` });
  await leave();

  // ------------------------------------------------------------------------------------------- 2. immersive flag
  out.xr = [];
  out.titleMem = [];
  for (let k = 0; k < 5; k++) {
    const e = await enter('redrock', true);
    const created = e.trace.find((x) => x.s === 'created'), first = e.trace.find((x) => x.live > 0);
    if (!created || created.q !== 'quest' || created.reason !== 'xr' || created.live !== 0) fail(`entry ${k}: quest not resolved before streaming ${JSON.stringify(created)}`);
    if (!first || first.q !== 'quest' || first.assets !== 'ready') fail(`entry ${k}: first stream ${JSON.stringify(first)}`);
    if (e.stats.quality !== 'quest' || e.stats.cull !== 'view') fail(`entry ${k}: ${JSON.stringify(e.stats)}`);
    out.xr.push({ created, first, stats: e.stats, counts: e.counts, mem: e.mem, calls: e.calls, tris: e.tris, line: e.line });
    if (k === 0) {
      await page.screenshot({ path: `${SHOTS}/quest-flag-start.png` });
      out.turn = await page.evaluate(async () => {
        const a = window.__mobius, d = a.worldChase.renderer.extras, frames = (n) => new Promise((r) => { let i = 0; const f = () => (++i >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
        a.worldChase.pause?.(); await frames(10);
        const pos = () => a.camera.matrixWorld.elements.slice(12, 15), p0 = pos(), r0 = d.stats.rebuilds; await frames(60); const still = d.stats.rebuilds - r0;
        const ids = () => { const s = new Set(); d.forEachSelected((n, l, P, i) => s.add(`${n}:${P.m[i * 16 + 12].toFixed(1)}:${P.m[i * 16 + 14].toFixed(1)}`)); return s; };
        const before = ids(); a.hub.desk.yaw += Math.PI; await frames(6);
        const p1 = pos(), after = ids(); let gained = 0; for (const x of after) if (!before.has(x)) gained++;
        const res = { stillFrames60Rebuilds: still, turnedRebuilds: d.stats.rebuilds - r0 - still, moved: +Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]).toFixed(3), gainedInstances: gained, cull: d.stats.cull };
        a.hub.desk.yaw -= Math.PI; await frames(3);
        const placed = d.placements; a.xrActive = false; await frames(3); res.afterExit = { q: d.stats.quality, cull: d.stats.cull };
        a.xrActive = true; await frames(3); res.afterReentry = { q: d.stats.quality, cull: d.stats.cull, placementsSame: d.placements === placed };
        a.worldChase.resume?.(); return res;
      });
      const T = out.turn;
      if (!(T.turnedRebuilds >= 1 && T.gainedInstances > 0 && T.moved < 0.01 && T.stillFrames60Rebuilds === 0)) fail(`head-only turn ${JSON.stringify(T)}`);
      if (T.afterExit.q !== 'high' || T.afterReentry.q !== 'quest' || !T.afterReentry.placementsSame) fail(`XR switch ${JSON.stringify(T)}`);
      out.bench = await bench();
      const B = out.bench;
      if (!(B.result?.distance >= 4000) || B.quality !== 'quest') fail(`bench ${JSON.stringify(B.result)}`);
      if (B.maxCells > B.live + 2 || B.textures !== 4 || B.maxPools > 30 || B.maxInstanceSlots > 4096) fail(`bench resources ${JSON.stringify(B)}`);
      await page.screenshot({ path: `${SHOTS}/quest-flag-after-bench.png` });
    }
    const left = await leave(); out.titleMem.push(left.mem);
    if (left.cache.refs !== 0 || left.cache.loaded) fail(`entry ${k}: redrock cache still held after exit ${JSON.stringify(left.cache)}`);
  }
  // back at the title after each exit (redrock released; the first run's bench lazily creates a few game-wide
  // resources once): entries 2..5 must not grow, and in-world counts must not trend upward
  const T = out.titleMem.slice(1), g = out.xr.slice(1).map((e) => e.mem.geometries), t = out.xr.slice(1).map((e) => e.mem.textures);
  if (Math.max(...T.map((m) => m.textures)) > T[0].textures || Math.max(...T.map((m) => m.geometries)) > T[0].geometries + 2) fail(`title resources grow ${JSON.stringify(T)}`);
  if (t.at(-1) > t[0] + 1 || g.at(-1) > g[0] + 12) fail(`resources grow over entries g=${g} t=${t}`);

  // ------------------------------------------------------------------------------------------- 3. other maps
  out.neon = await enter('neon', true, { wait: 'any' }); if (out.neon.stats) fail('neon got redrock extras'); await leave();
  out.forest = await enter('forest', true); if (out.forest.stats.quality !== 'quest' || out.forest.counts?.rr_arch) fail(`forest profile ${JSON.stringify(out.forest.stats)}`); await leave();
  out.reentry = await enter('redrock', true); if (out.reentry.stats.assets !== 'ready' || out.reentry.mem.textures > out.xr[1].mem.textures + 2) fail(`re-entry ${JSON.stringify(out.reentry.mem)}`); await leave();
  const settings1 = await settings(); if (settings0 !== settings1) fail(`global settings changed ${settings0} → ${settings1}`); out.settings = JSON.parse(settings1);

  // ------------------------------------------------------------------------------------------- 4. lifecycle
  const state = () => page.evaluate(() => { const a = window.__mobius, d = a.worldChase.renderer?.extras, x = window.__retired; return { state: a.state, world: !!a.worldChase.renderer, assets: d?.stats.assets, held: !!d?._held, placements: d?.placements ?? null, retired: x ? { disposed: x.disposed, held: x._held, attached: !!x.assets, pools: x.pools.size } : null, cache: window.__rart.redrockCacheState() }; });
  out.lifecycle = {};
  { // a: the hero GLB fails → the whole bundle fails, the legacy canyon is drawn, the game runs
    const h = (r) => r.abort(); await page.route('**/models/redrock/redrock_heroes.glb', h);
    const e = await enter('redrock', false, { wait: 'failed' }); const s = await state();
    if (s.placements !== 0 || e.stats.pools !== 0 || s.cache.state !== 'failed') fail(`failure fallback ${JSON.stringify(s)}`);
    out.lifecycle.failure = { stats: e.stats, state: s }; await page.screenshot({ path: `${SHOTS}/failure-fallback.png` });
    const left = await leave(); if (left.cache.refs !== 0 || left.cache.state !== 'idle') fail(`failed bundle not released at exit ${JSON.stringify(left.cache)}`);
    await page.unroute('**/models/redrock/redrock_heroes.glb', h);
  }
  for (const mode of ['cancel', 'timeout']) {
    let release; const gate = new Promise((r) => { release = r; }); const h = async (r) => { await gate; await r.continue().catch(() => {}); };
    await page.route('**/models/redrock/**', h);
    if (mode === 'timeout') await page.evaluate(() => { window.__t0 = window.__rart.REDROCK_ART.loadTimeoutMs; window.__rart.REDROCK_ART.loadTimeoutMs = 2500; });
    await page.evaluate(() => { const a = window.__mobius; window.__retired = null; a.pendingMap = 'redrock'; a.enterDesktop(); });
    await page.waitForFunction(() => window.__mobius.worldChase.renderer?.extras?.loading, null, { timeout: 15000, polling: 10 });
    const loading = await state(); if (!loading.held) fail('loading holds no cache reference');
    if (mode === 'cancel') {
      await page.evaluate(() => { window.__retired = window.__mobius.worldChase.renderer.extras; window.__mobius.returnHome(); });
      const cancelled = await state(); if (cancelled.state !== 'title' || cancelled.world || !cancelled.retired.disposed || cancelled.retired.held || cancelled.cache.refs !== 0) fail(`cancel ${JSON.stringify(cancelled)}`);
      release(); await page.waitForLoadState('networkidle', { timeout: 20000 }); await page.waitForTimeout(500);
      const late = await state(); if (late.world || late.retired.attached || late.retired.pools || late.cache.loaded) fail(`late after cancel ${JSON.stringify(late)}`);
      out.lifecycle.cancel = { loading, cancelled, late };
    } else {
      await page.waitForFunction(() => { const a = window.__mobius; return a.state === 'world' && !a.loader.visible && a.worldChase.renderer?.extras?.stats.assets === 'failed'; }, null, { timeout: 30000 });
      const fb = await state(); if (fb.held || fb.placements !== 0) fail(`timeout fallback ${JSON.stringify(fb)}`);
      release(); await page.waitForLoadState('networkidle', { timeout: 20000 }); await page.waitForTimeout(500);
      const late = await state(); if (late.assets !== 'failed' || late.held || late.placements !== 0) fail(`late after timeout ${JSON.stringify(late)}`);
      out.lifecycle.timeout = { loading, fallback: fb, late };
      await page.evaluate(() => { window.__rart.REDROCK_ART.loadTimeoutMs = window.__t0; }); await leave();
    }
    await page.unroute('**/models/redrock/**', h);
  }
  out.lifecycle.clean = await enter('redrock', false); if (out.lifecycle.clean.stats.assets !== 'ready') fail('clean re-entry'); await leave();
  if (errors.length) fail(errors.join('\n'));
} finally {
  out.errors = errors; out.log = log.slice(-80); fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  await browser.close();
}
console.log(JSON.stringify({ errors, desktop: { calls: out.desktop?.calls, tris: out.desktop?.tris, counts: out.desktop?.counts }, xr: out.xr?.map((e) => ({ calls: e.calls, tris: e.tris, line: e.line, tex: e.mem.textures, geo: e.mem.geometries })), turn: out.turn, bench: out.bench, lifecycle: Object.keys(out.lifecycle || {}) }, null, 1));
