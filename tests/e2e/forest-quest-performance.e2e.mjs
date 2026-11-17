// Forest Quest profile (v0.45) — desktop-proxy evidence + the production selection path. NOT a Quest measurement.
//   CHROME=<chromium> URL=https://localhost:8463 node tests/e2e/forest-quest-performance.e2e.mjs
// Part A (forest-preview, same WorldRenderer / kit / shaders / cache as the game): for q = high | quest and route views:
//   screenshot, renderer counts, detail stats, render+readPixels timings, and fragment coverage of the detail pools
//   (every fragment the pools rasterise, no depth test; leaf cards through their atlas alpha test) = an overdraw
//   proxy for the alpha-tested foliage; side-by-side comparison sheets.
// Part B (the game, index.html): the immersive flag (`app.xrActive`, set by main.js on sessionstart) before entry →
//   quest resolved before any cell streams; app.camera view selection; heading-only turns; XR exit / re-entry switch;
//   4+ km route bench with per-frame selection / pump timings and bounded resources; repeated entries; other map;
//   desktop entry stays high; global settings untouched.
import { chromium } from 'playwright';
import fs from 'node:fs';
const URL = process.env.URL || 'https://localhost:8463';
const SHOTS = process.env.SHOTS || 'docs/screenshots/forest-quest-performance';
const OUT = process.env.OUT || '/private/tmp/mobius-forest-performance/after/quest-e2e.json';
const VIEWS = (process.env.VIEWS || 'start,foliage,street,landmark,rear,bridge,ground,up,guardian,wrapped,altar,roots').split(',');
fs.mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--ignore-certificate-errors', '--autoplay-policy=no-user-gesture-required'] });
const errors = [], out = { desktopProxyOnly: true, preview: {}, production: {} };
const fail = (m) => { throw new Error(m); };
try {
  // ------------------------------------------------------------------------------------------------ A. preview
  for (const q of ['high', 'quest']) {
    // a fresh page per quality: a same-page hash switch rebuilds the renderer while the shared asset cache reloads, and
    // anything streamed before the new manifest attaches gets the kit's 6 static fallback tips (bare limbs) — the game
    // never streams before the assets (WorldChase blockLoad)
    const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 720 } });
    page.on('pageerror', (e) => errors.push(`preview: ${e.message}`));
    await page.goto(`${URL}/forest-preview.html?clean&fresh=${q}#view=start&q=${q}`);
    await page.waitForFunction(() => window.__fp?.ready, null, { timeout: 60000 });
    out.preview[q] = {};
    for (const view of VIEWS) {
      await page.evaluate(async (v) => { window.__fp.setView(v); await window.__fp.whenReady(); }, view);
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      await page.screenshot({ path: `${SHOTS}/${q}-${view}.png` });
      out.preview[q][view] = await page.evaluate(() => {
        const f = window.__fp, d = f.wr().extras, T = f.THREE, R = f.renderer, gl = R.getContext(), px = new Uint8Array(4);
        f.render();
        const info = f.info(), calls = R.info.render.calls, tris = R.info.render.triangles;
        const render = () => { R.render(f.wr().root.parent, f.camera); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
        for (let i = 0; i < 15; i++) render();
        const t = []; for (let i = 0; i < 40; i++) { const a = performance.now(); render(); t.push(performance.now() - a); } t.sort((a, b) => a - b);
        // fragment coverage of the detail pools (1/255 additive per fragment, no depth): leaf cards alpha-tested
        const W = R.domElement.width, H = R.domElement.height, rt = new T.WebGLRenderTarget(W, H, { depthBuffer: false });
        const vs = 'varying vec2 vUv; void main() { vUv = uv; vec4 p = vec4(position, 1.0);\n#ifdef USE_INSTANCING\np = instanceMatrix * p;\n#endif\ngl_Position = projectionMatrix * modelViewMatrix * p; }';
        const mk = (leaf) => new T.ShaderMaterial({ vertexShader: vs, fragmentShader: leaf ? 'uniform sampler2D map; varying vec2 vUv; void main() { if (texture2D(map, vUv).a < 0.5) discard; gl_FragColor = vec4(vec3(1.0 / 255.0), 1.0); }' : 'void main() { gl_FragColor = vec4(vec3(1.0 / 255.0), 1.0); }',
          uniforms: leaf ? { map: { value: d.assets.tex.get('leaf') } } : {}, blending: T.AdditiveBlending, depthTest: false, depthWrite: false, transparent: true, side: leaf ? T.DoubleSide : T.FrontSide });
        const leafM = mk(true), solidM = mk(false), saved = [], buf = new Uint8Array(W * H * 4);
        const cover = (pred) => {
          for (const p of d.pools.values()) { saved.push([p.mesh, p.mesh.material, p.mesh.visible]); const name = p.mesh.name.slice(3).split(':')[0], leaf = d.alpha.has(name); p.mesh.material = leaf ? leafM : solidM; p.mesh.visible = p.mesh.visible && pred(leaf); }
          R.setRenderTarget(rt); R.setClearColor(0, 0); R.clear(); R.render(d.group, f.camera); R.readRenderTargetPixels(rt, 0, 0, W, H, buf); R.setRenderTarget(null);
          for (const [m, mat, vis] of saved.splice(0)) { m.material = mat; m.visible = vis; }
          let sum = 0, px1 = 0; for (let i = 0; i < buf.length; i += 4) { sum += buf[i]; if (buf[i]) px1++; } return { layers: +(sum / (W * H)).toFixed(3), covered: +(px1 / (W * H)).toFixed(3) };
        };
        const leaves = cover((leaf) => leaf), solid = cover((leaf) => !leaf);
        rt.dispose(); leafM.dispose(); solidM.dispose(); R.setClearColor(0x000000, 1); f.render();
        const D = info.detail;
        return { calls, tris, detailTris: D.tris, drawn: D.drawn, instances: D.instances, culled: D.culled, thinned: D.thinned, quality: D.quality, reason: D.reason, cull: D.cull, heroes: { ...D.heroes },
          leafPools: Object.keys(D.byPool).filter((k) => d.alpha.has(k.split(':')[0])).length, meanMs: +(t.reduce((a, b) => a + b, 0) / t.length).toFixed(3), p90Ms: +t[35].toFixed(3), leaves, solid, geo: info.geo, tex: info.tex };
      });
      console.log(q, view, JSON.stringify(out.preview[q][view]));
    }
    await page.close();
  }
  // side-by-side sheets (left: original high, right: quest) composed on a canvas
  const sheet = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 2560, height: 760 } });
  for (const view of VIEWS) {
    const a = fs.readFileSync(`${SHOTS}/high-${view}.png`).toString('base64'), b = fs.readFileSync(`${SHOTS}/quest-${view}.png`).toString('base64');
    const H = out.preview.high[view], Q = out.preview.quest[view];
    await sheet.setContent(`<body style="margin:0;background:#111;font:16px sans-serif;color:#eee"><div style="display:flex"><img src="data:image/png;base64,${a}" width=1280><img src="data:image/png;base64,${b}" width=1280></div><div style="display:flex;height:40px;align-items:center"><div style="width:1280px;padding-left:10px">${view} — high (original desktop default): ${H.tris} tris, ${H.calls} calls, leaf layers ${H.leaves.layers}</div><div style="width:1280px;padding-left:10px">quest (XR default): ${Q.tris} tris, ${Q.calls} calls, leaf layers ${Q.leaves.layers}, culled ${Q.culled}, thinned ${Q.thinned}</div></div></body>`);
    await sheet.screenshot({ path: `${SHOTS}/compare-${view}.png` });
  }
  await sheet.close();

  // ------------------------------------------------------------------------------------------------ B. production
  const game = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 720 } });
  game.on('pageerror', (e) => errors.push(`game: ${e.message}`));
  await game.goto(`${URL}/`, { waitUntil: 'load' });
  await game.waitForFunction(() => window.__mobius && !document.getElementById('enter').disabled, null, { timeout: 60000 });
  const settings0 = await game.evaluate(async () => { const a = window.__mobius; a.audioOff = true; const art = await import('/src/worlds/art/forestArt.js'); window.__art = art; return JSON.stringify({ q: art.FOREST_ART.quality, o: art.FOREST_ART.override, scale: a.renderer.xr.getFramebufferScaleFactor?.() ?? null, pr: a.renderer.getPixelRatio() }); });
  // record every load step: quality + streamed cells at the moment of each yield (renderer created before streaming)
  const enter = async (map, xr) => {
    await game.evaluate(({ map, xr }) => {
      const a = window.__mobius, W = a.worldChase, orig = W.__steps || (W.__steps = W.steps);
      window.__trace = [];
      W.steps = function* (id) { for (const s of orig.call(this, id)) { const d = this.renderer?.extras; window.__trace.push({ s, q: d?.stats.quality ?? null, reason: d?.stats.reason ?? null, live: this.world?.live.size ?? 0, cells: d?.cells.size ?? 0 }); yield s; } };
      a.xrActive = xr; a.pendingMap = map; a.enterDesktop();
    }, { map, xr });
    await game.waitForFunction(() => { const a = window.__mobius; return a.state === 'world' && !a.loader.visible && (!a.worldChase.renderer?.extras?.loading); }, null, { timeout: 60000 });
    await game.waitForTimeout(600);
    return game.evaluate(() => { const a = window.__mobius, d = a.worldChase.renderer.extras; return { trace: window.__trace, stats: d ? { ...d.stats, byPool: undefined } : null, map: a.worldChase.mapId, mem: { ...a.renderer.info.memory }, line: (() => { try { return a.devStats().find((l) => l.startsWith('forest ')) || null; } catch (e) { return `devStats: ${e.message}`; } })() }; });
  };
  const leave = () => game.evaluate(() => { const a = window.__mobius; a.xrActive = false; a.returnHome(); return a.state; });
  const P = out.production;
  const bench = () => game.evaluate(async () => {
    const a = window.__mobius, W = a.worldChase, d = W.renderer.extras, R = W.renderer, mem0 = { ...a.renderer.info.memory };
    const sel = [], pump = [], frame = []; let r0 = d.stats.rebuilds, maxPools = 0, maxCap = 0, last = performance.now();
    W.startBench(75, 60);
    await new Promise((res) => { const f = () => { const now = performance.now(); frame.push(now - last); last = now; if (d.stats.rebuilds !== r0) { sel.push(d.stats.rebuildMs); r0 = d.stats.rebuilds; } pump.push(R.stats.buildMs); maxPools = Math.max(maxPools, d.pools.size); let cap = 0; for (const p of d.pools.values()) cap += p.cap; maxCap = Math.max(maxCap, cap); if (W.bench) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
    const q = (v, p) => { const s = [...v].sort((x, y) => x - y); return +(s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? 0).toFixed(2); };
    return { result: W.lastBench, selections: sel.length, selectP50: q(sel, 0.5), selectP90: q(sel, 0.9), selectMax: q(sel, 1), pumpP90: q(pump, 0.9), pumpMax: q(pump, 1), frameP90: q(frame, 0.9), frameMax: q(frame, 1), maxPools, maxInstanceSlots: maxCap, cells: d.cells.size, live: W.world.live.size, forestTextures: d.assets?.tex.size ?? 0, mem0, mem1: { ...a.renderer.info.memory }, quality: d.stats.quality, cull: d.stats.cull, tris: d.stats.tris };
  });
  P.entries = [];
  for (let k = 0; k < 4; k++) {
    const e = await enter('forest', true);
    const created = e.trace.find((x) => x.s === 'created'), firstStream = e.trace.find((x) => x.live > 0);
    if (!created || created.q !== 'quest' || created.reason !== 'xr' || created.live !== 0) fail(`entry ${k}: quest not resolved before streaming ${JSON.stringify(created)}`);
    if (!firstStream || firstStream.q !== 'quest') fail(`entry ${k}: streamed under ${firstStream?.q}`);
    if (e.stats.quality !== 'quest' || e.stats.assets !== 'ready' || e.stats.cull !== 'view') fail(`entry ${k}: ${JSON.stringify(e.stats)}`);
    P.entries.push({ created, firstStream, stats: e.stats, mem: e.mem, line: e.line });
    if (k === 0) {
      // heading-only turn (desktop view drives app.camera like the headset pose does in XR)
      const turn = await game.evaluate(async () => {
        const a = window.__mobius, d = a.worldChase.renderer.extras, frames = (n) => new Promise((r) => { let i = 0; const f = () => (++i >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
        a.worldChase.pause?.(); await frames(10);
        const p0 = a.camera.getWorldPosition(new window.__THREE.Vector3()), r0 = d.stats.rebuilds, c0 = d.stats.culled; await frames(60); const still = d.stats.rebuilds - r0;
        const ids = () => { const s = new Set(); d.forEachSelected((n, l, P, i) => s.add(`${n}:${P.m[i * 16 + 12].toFixed(1)}:${P.m[i * 16 + 14].toFixed(1)}`)); return s; };
        const before = ids(); a.hub.desk.yaw += Math.PI; await frames(6);
        const p1 = a.camera.getWorldPosition(new window.__THREE.Vector3()), after = ids(); let gained = 0; for (const x of after) if (!before.has(x)) gained++;
        const res = { stillFrames60Rebuilds: still, turnedRebuilds: d.stats.rebuilds - r0 - still, moved: +p0.distanceTo(p1).toFixed(3), culledBefore: c0, culledAfter: d.stats.culled, gainedInstances: gained, cull: d.stats.cull };
        a.hub.desk.yaw -= Math.PI; await frames(3);
        // XR session ends / restarts under the live renderer: profile follows, nothing rebuilt
        const placed = d.placements; a.xrActive = false; await frames(3); res.afterExit = { q: d.stats.quality, cull: d.stats.cull, tris: d.stats.tris };
        a.xrActive = true; await frames(3); res.afterReentry = { q: d.stats.quality, cull: d.stats.cull, tris: d.stats.tris, placementsSame: d.placements === placed };
        a.worldChase.resume?.(); return res;
      });
      if (!(turn.turnedRebuilds >= 1 && turn.gainedInstances > 0 && turn.moved < 0.01)) fail(`heading-only turn: ${JSON.stringify(turn)}`);
      if (turn.afterExit.q !== 'high' || turn.afterReentry.q !== 'quest' || !turn.afterReentry.placementsSame) fail(`XR switch: ${JSON.stringify(turn)}`);
      P.turn = turn;
      // 4+ km route bench at 60 m/s (streaming, rebases, recycling, boss, coins): per-frame selection / pump timings
      P.bench = await bench();
      if (!(P.bench.result?.distance >= 4000) || P.bench.quality !== 'quest') fail(`bench ${JSON.stringify(P.bench.result)}`);
      if (P.bench.cells > P.bench.live || P.bench.forestTextures !== 5 || P.bench.maxPools > 58 || P.bench.maxInstanceSlots > 4096) fail(`bench forest resources ${JSON.stringify(P.bench)}`);
      await game.screenshot({ path: `${SHOTS}/production-quest-after-bench.png` });
    }
    await leave();
  }
  P.desktop = await enter('forest', false);
  // per-entry leak check: entries after the first (the first run's bench lazily creates a few game-wide resources
  // once — HUD / coins / bombs — measured: +4 textures, then constant) + the desktop entry must not grow
  // (the desktop entry draws more distinct piece / LOD geometries under 'high' → compared only with itself)
  const later = P.entries.slice(1), g = later.map((e) => e.mem.geometries), t = later.map((e) => e.mem.textures);
  P.entryMemory = { first: P.entries[0].mem, later: later.map((e) => e.mem), desktop: P.desktop.mem };
  // (no growth across entries; textures / geometries upload on first draw, so one not yet drawn at the snapshot reads −1)
  if (Math.max(...t) > t[0] || Math.max(...g) > g[0] + 12) fail(`resources grow over entries g=${g} t=${t}`);
  if (P.desktop.stats.quality !== 'high' || P.desktop.stats.reason !== 'default' || P.desktop.stats.cull !== 'off') fail(`desktop entry ${JSON.stringify(P.desktop.stats)}`);
  P.desktopBench = await bench(); // same-session control: the original high selection over the same route
  if (P.desktopBench.quality !== 'high') fail('desktop bench quality');
  await leave();
  P.other = await enter('neon', true); // another map in a session: no forest detail, same renderer path
  if (P.other.stats && P.other.stats.requested) fail(`neon got forest stats ${JSON.stringify(P.other.stats)}`);
  await leave();
  const settings1 = await game.evaluate(() => { const a = window.__mobius, art = window.__art; return JSON.stringify({ q: art.FOREST_ART.quality, o: art.FOREST_ART.override, scale: a.renderer.xr.getFramebufferScaleFactor?.() ?? null, pr: a.renderer.getPixelRatio() }); });
  if (settings0 !== settings1) fail(`global settings changed ${settings0} → ${settings1}`);
  P.settings = JSON.parse(settings1);
  if (errors.length) fail(errors.join('\n'));
} finally {
  out.errors = errors; fs.mkdirSync(OUT.replace(/\/[^/]+$/, ''), { recursive: true }); fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  await browser.close();
}
console.log(JSON.stringify({ errors, production: { turn: out.production.turn, bench: out.production.bench, desktopBench: out.production.desktopBench, entries: out.production.entries?.map((e) => ({ created: e.created, cull: e.stats.cull, line: e.line, mem: e.mem })), desktop: out.production.desktop?.stats?.quality, other: out.production.other?.map } }, null, 1));
