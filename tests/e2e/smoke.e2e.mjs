// Release smoke test (headless Chromium + SwiftShader, desktop preview; run against `npm run dev` or `vite preview`):
// Arcade mode in the factory interior → story-mode Arcade battle in the factory → all 8 World Chase maps.
// Checks state, page errors and resource counts; writes a screenshot per scene to OUT.
import { chromium } from 'playwright';
const OUT = process.env.OUT || '.', MAPS = (process.env.MAPS || 'foldscape,forest,redrock,neon,moonlit,cloudpalace,aurora,molten').split(',');
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required', '--ignore-certificate-errors'] });
const p = await b.newPage({ viewport: { width: 640, height: 360 }, ignoreHTTPSErrors: true });
const errs = []; p.on('pageerror', (e) => errs.push(`[pageerror] ${e.message}`)); p.on('console', (m) => { if (m.type() === 'error') errs.push(`[error] ${m.text().slice(0, 300)}`); });
let fails = 0; const check = (n, ok, i = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${i ? ' — ' + i : ''}`); };
const ev = (f, a) => p.evaluate(f, a);
const shot = (n) => p.screenshot({ path: `${OUT}/${n}.png`, timeout: 300000 }).catch((e) => console.log('shot', n, e.message));
const frames = async (n) => { const f0 = await ev(() => window.__frames); await p.waitForFunction((x) => window.__frames >= x, f0 + n, { timeout: 900000, polling: 250 }); };
const errCount = () => errs.length;
await p.goto(process.env.URL || 'https://localhost:8443/');
await p.waitForFunction(() => window.__mobius && !document.getElementById('enter').disabled, null, { timeout: 300000 });
await ev(() => { const a = window.__mobius, h = a.hub, o = h.update.bind(h); window.__frames = 0; h.update = (f, t) => { o(f, t); window.__frames++; }; });
// (v1.1: no-fail mode: at software-rendering speed (seconds per frame) the song runs on unanswered and its misses can fail it before the
// check below has had its few frames — the check is that the Arcade loads and plays, not how a player who does nothing fares)
await ev(async () => { (await import('/src/core/settings.js')).settings.noFail = true; });
const mem = () => ev(() => { const r = window.__mobius.renderer.info; return { geo: r.memory.geometries, tex: r.memory.textures, kids: window.__mobius.scene.children.length }; });

// 1) Story mode's Arcade battle: room → story → (after the roof finale) factory interior → arena → boss battle
await ev(() => { const a = window.__mobius; a.pendingMap = 'classic'; a.enterDesktop(); });
await p.waitForFunction(() => window.__mobius.state === 'modeSelect' && !window.__mobius.loader.visible, null, { timeout: 900000, polling: 500 });
check('Story & Arcade → room mode menu', true);
let e0 = errCount();
await ev(() => { const a = window.__mobius, st = a.story; a.go('story'); st.suited = true; st.flow.roofFired = true; st.enterStage('loadingInterior'); });
const dbg = setInterval(async () => { try { console.log('  …', JSON.stringify(await ev(() => { const a = window.__mobius; return { st: a.state, stage: a.story.stage, world: a.worldName, loader: a.loader.state, job: a._loadJob?.kind, f: window.__frames }; }))); } catch { /* */ } }, 30000);
await p.waitForFunction(() => window.__mobius.state === 'story' && window.__mobius.worldName === 'factory' && window.__mobius.story.stage === 'factory' && !window.__mobius.loader.visible, null, { timeout: 900000, polling: 500 });
await frames(5); await shot('smoke-story-factory');
await ev(() => window.__mobius.story.enterStage('arcadeBattle'));
await p.waitForFunction(() => window.__mobius.state === 'arcade' && window.__mobius.arcade.state === 'playing', null, { timeout: 900000, polling: 500 });
await frames(3);
let s = await ev(() => { const a = window.__mobius; return { world: a.worldName, interior: !!a.interior, arcade: a.arcade.state, story: a.storyArcade, song: a.currentSong?.id }; });
check(`Story-mode Arcade battle in the factory (${JSON.stringify(s)})`, s.world === 'factory' && s.interior && s.arcade === 'playing' && s.story && errCount() === e0, errs.slice(e0).join(' | '));
await shot('smoke-story-arcade');
// 2) Arcade mode from the room menu (song select → Start) in the factory interior
e0 = errCount();
await ev(() => { const a = window.__mobius; a.arcade.stop(); a.storyArcade = false; a.go('modeSelect'); });
await p.waitForFunction(() => window.__mobius.state === 'modeSelect' && !window.__mobius.loader.visible && !window.__mobius._loadJob, null, { timeout: 900000, polling: 500 });
await ev(() => window.__mobius.startArcade());
await p.waitForFunction(() => window.__mobius.state === 'arcade' && window.__mobius.arcade.state === 'playing', null, { timeout: 900000, polling: 500 });
await frames(3); // (the song runs on the real audio clock — at software-rendering speed it would end within a few dozen frames)
s = await ev(() => { const a = window.__mobius; return { world: a.worldName, interior: !!a.interior, arcade: a.arcade.state, song: a.currentSong?.id, story: a.storyArcade }; });
check(`Arcade mode: factory interior loaded, song playing (${JSON.stringify(s)})`, s.world === 'factory' && s.interior && s.arcade === 'playing' && !s.story && errCount() === e0, errs.slice(e0).join(' | '));
await shot('smoke-arcade-factory');
clearInterval(dbg);
// 3) the 8 World Chase maps (map switching through the in-game loader)
const m0 = await mem();
for (const id of MAPS) {
  e0 = errCount();
  await ev((id) => window.__mobius.startWorld(id), id);
  await p.waitForFunction((id) => { const a = window.__mobius; return a.state === 'world' && a.worldChase.state && a.worldChase.mapId === id && !a.loader.visible; }, id, { timeout: 900000, polling: 500 });
  await ev(() => { window.__mobius.worldChase.stateTime = 99; });
  await frames(30);
  const w = await ev(() => { const a = window.__mobius, wc = a.worldChase; return { state: wc.state, cells: wc.world.live.size, boss: a.boss.root.visible, hp: wc.hp?.hp, bgm: null }; });
  const m = await mem();
  check(`World ${id}: chase running (${JSON.stringify(w)}, geo ${m.geo}, tex ${m.tex}, scene ${m.kids})`, w.state === 'chase' && w.cells >= 4 && w.boss && errCount() === e0, errs.slice(e0).join(' | '));
  await shot(`smoke-world-${id}`);
}
console.log(`resources: before maps ${JSON.stringify(m0)}, after ${JSON.stringify(await mem())}`);
console.log(errs.length ? errs.slice(0, 20).join('\n') : 'no page errors');
await b.close(); process.exit(fails ? 1 : 0);
