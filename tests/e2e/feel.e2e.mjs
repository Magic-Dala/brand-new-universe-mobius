// v0.45 feel pass end-to-end (headless Chromium + SwiftShader; needs `npm run dev`). World Chase on one map (MAP, default
// foldscape). ONLY=<comma list> runs a subset (entering a world takes minutes in software GL):
//   warp, input, off, paused        impact time (one world load)
//   leak = leak.defeat, leak.restart, leak.map, leak.main   (Review Focus 1: nothing of a warp / muffled music survives leaving the chase)
//   flow = flow.gain, flow.results, flow.off   Flow meter (flow.off reloads the world once: Chase Again with flowMeter off)
//   speed = speed.off, speed.on   speed FX (rope tension voices; MAP=forest for the 10 s bench check)
//   sfx             designed samples load from /audio/sfx/ and are used in the chase only (useBank)
//   fin = fin.player, fin.killframe, fin.hands, fin.timeout, fin.pause, fin.nodamage, fin.simul, fin.restart, fin.off, fin.noimpact   boss finisher
//         (each needs a fresh run: one world reload per check — run them two or three at a time)
import { chromium } from 'playwright';
const OUT = process.env.OUT || '.';
const MAP = process.env.MAP || 'foldscape';
const ALL = ['warp', 'input', 'off', 'paused', 'leak.defeat', 'leak.restart', 'leak.map', 'leak.main', 'flow.gain', 'flow.results', 'flow.off', 'speed.off', 'speed.on', 'fin.player', 'fin.killframe', 'fin.hands', 'fin.timeout', 'fin.pause', 'fin.nodamage', 'fin.simul', 'fin.restart', 'fin.off', 'fin.noimpact', 'sfx'];
const ONLY = (process.env.ONLY || ALL.join(',')).split(',').filter(Boolean).flatMap((k) => (k === 'leak' || k === 'flow' || k === 'speed' || k === 'fin' ? ALL.filter((x) => x.startsWith(`${k}.`)) : [k]));
const want = (k) => ONLY.includes(k);
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required', '--ignore-certificate-errors'] });
const p = await b.newPage({ viewport: { width: +(process.env.W || 480), height: +(process.env.H || 270) }, ignoreHTTPSErrors: true });
const logs = []; p.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`)); p.on('console', (m) => { if (m.type() === 'error') logs.push(`[error] ${m.text()}`); });
const results = []; let fails = 0;
const T0 = Date.now(), el = () => `${((Date.now() - T0) / 1000).toFixed(0)} s`;
const check = (name, ok, info = '') => { results.push({ name, ok, info }); if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info && !ok ? ' — ' + info : ''}  [${el()}]`); };
const ev = (fn, arg) => p.evaluate(fn, arg);
const frames = async (n) => { const f0 = await ev(() => window.__frames || 0); await p.waitForFunction((x) => (window.__frames || 0) >= x, f0 + n, { timeout: 600000, polling: 100 }); };
const until = (fn, arg, ms = 300000) => p.waitForFunction(fn, arg, { timeout: ms, polling: 50 });
const wait = (ms) => p.waitForTimeout(ms);

await p.goto(process.env.URL || 'https://localhost:8443/', { waitUntil: 'load' });
await p.waitForFunction(() => window.__mobius && !document.getElementById('enter').disabled, null, { timeout: 200000 });
await ev(async () => {
  const a = window.__mobius, hub = a.hub, orig = hub.update.bind(hub), T = window.__THREE;
  window.__inj = []; window.__frames = 0; window.__inner = 0; window.__log = null;
  hub.update = (f, t) => { orig(f, t); window.__frames++; if (window.__held) Object.assign(hub.webHeld, window.__held); if (window.__heldOnce) { Object.assign(hub.webHeld, window.__heldOnce); window.__heldOnce = null; } if (window.__log) window.__log.push({ f: window.__frames, inner: window.__inner, t, now: performance.now() / 1000, s: a.timeWarp?.scale, st: a.state, fc: a.feelMusic?.warpCutoff, mf: window.__mf?.[0] }); for (const e of window.__inj.splice(0)) hub.events.push(e); };
  // game real time (the unscaled, 0.1 s-capped frame dt main.js passes as realDt): software GL runs at ~1 fps, so the
  // finisher's real-time windows are measured on this clock, not the wall clock. __frt = in 'finisher', unpaused; __prt = paused
  window.__frt = 0; window.__prt = 0; const wu = a.worldChase.update.bind(a.worldChase);
  a.worldChase.update = (dt, t, rdt = dt) => { const w = a.worldChase; if (w.state === 'finisher') { if (w.paused || a.menus.open) window.__prt += rdt; else window.__frt += rdt; } return wu(dt, t, rdt); };
  const inner = a._frameInner.bind(a); a._frameInner = (...x) => { window.__inner++; return inner(...x); }; // rendered frames
  a.audioOff = true;
  window.__FEEL_FIN = (await import('/src/data/feel.js')).FEEL.finisher;
  window.__A = (await import('/src/core/audio.js')).audio; window.__S = (await import('/src/core/settings.js')).settings;
  const sf = window.__A.setMusicFilter.bind(window.__A); window.__mf = null; window.__A.setMusicFilter = (c, l = 1) => { window.__mf = [c, l]; return sf(c, l); };
});
const enter = async (id, how = 'enter') => {
  if (how === 'enter') await ev((id) => { const a = window.__mobius; a.worldChase.bench = null; a.pendingMap = id; a.enterDesktop(); }, id);
  await p.waitForFunction((id) => { const a = window.__mobius; return a.state === 'world' && a.worldChase.state && a.worldChase.mapId === id && !a.loader.visible; }, id, { timeout: 900000, polling: 500 });
  await ev(() => { window.__mobius.worldChase.stateTime = 99; });
  await until(() => window.__mobius.worldChase.state === 'chase');
  await ev(() => { const w = window.__mobius.worldChase; w.fight.nextAttackIn = 1e9; }); // quiet fight (v0.46: no tether cooldown any more — none of these checks webs a staggered boss in the chase; fin.killframe's web kills on arrival)
};
/** a fresh stagger (fight reset first so forceStagger is accepted); returns __frames at the call */
const stagger = () => ev(() => { const w = window.__mobius.worldChase; w.debug.reset(); w.fight.nextAttackIn = 1e9; w.debug.stagger(); return window.__frames; });
const scale = () => ev(() => window.__mobius.timeWarp?.scale);
/** music filter: the real low-pass value when the audio graph runs, else the last setMusicFilter() arguments */
const music = () => ev(() => { const A = window.__A, a = window.__mobius; return { lp: A.musicLP ? Math.round(A.musicLP.frequency.value) : null, ctx: A.ctx?.state ?? null, last: window.__mf, feel: a.feelMusic ? { ...a.feelMusic } : null }; });
const musicOpen = (m) => (m.lp != null && m.ctx === 'running' ? m.lp >= 19000 : !!m.last && m.last[0] >= 19000) && (!m.last || m.last[1] === 1);
const inWorld = () => ev(() => { const a = window.__mobius; return a.state === 'world' && a.worldChase.state === 'chase' && a.worldChase.run.running && !a.loader.visible; });

