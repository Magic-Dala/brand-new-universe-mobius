// v0.43 BGM end-to-end (headless Chromium; needs `npm run dev` or `vite preview`): each scene plays its track.
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required', '--ignore-certificate-errors'] });
const p = await b.newPage({ viewport: { width: 640, height: 360 }, ignoreHTTPSErrors: true });
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (/bgm/i.test(m.text())) errs.push(m.text()); });
let fails = 0; const check = (n, ok, i = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${i ? ' — ' + i : ''}`); };
const ev = (f, a) => p.evaluate(f, a);
await p.goto(process.env.URL || 'https://localhost:8443/');
await p.waitForFunction(() => window.__mobius && !document.getElementById('enter').disabled, null, { timeout: 300000 });
const bgm = () => ev(() => { const a = window.__mobius, s = a.constructor && window.__mobius; const st = (window.__audio || null); return null; });
await ev(() => { window.__aud = window.__mobius.audio || null; });
const state = () => ev(async () => { const m = await import('/src/core/audio.js'); const a = m.audio; const b = a._bgm; return { st: window.__mobius.state, id: b?.id ?? null, playing: !!b?.src, level: b?.level ?? null, gain: b?.g ? +b.g.gain.value.toFixed(3) : null, ctx: a.ctx?.state }; });
await ev(async () => { window.__A = (await import('/src/core/audio.js')).audio; });
const waitPlaying = (id) => p.waitForFunction((id) => { const b = window.__A._bgm; return !!(b && b.id === id && b.src); }, id, { timeout: 600000, polling: 500 });
const waitWorld = (id) => p.waitForFunction((id) => { const a = window.__mobius; return a.state === 'world' && a.worldChase.state && a.worldChase.mapId === id && !a.loader.visible; }, id, { timeout: 900000, polling: 500 });
for (const [i, id] of (process.env.MAPS || 'foldscape,neon').split(',').entries()) {
  await ev((id) => { const a = window.__mobius; if (!a.desktop) { a.pendingMap = id; a.enterDesktop(); } else a.startWorld(id); }, id);
  await waitWorld(id);
  const want = { foldscape: 'dala' }[id] || id;
  await waitPlaying(want); await p.waitForTimeout(3000);
  const s = await state();
  check(`world ${id} → BGM ${s.id} playing (gain ${s.gain}, ctx ${s.ctx})`, s.id === want && s.playing && s.gain > 0.2);
  if (i === 0) {
    await ev(() => window.__mobius.toggleMenu()); await p.waitForTimeout(2500);
    const sp = await state(); check(`paused → level ${sp.level}, gain ${sp.gain}`, sp.level === 0.35 && sp.gain < s.gain);
    await ev(() => window.__mobius.toggleMenu()); await p.waitForTimeout(1000);
  }
}
await ev(() => window.__mobius.returnHome()); await p.waitForTimeout(3500);
const h = await state(); check(`Back to Home → title, BGM stopped (${h.st}, ${h.id})`, h.st === 'title' && h.id === null);
// story chase: title → "Dala City — Story & Arcade" → story → the chase stage
await ev(() => { const a = window.__mobius; a.pendingMap = 'classic'; a.enterDesktop(); });
await p.waitForFunction(() => ['modeSelect', 'world', 'story'].includes(window.__mobius.state) && !window.__mobius.loader.visible, null, { timeout: 600000, polling: 500 });
await ev(() => window.__mobius.go('story', { stage: 'intro' }));
await p.waitForFunction(() => window.__mobius.state === 'story', null, { timeout: 600000, polling: 500 }); await p.waitForTimeout(3000);
const r = await state(); check(`story room (intro, ${r.st}) → no BGM (${r.id})`, r.st === 'story' && r.id === null);
await ev(() => window.__mobius.story.enterStage('chase'));
await waitPlaying('dala'); await p.waitForTimeout(3000);
console.log(JSON.stringify(await state()), await ev(() => [window.__mobius.state, window.__mobius.story.stage]));
const c = await state(); check(`story chase (${c.st}) → ${c.id} playing`, c.st === 'story' && c.id === 'dala' && c.playing);
await ev(() => window.__mobius.story.enterStage('window')); // leave the chase (back to a room stage)
await p.waitForFunction(() => !window.__A._bgm, null, { timeout: 300000, polling: 1000 }).catch(() => {});
console.log('stage now', await ev(() => window.__mobius.story.stage));
const rf = await state(); check(`story leaves the chase (${rf.st}) → BGM off (${rf.id})`, rf.id === null);
console.log(errs.length ? errs.join('\n') : 'no errors'); await b.close(); process.exit(fails ? 1 : 0);