console.log(`---- enter ${MAP} (checks: ${ONLY.join(', ')})`); await enter(MAP); await frames(3); console.log(`---- in the chase after ${el()}`);

if (want('warp') || want('input')) {
  await ev(() => { window.__log = []; });
  const f0 = await stagger();
  await wait(1000); await until((f0) => (window.__frames || 0) >= f0 + 11, f0, 300000); // ≥ 1 s wall and ≥ 1 s of (0.1 s-capped) frame time
  const s1 = await scale();
  const log = await ev(() => { const l = window.__log; window.__log = null; return l; });
  const first = log.find((e) => e.s === 0.25); // e.s / e.fc / e.mf = the state after frame e.f − 1
  const fc = Math.min(...log.map((e) => e.fc ?? 20000)), mf = Math.min(...log.map((e) => e.mf ?? 20000));
  if (want('warp')) check(`warp on counter stagger: scale 0.25 from frame +${first ? first.f - 1 - f0 : '—'} (≤ 3), music low-pass down to ${mf.toFixed(0)} Hz (feel ${fc.toFixed(0)}); after 1 s scale ${s1}`,
    !!first && first.f - 1 - f0 <= 3 && s1 === 1 && fc < 2000 && mf < 2000, JSON.stringify({ f0, head: log.slice(0, 8).map((e) => [e.f, +e.s.toFixed(3), Math.round(e.fc)]) }));
  if (want('input')) {
    const w = log.filter((e) => e.s < 1), n = w.length;
    const perFrame = log.every((e, i) => i === 0 || (e.f - log[i - 1].f === 1 && e.inner - log[i - 1].inner === 1)); // one hub.update per rendered frame
    const dT = n > 1 ? w[n - 1].t - w[0].t : 0, dNow = n > 1 ? w[n - 1].now - w[0].now : 0, drift = Math.max(...log.map((e) => Math.abs(e.now - e.t)));
    check(`input stays real time: ${n} warped frames, hub.update once per frame ${perFrame}, tNow advanced ${dT.toFixed(3)} s over ${dNow.toFixed(3)} s wall (drift ≤ ${drift.toFixed(3)} s)`,
      n >= 2 && perFrame && Math.abs(dT - dNow) < 0.05 + 0.05 * dNow && drift < 0.25);
  }
}
if (want('off')) {
  await ev(() => { window.__S.impactTime = false; });
  const f0 = await stagger();
  let mx = 1; for (let i = 0; i < 4; i++) { await frames(1); mx = Math.min(mx, await scale()); }
  const st = await ev(() => window.__mobius.worldChase.fight.state);
  await ev(() => { window.__S.impactTime = true; });
  check(`off switch: impactTime=false → stagger (${st}) leaves scale ${mx}`, mx === 1 && st === 'staggered', `f0 ${f0}`);
}
if (want('sfx')) {
  const r = await ev(async () => { const A = window.__A; A.unlock(); await A.loadSfx(); const inWorld = A.useBank; return { running: A.running, web: !!A.bank?.has('web'), boom: !!A.bank?.has('boomEnemy'), inWorld }; });
  check(`sfx: samples load from /audio/sfx/ in a real chase (audio running ${r.running}, web ${r.web}, boomEnemy ${r.boom}, useBank in the chase ${r.inWorld})`, r.running && r.web && r.boom && r.inWorld, JSON.stringify(r));
}
if (want('paused')) {
  await stagger();
  await until(() => window.__mobius.timeWarp?.scale < 1, null, 60000);
  const s0 = await ev(() => { const a = window.__mobius; a.worldChase.pause(); return a.timeWarp.scale; });
  await wait(1000); await frames(2);
  const s1 = await scale(), m = await music();
  await ev(() => window.__mobius.worldChase.resume());
  const back = await until(() => window.__mobius.timeWarp.scale === 1, null, 20000).then(() => true, () => false);
  check(`paused warp holds: scale ${s0} → ${s1} after 1 s paused (music open while paused: ${musicOpen(m)}); resumed → 1 ${back}`, s0 < 1 && s1 === s0 && back && musicOpen(m), JSON.stringify(m));
}
/** stagger, then on the next frame leave the chase with `leave`: from the first frame after it scale 1 and the music filter
 *  commanded fully open; after 0.5 s the low-pass itself is open (≥ 19 kHz) */
const leak = async (name, leave) => {
  await ev(() => { window.__S.flowMeter = false; }); // (the Flow meter's level-0 low-pass in the next chase is not a warp leak: flow.* checks cover the Flow)
  if (!(await inWorld())) await enter(MAP, 'wait');
  await stagger();
  await until(() => window.__mobius.timeWarp?.scale < 1, null, 120000);
  const s0 = await scale(), m0 = await music();
  const fL = await ev((leave) => { window.__log = []; (0, eval)(`(${leave})`)(); return window.__frames; }, leave.toString());
  await frames(1); await wait(500); await frames(2);
  const s1 = await scale(), m = await music();
  const after = await ev((fL) => { const l = window.__log; window.__log = null; return l.filter((e) => e.f >= fL + 2); }, fL); // state after frame fL + 1 onwards
  const clean = after.length > 0 && after.every((e) => e.s === 1 && e.mf === 20000 && e.fc === 20000);
  check(`no leak (${name}): warp ${s0.toFixed(2)} / music ${m0.lp} Hz → ${[...new Set(after.map((e) => e.st))].join(' → ')}: scale 1 + filter open on all ${after.length} frames ${clean}; after 0.5 s scale ${s1}, low-pass ${m.lp ?? '—'} Hz (ctx ${m.ctx}, last ${JSON.stringify(m.last)})`,
    s0 < 1 && clean && s1 === 1 && musicOpen(m) && m.feel?.warpCutoff === 20000, JSON.stringify(after.slice(0, 4)));
  await ev(() => { window.__S.flowMeter = true; });
};
if (want('leak.defeat')) await leak('player defeat', () => { const w = window.__mobius.worldChase; w._playerHit(999, null, 'test'); });
if (want('leak.restart')) {
  if (want('leak.defeat')) await ev(() => window.__mobius.worldChase.restart()); // (defeat → results: Chase Again)
  await leak('Chase Again', () => window.__mobius.worldChase.restart());
}
if (want('leak.map')) await leak('pause → Change Map', () => { const a = window.__mobius; a.toggleMenu(); a.menus.show('worldMaps', { from: 'pause' }); a.menus.panels.worldMaps.buttons.find((x) => x.id === `map-${a.worldChase.mapId}`).onClick(); });
if (want('leak.main')) {
  await leak('pause → Main Menu', () => { const a = window.__mobius; a.toggleMenu(); a.menuMain(); });
  const f0 = await ev(() => { const a = window.__mobius; a.timeWarp.request('counter'); return { f: window.__frames, st: a.state }; }); // a stray request outside the chase (menus / Arcade / Story)
  await frames(2);
  const s = await scale();
  check(`outside the chase (${f0.st}) a stray warp request is cleared next frame: scale ${s}`, s === 1);
}

// ---- v0.45 Flow meter
/** one pumpkin launched from beside the player (away from Green Maniac's line, so the web cannot pick him), then a real
 *  web event aimed straight at it through the injected input path; resolves once it is destroyed (or after 12 frames) */
const shootOne = async () => {
  const d0 = await ev(() => {
    const a = window.__mobius, T = window.__THREE, w = a.worldChase, B = w.bombs, loco = a.locomotion;
    const chest = loco.feet(new T.Vector3()).add(new T.Vector3(0, 1.3, 0));
    const toBoss = w.bossPos.clone().sub(chest).setY(0).normalize(), side = new T.Vector3(-toBoss.z, 0, toBoss.x);
    const it = B._get(); if (!it) return null;
    it.pos.copy(chest).addScaledVector(side, 7).addScaledVector(toBoss, 3).add(new T.Vector3(0, 1.5, 0));
    B._launch(it, chest, new T.Vector3(), { T: 3 });
    window.__inj.push({ type: 'web', hand: 'right', origin: chest.clone(), dir: it.pos.clone().sub(chest).normalize() });
    return B.stats.destroyed;
  });
  for (let i = 0; i < 12; i++) { await frames(1); if (await ev((d0) => window.__mobius.worldChase.bombs.stats.destroyed > d0, d0)) return true; }
  return false;
};
const flowState = () => ev(() => { const a = window.__mobius, w = a.worldChase; return { level: w.flow?.level, pts: w.flow?.points, style: w.flow?.style, peak: w.flow?.peak, fx: a.fx.flowLevel, tint: a.windFx.flowTint, cut: a.feelMusic.flowCutoff, lift: a.feelMusic.lift, hud: a.hud.chase.flow ?? null }; });
const shoot4 = async () => { await ev(() => { const w = window.__mobius.worldChase; w.bombs.clear(); w.hp.reset(); }); let n = 0; for (let i = 0; i < 4; i++) n += (await shootOne()) ? 1 : 0; await frames(2); return n; };
/** victory via the debug hook + one boss hit; returns the results context once the panel is up */
const win = async () => {
  await ev(() => { const w = window.__mobius.worldChase; w.debug.setBossHp(0.01); w._bossHit(5, w.bossPos.clone(), null, 'test'); });
  await until(() => window.__mobius.menus.current === 'worldResults', null, 120000);
  return ev(() => { const r = window.__mobius.menus.ctx.worldResult; return { ...r, keys: Object.keys(r), panelH: window.__mobius.menus.panels.worldResults.ch, home: window.__mobius.menus.panels.worldResults.buttons.find((x) => x.id === 'home').y }; });
};
if (want('flow.gain') || want('flow.results')) {
  if (!(await inWorld())) await enter(MAP, 'wait');
  await ev(() => { window.__S.flowMeter = true; });
  const n = await shoot4(), f1 = await flowState();
  check(`flow: ${n}/4 injected pumpkin shoot-downs → level ${f1.level} (${f1.pts} pts), fx.flowLevel ${f1.fx}, wind tint ${f1.tint}, music flowCutoff ${f1.cut}, HUD ${JSON.stringify(f1.hud)}`,
    n === 4 && f1.level === 1 && f1.fx === 1 && f1.cut === 9000 && f1.tint > 0 && f1.hud?.level === 1, JSON.stringify(f1));
  await ev(() => { const w = window.__mobius.worldChase; w._playerHit(10, null, 'test'); }); await frames(2);
  const f2 = await flowState();
  check(`flow: a player hit → level ${f2.level}, fx.flowLevel ${f2.fx}, music flowCutoff ${f2.cut} (peak kept ${f2.peak})`, f2.level === 0 && f2.fx === 0 && f2.cut === 5000 && f2.peak === 1, JSON.stringify(f2));
  if (want('flow.results')) {
    const r = await win();
    const best = await ev((m) => window.__mobius.worldChase && JSON.parse(localStorage.getItem('mobius.worldBest.v1') || '{}')[m], MAP);
    check(`flow results: style ${r.style}, peak flow ${r.peakFlow}; world best style ${best?.style} (panel ${r.panelH} px, buttons at ${r.home})`,
      r.style > 0 && r.peakFlow >= 1 && best?.style === r.style && r.panelH === 900 && r.home === 900 - 124, JSON.stringify({ r, best }));
  }
}
if (want('flow.off')) {
  if (await ev(() => window.__mobius.menus.current === 'worldResults')) { // leave from the results panel (Chase Again): nothing of the Flow survives
    const lv = await ev(() => window.__mobius.worldChase.flow?.level);
    await ev(() => { window.__mobius.menus.panels.worldResults.buttons.find((x) => x.id === 'again').onClick(); });
    await until(() => window.__mobius.worldChase.state === null || window.__mobius.loader.visible, null, 120000);
    const f = await flowState();
    check(`flow leak (Chase Again from level ${lv}): fx.flowLevel ${f.fx}, wind tint ${f.tint}, music ${f.cut} Hz × ${f.lift}`, f.fx === 0 && f.tint === 0 && f.cut === 20000 && f.lift === 1, JSON.stringify(f));
  }
  await ev(() => { window.__S.flowMeter = false; });
  if (!(await inWorld())) await enter(MAP, (await ev(() => window.__mobius.state === 'world')) ? 'wait' : 'enter');
  const n = await shoot4(), f = await flowState();
  const r = await win();
  await ev(() => { window.__S.flowMeter = true; });
  check(`flow off: ${n}/4 shoot-downs → level ${f.level}, fx ${f.fx}, music ${f.cut} Hz, HUD ${JSON.stringify(f.hud)}; results keys [${r.keys}] (panel ${r.panelH} px, buttons at ${r.home})`,
    n === 4 && f.level === 0 && f.fx === 0 && f.cut === 20000 && f.lift === 1 && f.hud == null && !('style' in r) && !('peakFlow' in r) && r.panelH === 740 && r.home === 740 - 124, JSON.stringify({ f, r }));
}

if (want('speed.off') || want('speed.on')) {
  if (!(await inWorld())) await enter(MAP, 'wait');
  // a web on a moving anchor 12 m up and ahead, the player carried at 14 m/s (centripetal load ≈ 16 m/s² → tension level ≈ 0.5); counts startTension / whoosh calls
  const swing = (sec) => ev(async (sec) => {
    const a = window.__mobius, T = window.__THREE, loco = a.locomotion, w = a.worldChase, A = window.__A;
    w.fight.nextAttackIn = 1e9; w.startBench(sec + 5, 14);
    window.__st = 0; const st = A.startTension.bind(A); if (!A.__spy) { A.__spy = true; A.startTension = (...x) => { window.__st++; return st(...x); }; }
    const t0 = performance.now(); let ropes = 0;
    while (performance.now() - t0 < sec * 1000) {
      if (!loco.ropes.length) { const f = loco.feet(new T.Vector3()); const an = { id: 'speedfx-test', p: f.clone().add(new T.Vector3(0, 12, 0)), valid: true, moving: true, building: null, cell: null }; loco.attachTo(an, { hand: 'right', origin: a.camera.getWorldPosition(new T.Vector3()), dir: new T.Vector3(0, 1, 0) }); }
      ropes = Math.max(ropes, loco.ropes.length); await new Promise((r) => setTimeout(r, 100));
    }
    loco.detach(true); w.bench = null; return { st: window.__st, ropes };
  }, sec);
  if (want('speed.off')) {
    await ev(() => { window.__S.speedFx = false; });
    const r = await swing(3);
    check(`speed off: ${r.ropes} rope(s) for 3 s, tension voices created ${r.st} (expect 0)`, r.ropes > 0 && r.st === 0, JSON.stringify(r));
    await ev(() => { window.__S.speedFx = true; });
  }
  if (want('speed.on')) {
    const w1 = await ev(async () => { // one injected web event (a miss: aimed down) during a swing with speedFx on → exactly one audio.play('web', …)
      const a = window.__mobius, T = window.__THREE, loco = a.locomotion, A = window.__A; a.worldChase.fight.nextAttackIn = 1e9; a.worldChase.startBench(8, 14);
      const calls = [], pl = A.play.bind(A); A.play = (n, ...x) => { calls.push(n); return pl(n, ...x); };
      const f = loco.feet(new T.Vector3()); loco.attachTo({ id: 'speedfx-web', p: f.clone().add(new T.Vector3(0, 12, 0)), valid: true, moving: true, building: null, cell: null }, { hand: 'right', origin: a.camera.getWorldPosition(new T.Vector3()), dir: new T.Vector3(0, 1, 0) });
      await new Promise((r) => setTimeout(r, 400)); calls.length = 0;
      window.__inj.push({ type: 'web', hand: 'left', origin: a.camera.getWorldPosition(new T.Vector3()), dir: new T.Vector3(0, -1, 0) });
      await new Promise((r) => setTimeout(r, 500)); delete A.play; loco.detach(true); a.worldChase.bench = null; return calls;
    });
    check(`speed on: one injected web event → audio.play('web') calls ${w1.filter((n) => n === 'web').length} (expect 1), all calls ${JSON.stringify(w1)}`, w1.filter((n) => n === 'web').length === 1, JSON.stringify(w1));
    const n0 = logs.length, r = await swing(10);
    check(`speed on (${MAP}): 10 s of bench swinging, tension voices requested ${r.st} (expect > 0), page errors ${logs.length - n0} (expect 0), listener set ${await ev(() => !!window.__A._lpos)}`, r.st > 0 && logs.length === n0, JSON.stringify({ r, errs: logs.slice(n0, n0 + 3) }));
  }
}

// ---- v0.45 boss finisher
/** a fresh, quiet chase run (Chase Again unless the current run is still a plain, unresolved chase) */
const finFresh = async () => {
  const ok = await ev(() => { const a = window.__mobius, w = a.worldChase; return a.state === 'world' && w.state === 'chase' && w.run.running && !a.loader.visible && w.finisher?.state === 'idle'; });
  if (!ok) {
    if (await ev(() => window.__mobius.state === 'world')) {
      await ev(() => window.__mobius.worldChase.restart());
      await until(() => window.__mobius.worldChase.state === null || window.__mobius.loader.visible, null, 120000);
      await enter(MAP, 'wait');
    } else await enter(MAP);
  }
  await ev(() => { const w = window.__mobius.worldChase; window.__held = null; window.__S.finisher = true; w.debug.reset(); w.fight.nextAttackIn = 1e9; w.hp.reset(); w.flow.reset(); w.bombs.clear(); });
  await frames(2);
};
/** boss to 1 HP, then one web hit (the authoritative damage path) */
const finKill = () => ev(() => { const a = window.__mobius, w = a.worldChase; w.debug.setBossHp(1 / w.bossHp.max); w._bossHit(5, w.bossPos.clone(), null, 'web'); window.__k0 = performance.now(); window.__frt = 0; window.__prt = 0; return { st: w.state, fin: w.finisher?.state, s: a.timeWarp.scale, boss: w.bossHp.hp, hp: w.hp.hp, active: w.bombs.items.filter((x) => x.active).length }; });
const finSt = () => ev(() => { const a = window.__mobius, w = a.worldChase; return { st: w.state, fin: w.finisher?.state, s: a.timeWarp.scale, out: w.run.outcome, since: +((performance.now() - window.__k0) / 1000).toFixed(1), rt: +window.__frt.toFixed(2), prt: +window.__prt.toFixed(2), by: w.stats?.finisher ?? null, ban: a.hud.banner?.text }; });
const finResults = async () => { await until(() => window.__mobius.menus.current === 'worldResults', null, 120000); await frames(2); return ev(() => { const a = window.__mobius, w = a.worldChase; return { style: a.menus.ctx.worldResult.style, outcome: a.menus.ctx.worldResult.outcome, s: a.timeWarp.scale, fin: w.finisher.state }; }); };
const victory = (ms = 300000) => until(() => ['victory', 'results'].includes(window.__mobius.worldChase.state), null, ms).then(() => true, () => false);
const gameTime = (k, sec) => until(([k, sec]) => window[k] >= sec || window.__mobius.worldChase.state !== 'finisher', [k, sec], 300000); // (game real time)
if (want('fin.player')) {
  await finFresh();
  const k = await finKill();
  await ev(() => window.__inj.push({ type: 'finisherKey' }));
  const won = await victory(), s1 = await finSt(), r = await finResults();
  check(`finisher (player): kill → ${k.st}/${k.fin} at scale ${k.s}; finisherKey → ${s1.st} after ${s1.rt} s game real time (≤ 3; wall ${s1.since} s, by ${s1.by}); results ${r.outcome}, style ${r.style}, scale ${r.s}, finisher ${r.fin}`,
    k.st === 'finisher' && k.fin === 'stall' && k.s === 0.2 && won && s1.rt <= 3 && s1.by === 'player' && r.outcome === 'victory' && r.style >= 1500 && r.s === 1 && r.fin === 'idle', JSON.stringify({ k, s1, r }));
}
if (want('fin.killframe')) { // the kill lands INSIDE the frame (a web in the events loop) + a second web in that frame: nothing of the normal boss update / tether runs after it
  await finFresh();
  await ev(() => { const a = window.__mobius, w = a.worldChase, j = a.boss.jet, T = window.__THREE;
    window.__thr = []; window.__teth = 0; window.__onWebFin = 0; window.__killOnWeb = true;
    if (!j.__thrWrap) { j.__thrWrap = true; const o = j.setThrust; j.setThrust = function (v) { window.__thr?.push(v); return o.call(this, v); }; }
    if (!w.__kfWrap) { w.__kfWrap = true; const st = w._startTether, ow = w._onWeb;
      w._startTether = function (...x) { window.__teth++; return st.apply(this, x); };
      w._onWeb = function (...x) {
        if (window.__killOnWeb) { window.__killOnWeb = false; this.debug.setBossHp(1 / this.bossHp.max); window.__thr = []; this._bossHit(5, this.bossPos.clone(), null, 'web'); window.__frt = 0; window.__prt = 0; return; }
        if (this.state === 'finisher') window.__onWebFin++;
        return ow.apply(this, x); }; }
    const o = a.camera.getWorldPosition(new T.Vector3()), d = w.bossPos.clone().sub(o).normalize();
    window.__inj.push({ type: 'web', hand: 'right', origin: o, dir: d }, { type: 'web', hand: 'left', origin: o.clone(), dir: d.clone() }); });
  await until(() => !window.__killOnWeb);
  const kf = () => ev(() => { const a = window.__mobius, w = a.worldChase; return { st: w.state, fin: w.finisher.state, thr: [...window.__thr], last: window.__thr.at(-1), teth: window.__teth, tether: !!w.tether, onWebFin: window.__onWebFin, rt: +window.__frt.toFixed(2) }; });
  const s0 = await kf();
  await gameTime('__frt', 1); await frames(1);
  const s1 = await kf();
  await ev(() => { window.__killOnWeb = false; });
  const ok = (q) => q.last === 0.1 && q.thr.every((v) => v === 0.1) && q.teth === 0 && !q.tether && q.onWebFin === 0;
  check(`finisher (kill frame): web kill inside the frame → ${s0.st}/${s0.fin}, jet thrust ${JSON.stringify(s0.thr)}, tethers ${s0.teth}, normal webs in the finisher ${s0.onWebFin}; ${s1.rt} s real later (${s1.st}/${s1.fin}) thrust ${s1.last}, tethers ${s1.teth}`,
    s0.st === 'finisher' && ok(s0) && s1.st === 'finisher' && s1.rt >= 1 && ok(s1), JSON.stringify({ s0, s1 }));
  await victory();
}
if (want('fin.hands')) {
  await finFresh();
  /** a web event from the camera toward a world point (or along `dir`) */
  const webAt = (hand, to) => ev(([hand, to]) => { const a = window.__mobius, T = window.__THREE, o = a.camera.getWorldPosition(new T.Vector3()), w = a.worldChase; const p = to === 'jet' ? w.jetAnchor.p : new T.Vector3(...to); window.__inj.push({ type: 'web', hand, origin: o.clone(), dir: p.clone().sub(o).normalize() }); }, [hand, to]);
  const st = () => ev(() => { const a = window.__mobius, w = a.worldChase, l = a.locomotion; return { fin: w.finisher.state, hands: w.finisher.hands, beams: { left: !!w._finBeams.left, right: !!w._finBeams.right }, ropes: { left: !!l.ropeOf('left'), right: !!l.ropeOf('right') }, rt: +window.__frt.toFixed(2), ban: a.hud.banner?.text }; });
  // a real swing rope on the left hand (held), then the kill: Mobius keeps swinging into the finisher
  await ev(() => { window.__held = { left: true, right: true }; const a = window.__mobius, T = window.__THREE, loco = a.locomotion, f = loco.feet(new T.Vector3());
    loco.attachTo({ id: 'fin-swing', p: f.clone().add(new T.Vector3(0, 12, 0)), valid: true, moving: true, building: null, cell: null }, { hand: 'left', origin: a.camera.getWorldPosition(new T.Vector3()), dir: new T.Vector3(0, 1, 0) }); });
  await frames(2);
  const k = await finKill();
  await ev(() => { const F = window.__mobius.worldChase.finisher; F.cfg = { ...F.cfg, timeout: 60 }; }); // (this check takes many steps: a long window on THIS instance only — FEEL is untouched; restored below)
  await frames(1);
  const s0 = await st();
  await webAt('left', 'jet'); await webAt('right', 'jet'); await frames(2);
  const s1 = await st();
  check(`finisher (hands): swinging on the left (${s0.ropes.left}) through the kill (${k.st}); two webs at the jet → ${s1.fin} ${JSON.stringify(s1.hands)}, beams ${JSON.stringify(s1.beams)}, left swing rope released first (${!s1.ropes.left}), banner "${s1.ban}"`,
    k.st === 'finisher' && s0.ropes.left && s1.fin === 'tethered' && s1.hands.left && s1.hands.right && s1.beams.left && s1.beams.right && !s1.ropes.left && !s1.ropes.right, JSON.stringify({ k, s0, s1 }));
  // web.held flicker: one false frame keeps the strand; false for ≥ 0.3 s of real frame time lets go
  await ev(() => { window.__heldOnce = { left: false }; }); await frames(2);
  const s2 = await st();
  const t0 = s2.rt; await ev(() => { window.__held = { left: false, right: true }; });
  await until((t) => window.__frt >= t + 0.3 || window.__mobius.worldChase.state !== 'finisher', t0, 300000); await frames(1);
  const s3 = await st();
  check(`finisher (hands): webHeld false for ONE frame → ${s2.fin} (left ${s2.hands.left}, beam ${s2.beams.left}); false for ${(s3.rt - t0).toFixed(2)} s real → ${s3.fin} (left ${s3.hands.left}, beam ${s3.beams.left})`,
    s2.fin === 'tethered' && s2.hands.left && s2.beams.left && s3.fin === 'stall' && !s3.hands.left && !s3.beams.left && s3.hands.right, JSON.stringify({ s2, s3 }));
  // a web aimed away from the jet during the finisher still swings (a real anchor, > aimDeg + 10° off the jet)
  await ev(() => { window.__held = { left: true, right: true }; });
  const anc = await ev(() => { const a = window.__mobius, T = window.__THREE, w = a.worldChase, l = a.locomotion, o = a.camera.getWorldPosition(new T.Vector3()), j = w.jetAnchor.p.clone().sub(o).normalize(), chest = l.feet(new T.Vector3()).add(new T.Vector3(0, 1.3, 0));
    const c = l.anchorCandidates(o).map((x) => x.anchor).filter((x) => x.valid && !l.occluded(o, x.p, x.building) && !l.occluded(chest, x.p, x.building) && x.p.distanceTo(chest) < 25 && x.p.clone().sub(o).normalize().angleTo(j) * 180 / Math.PI > 35);
    return c[0] ? [c[0].p.x, c[0].p.y, c[0].p.z] : null; });
  if (anc) { await webAt('left', anc); await frames(2); }
  const s4 = await st();
  // back on the jet with the left hand (its swing let go first), then the pull
  await webAt('left', 'jet'); await frames(2);
  const s5 = await st();
  const pulled = await ev(() => window.__mobius.worldChase.finisher.pull());
  const won = await victory(), s6 = await finSt(), r = await finResults();
  await ev(() => { window.__held = null; const F = window.__mobius.worldChase.finisher; F.cfg = window.__FEEL_FIN; });
  check(`finisher (hands): web away from the jet (anchor ${anc ? 'found' : 'NONE'}) → swing ${s4.ropes.left}, still ${s4.fin}; left back on the jet → ${s5.fin} (swing released ${!s5.ropes.left}, ${s5.rt} s in); pull() ${pulled} → ${s6.st} by ${s6.by}; style ${r.style}, scale ${r.s}, finisher ${r.fin}`,
    !!anc && s4.ropes.left && !s4.hands.left && s4.fin === 'stall' && s5.fin === 'tethered' && !s5.ropes.left && pulled && won && s6.by === 'player' && r.style >= 1500 && r.fin === 'idle' && r.s === 1, JSON.stringify({ anc, s4, s5, s6, r }));
}
if (want('fin.timeout')) {
  await finFresh();
  const k = await finKill();
  const won = await victory(), s1 = await finSt(), r = await finResults();
  check(`finisher (timeout): no input → ${s1.st} after ${s1.rt} s game real time (expect 4–6.5; wall ${s1.since} s), by ${s1.by}; style ${r.style} (no bonus), scale ${r.s}`,
    k.st === 'finisher' && won && s1.rt >= 4 && s1.rt <= 6.5 && s1.by === 'timeout' && r.style < 1500 && r.s === 1 && r.fin === 'idle', JSON.stringify({ k, s1, r }));
}
if (want('fin.pause')) {
  await finFresh();
  const k = await finKill();
  await gameTime('__frt', 1);
  await ev(() => window.__mobius.worldChase.pause());
  await gameTime('__prt', 6); await frames(2);
  const p = await finSt();
  await ev(() => { window.__mobius.worldChase.resume(); window.__k0 = performance.now(); });
  await frames(3); const ban = await ev(() => window.__mobius.hud.banner?.until > window.__mobius.hud._now ? window.__mobius.hud.banner.text : null);
  const won = await victory(), s1 = await finSt();
  check(`finisher (pause): ${p.rt} s in, paused ${p.prt} s game real time → ${p.st}/${p.fin} (scale ${p.s}); resumed (prompt "${ban}") → ${s1.st} ${(s1.rt - p.rt).toFixed(2)} s later (expect ≈ 3 + 0.8 blast; wall ${s1.since} s, by ${s1.by})`,
    k.st === 'finisher' && p.st === 'finisher' && p.fin === 'stall' && p.s === 0.2 && p.prt >= 6 && !!ban && won && s1.rt - p.rt >= 2.5 && s1.rt - p.rt <= 4.5 && s1.by === 'timeout', JSON.stringify({ k, p, s1 }));
}
if (want('fin.nodamage')) {
  await finFresh();
  const pre = await ev(() => {
    const a = window.__mobius, T = window.__THREE, w = a.worldChase, B = w.bombs, loco = a.locomotion;
    w.debug.attack('single');
    const chest = loco.feet(new T.Vector3()).add(new T.Vector3(0, 1.3, 0)), it = B._get();
    if (it) { it.pos.copy(chest).add(new T.Vector3(3, 2, -3)); B._launch(it, chest, new T.Vector3(), { T: 2 }); }
    return { hp: w.hp.hp, launched: !!it };
  });
  await frames(1);
  const before = await ev(() => window.__mobius.worldChase.bombs.items.filter((x) => x.active).length);
  const k = await finKill(); k.before = before;
  let worst = { hp: k.hp, active: 0, hit: 0 };
  for (let i = 0; i < 10; i++) {
    await frames(2);
    const q = await ev(() => { const w = window.__mobius.worldChase; return { st: w.state, hp: w.hp.hp, active: w.bombs.items.filter((x) => x.active).length, hit: w._playerHit(10, null, 'test') }; });
    if (q.st !== 'finisher') break;
    worst = { hp: Math.min(worst.hp, q.hp), active: Math.max(worst.active, q.active), hit: Math.max(worst.hit, q.hit) };
  }
  check(`finisher (no damage): pumpkin launched (${pre.launched}) + single attack forced, then the kill (${k.before} pumpkin(s) active just before, ${k.active} after) → ${k.st}; during it HP ${k.hp} → ${worst.hp}, active pumpkins ≤ ${worst.active}, direct hit dealt ${worst.hit}`,
    k.st === 'finisher' && pre.launched && k.before > 0 && k.active === 0 && worst.hp === k.hp && worst.active === 0 && worst.hit === 0, JSON.stringify({ pre, k, worst }));
}
if (want('fin.simul')) {
  await finFresh();
  const r = await ev(() => { const a = window.__mobius, w = a.worldChase; w.hp.hp = 1; w.debug.setBossHp(1 / w.bossHp.max); const p = w._playerHit(5, null, 'test'), b = w._bossHit(5, w.bossPos.clone(), null, 'web'); return { p, b, out: w.run.outcome, st: w.state, fin: w.finisher.state, s: a.timeWarp.scale }; });
  await frames(2);
  const s = await scale();
  check(`finisher (simultaneous death): player then boss damage in one frame → ${r.out} (${r.st}), finisher ${r.fin}, boss damage dealt ${r.b}; scale ${s}`, r.out === 'defeat' && r.fin === 'idle' && s === 1, JSON.stringify(r));
}
if (want('fin.restart')) {
  await finFresh();
  const k = await finKill();
  await wait(300);
  const m = await finSt();
  await ev(() => window.__mobius.worldChase.restart());
  await until(() => window.__mobius.worldChase.state === null || window.__mobius.loader.visible, null, 120000);
  const mid = await ev(() => ({ s: window.__mobius.timeWarp.scale, fin: window.__mobius.worldChase.finisher.state }));
  await enter(MAP, 'wait'); await frames(2);
  const r = await ev(() => { const a = window.__mobius, w = a.worldChase; return { s: a.timeWarp.scale, fin: w.finisher.state, st: w.state, beams: a.fx.beams.items.filter((b) => b.active && b.hold).length }; });
  check(`finisher (restart mid-finisher): ${m.st}/${m.fin} → restart (loading: scale ${mid.s}, finisher ${mid.fin}) → ${r.st}: scale ${r.s}, finisher ${r.fin}, held beams ${r.beams}`,
    k.st === 'finisher' && m.fin === 'stall' && mid.fin === 'idle' && r.s === 1 && r.fin === 'idle' && r.beams === 0, JSON.stringify({ k, m, mid, r }));
  // the same from pause → Main Menu (the session leaves the world: teardown → _stopRun)
  await ev(() => { const w = window.__mobius.worldChase; w.debug.reset(); w.fight.nextAttackIn = 1e9; });
  const k2 = await finKill();
  await frames(2);
  await ev(() => { const a = window.__mobius; a.toggleMenu(); a.menuMain(); });
  await frames(3);
  const q = await ev(() => { const a = window.__mobius, w = a.worldChase; return { app: a.state, s: a.timeWarp.scale, fin: w.finisher.state, st: w.state, beams: a.fx.beams.items.filter((b) => b.active && b.hold).length }; });
  check(`finisher (main menu mid-finisher): ${k2.st}/${k2.fin} → pause → Main Menu → ${q.app}: scale ${q.s}, finisher ${q.fin}, chase state ${q.st}, held beams ${q.beams}`,
    k2.st === 'finisher' && q.s === 1 && q.fin === 'idle' && q.st === null && q.beams === 0, JSON.stringify({ k2, q }));
}
if (want('fin.noimpact')) { // impact time off: the finisher still runs, at full speed (no warp hold)
  await finFresh();
  await ev(() => { window.__S.impactTime = false; });
  const k = await finKill();
  let mx = 1; for (let i = 0; i < 3; i++) { await frames(1); const q = await finSt(); if (q.st === 'finisher') mx = Math.min(mx, q.s); }
  const won = await victory(), s1 = await finSt();
  await ev(() => { window.__S.impactTime = true; });
  check(`finisher with impactTime off: kill → ${k.st}/${k.fin}, scale ${k.s} (lowest during it ${mx}); timeout → ${s1.st} after ${s1.rt} s by ${s1.by}`,
    k.st === 'finisher' && k.fin === 'stall' && k.s === 1 && mx === 1 && won && s1.by === 'timeout' && s1.rt >= 4 && s1.rt <= 6.5, JSON.stringify({ k, mx, s1 }));
}
if (want('fin.off')) {
  await finFresh();
  await ev(() => { window.__S.finisher = false; });
  const k = await finKill();
  await ev(() => { window.__S.finisher = true; });
  check(`finisher off: the killing hit → ${k.st} at once (finisher ${k.fin}, scale ${k.s})`, k.st === 'victory' && k.fin === 'idle' && k.s === 1, JSON.stringify(k));
}

console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed`);
if (logs.length) console.log(logs.slice(0, 30).join('\n'));
await b.close();
process.exit(fails || !results.length ? 1 : 0);
