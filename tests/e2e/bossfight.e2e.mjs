// v0.42 World Chase boss fight end-to-end (headless Chromium + SwiftShader; needs `npm run dev`).
//   FULL map (default foldscape): every rule of the fight through the real input path (events injected right after the
//   real InputHub.update(), exactly like a wrist web / Light Bomb / Fan Web from the headset).
//   MAPS (default all eight): compatibility — the fight cycles (single → heavy → core counter → stagger → recovery)
//   while the route streams at chase speed, Green Maniac stays reachable and never enters scenery.
import { chromium } from 'playwright';
const OUT = process.env.OUT || '.';
const FULL = process.env.FULL ?? 'foldscape'; // (FULL= (empty) skips the full-rules section)
const MAPS = (process.env.MAPS ?? 'foldscape,forest,redrock,neon,moonlit,cloudpalace,aurora,molten').split(',').filter(Boolean);
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required', '--ignore-certificate-errors'] });
const p = await b.newPage({ viewport: { width: +(process.env.W || 1280), height: +(process.env.H || 720) }, ignoreHTTPSErrors: true });
const logs = []; p.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`)); p.on('console', (m) => { if (m.type() === 'error') logs.push(`[error] ${m.text()}`); });
const results = []; let fails = 0;
const check = (name, ok, info = '') => { results.push({ name, ok, info }); if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`); };
const shot = (name) => p.screenshot({ path: `${OUT}/${name}.png`, timeout: 240000 }).catch((e) => console.log('shot failed', name, e.message));
const ev = (fn, arg) => p.evaluate(fn, arg);
const frames = async (n) => { const f0 = await ev(() => window.__frames || 0); await p.waitForFunction((x) => (window.__frames || 0) >= x, f0 + n, { timeout: 600000, polling: 100 }); };
const until = (fn, arg, ms = 300000) => p.waitForFunction(fn, arg, { timeout: ms, polling: 50 });

await p.goto(process.env.URL || 'https://localhost:8443/', { waitUntil: 'load' });
const WAIT = +(process.env.WAIT || 60000); // (v1.1: game-clock waits in real ms; raise on a slow software renderer)
await p.waitForFunction(() => window.__mobius && !document.getElementById('enter').disabled, null, { timeout: +(process.env.BOOT || 600000) }); // (v1.1: BOOT, default 10 min: software rendering on a slow machine)
await ev(() => {
  const a = window.__mobius, hub = a.hub, orig = hub.update.bind(hub), T = window.__THREE;
  window.__inj = []; window.__frames = 0;
  hub.update = (f, t) => { orig(f, t); window.__frames++; if (window.__aimFn) window.__aimFn(hub, T); for (const e of window.__inj.splice(0)) hub.events.push(e); };
  a.audioOff = true;
  window.__chest = () => a.locomotion.feet(new T.Vector3()).add(new T.Vector3(0, 1.3, 0));
  window.__o = () => window.__chest().add(new T.Vector3(0.25, 0.1, 0));
  /** a web from the right wrist toward `p` (world) rotated `deg` (yaw) */
  window.__webTo = (p, deg = 0) => { const o = window.__o(), d = p.clone().sub(o).normalize().applyAxisAngle(new T.Vector3(0, 1, 0), (deg * Math.PI) / 180); window.__inj.push({ type: 'web', hand: 'right', origin: o, dir: d }); return +p.distanceTo(o).toFixed(1); };
  window.__lb = (p) => { const o = window.__o(), d = p.clone().sub(o).normalize(); window.__inj.push({ type: 'bombThrow', hand: 'right', origin: o, dir: d, worldVelocity: d.clone().multiplyScalar(4) }); };
  window.__F = () => { const w = a.worldChase; return { ...w.fight.snapshot(), fightT: w.fight.fightT, hp: w.bossHp.hp, gap: w.bossS - w.playerS, bv: w._bv, ps: w.playerSpeed, fs: { ...w.fightStats }, hit: w.lastHit, pick: w.lastPick }; };
});
const enter = async (id) => {
  await ev((id) => { const a = window.__mobius; a.worldChase.bench = null; a.pendingMap = id; a.enterDesktop(); }, id);
  await p.waitForFunction((id) => { const a = window.__mobius; return a.state === 'world' && a.worldChase.state && a.worldChase.mapId === id && !a.loader.visible; }, id, { timeout: 900000, polling: 500 });
  await ev(() => { window.__mobius.worldChase.stateTime = 99; });
  await until(() => window.__mobius.worldChase.state === 'chase');
};
const home = async () => {
  await ev(() => { const w = window.__mobius.worldChase; w.bench = null; w.debug.setBossHp(0.001); w._bossHit(5, w.bossPos.clone(), null, 'test'); });
  await until(() => window.__mobius.menus.current === 'worldResults', null, Math.max(WAIT, 120000));
  await ev(() => window.__mobius.menus.panels.worldResults.buttons.find((x) => x.id === 'home').onClick());
  await until(() => window.__mobius.state === 'title', null, Math.max(WAIT, 120000));
};
const F = () => ev(() => window.__F());
/** v0.46: Green Maniac back at his chase lead (beyond close range, ≥ the 14 m attack range) before a forced throw — after a
 *  stagger the player can now reach him (no brake floor while staggered), and close range then holds the gap at ~2–15 m */
const lead = async () => { await ev(() => { const w = window.__mobius.worldChase; w.bossS = w.playerS + 26; w._bv = w.bench ? w.bench.speed : w._bv; }); await until(() => window.__mobius.worldChase.closeRange.state === 'far', null, Math.max(WAIT, 120000)); };
/** keep the fight quiet (no new decisions) until a test forces an attack */
const quiet = () => ev(() => { const w = window.__mobius.worldChase; w.fight.nextAttackIn = 1e9; }); // (v0.46 revision 4: no tether cooldown any more. With the shield up a web at him is always a strike; a web at a STAGGERED boss attaches to the jet / starts the fly-in by rule — the stagger checks below choose that on purpose)

// ===================================================================== FULL rules on one map
if (FULL) {
  console.log(`---- full fight rules: ${FULL}`);
  await enter(FULL);
  await ev(() => { const w = window.__mobius.worldChase; w.startBench(900, 16); w.clock = Math.max(w.clock, 7); w._bv = 16; w.playerSpeed = 16; /* bench = instant speed: start him at it too */ }); await quiet(); await frames(40);
  let f = await F();
  check(`fresh fight: protected, HP ${f.hp}, shield ${f.stability}, phase ${f.phase}`, f.state === 'protected' && f.hp === 100 && f.stability === 60 && f.phase === 1);
  // ---- protected: a web on the body hits the shield (tiny HP), clear feedback
  await ev(() => window.__webTo(window.__mobius.worldChase.bossPos)); await frames(3);
  f = await F();
  check(`protected web → shield ${f.stability} (−4), HP ${f.hp.toFixed(2)} (−0.1), feedback "${f.hit?.kind}"`, Math.abs(f.stability - 56) < 1e-6 && Math.abs(f.hp - 99.9) < 1e-6 && f.hit?.kind === 'shield', JSON.stringify(f.hit));
  // two webs in the same frame (v0.46: at ≈ 1 fps in software GL one awaited frame can be 0.6 s of game time — the old
  // "web, then one frame later another" could fall outside the 0.6 s limit): the second is inside the rate limit
  const f1 = await ev(() => { const w = window.__mobius.worldChase; w.fight.lastWebT = -99; window.__webTo(w.bossPos); window.__webTo(w.bossPos); return window.__F(); }); await frames(2);
  const f2 = await F();
  check(`a second web inside the rate limit does nothing (two webs in one frame: shield ${f1.stability}→${f2.stability} (−4 once), HP ${f1.hp.toFixed(2)}→${f2.hp.toFixed(2)}, last ${f2.hit?.kind})`, Math.abs(f1.stability - f2.stability - 4) < 1e-6 && Math.abs(f1.hp - f2.hp - 0.1) < 1e-6 && f2.hit?.kind === 'blocked', JSON.stringify({ hit: f2.hit, pick: f2.pick }));
  await shot('fight-protected-hit');
  // ---- single: the held pumpkin is decorative (no lock / no hit) until the release, then the assist takes it
  await ev(() => window.__mobius.worldChase.debug.attack('single')); await until(() => window.__mobius.worldChase.held.length > 0, null, WAIT);
  const held = await ev(() => { const w = window.__mobius.worldChase, it = w.held[0]; window.__webTo(it.pos); return { phase: it.phase, icon: w.fightFx.iconKind }; });
  await frames(3);
  f = await F();
  check(`single telegraph: icon "${held.icon}", held pumpkin (${held.phase}) is not a target before the release`, held.phase === 'held' && held.icon === 'single' && f.fs && f.pick?.pumpkin === null);
  await until(() => window.__mobius.worldChase.bombs.items.some((x) => x.active && x.phase === 'fly'));
  await frames(2);
  const d0 = await ev(() => window.__mobius.worldChase.bombs.stats.destroyed);
  await ev(() => { const w = window.__mobius.worldChase, it = w.bombs.items.find((x) => x.active && x.phase === 'fly'); window.__webTo(it.pos, 6); }); await frames(2);
  const d1 = await ev(() => window.__mobius.worldChase.bombs.stats.destroyed);
  check('after the release the pumpkin is assisted (6° off) and destroyed', d1 === d0 + 1);
  await quiet(); await frames(30);
  // ---- heavy: windup → core shut before ventAt (no core target) → vent → core hit = COUNTER → stagger, boss slows
  await until(() => window.__mobius.worldChase.fight.state === 'protected');
  await lead(); await ev(() => window.__mobius.worldChase.debug.attack('heavy')); await until(() => window.__mobius.worldChase.held.length > 0, null, WAIT);
  const pre = await ev(() => { const w = window.__mobius.worldChase; window.__webTo(w.corePos); return { t: w.fight.t, core: w.fight.coreEligible, icon: w.fightFx.iconKind, held: w.held[0]?.kind }; });
  await frames(1); f = await F();
  check(`heavy windup (t ${pre.t.toFixed(2)} s) (icon "${pre.icon}", held ${pre.held}): core shut → aimed web is not a core hit (${f.pick?.took})`, !pre.core && pre.icon === 'heavy' && pre.held === 'giant' && f.pick?.core === null && f.state === 'telegraph');
  await until(() => window.__mobius.worldChase.fight.coreEligible);
  const bv0 = await ev(() => window.__mobius.worldChase._bv);
  await until(() => window.__mobius.worldChase.fight.state === 'vent');
  await frames(3);
  await ev(() => window.__webTo(window.__mobius.worldChase.corePos, 3)); await frames(3);
  f = await F();
  check(`core hit during the vent → COUNTER → staggered (HP ${f.hp.toFixed(1)}, window ${f.window})`, f.state === 'staggered' && f.hit?.kind === 'counter' && f.stats.counters === 1, JSON.stringify(f.hit));
  // staggered: webs + Light Bomb do real damage; boss slows
  const hpS = f.hp, gs0 = await ev(() => window.__mobius.worldChase.bossS - window.__mobius.worldChase.playerS);
  // (v0.46 revision 4: inside close range — ≤ 15 m, and the staggered lead of 14 m is inside it — a web at a staggered boss,
  // core included, is the fly-in hit. The v0.42 core shot is checked with close combat off, where the core web stays a strike;
  // the close-range rule is checked right after, on purpose.)
  const S = (on) => ev(async (on) => { (await import('/src/core/settings.js')).settings.closeCombat = on; }, on);
  await S(false); await frames(4); await ev(() => window.__webTo(window.__mobius.worldChase.corePos)); await frames(2);
  const fA = await F();
  await ev(() => window.__lb(window.__mobius.worldChase.corePos)); await until(() => window.__mobius.worldChase.lightBombs.active.length === 0, null, WAIT); await frames(2);
  const fB = await F();
  check(`staggered (close combat off): web on the core ${hpS.toFixed(1)}→${fA.hp.toFixed(1)} (−5, ${fA.pick?.took}), Light Bomb →${fB.hp.toFixed(1)} (−16 core), feedback ${fA.hit?.kind}/${fB.hit?.kind}`, Math.abs(hpS - fA.hp - 5) < 1e-6 && Math.abs(fA.hp - fB.hp - 16) < 1e-6 && fB.hit?.zone === 'core' && fA.pick?.took === 'core', JSON.stringify({ pick: fA.pick, hit: fA.hit }));
  await S(true);
  await until(() => { const w = window.__mobius.worldChase; return w.closeRange.state === 'close' || w.fight.state !== 'staggered'; }, null, Math.max(WAIT, 120000));
  const lz0 = await ev(() => { const w = window.__mobius.worldChase; w.fight.lastWebT = -99; window.__webTo(w.corePos); return { lunges: w.fightStats.lunges, cr: w.closeRange.state, gap: +(w.bossS - w.playerS).toFixed(1), fight: w.fight.state }; }); await frames(1);
  const lz1 = await ev(() => { const w = window.__mobius.worldChase, r = { lunges: w.fightStats.lunges, lunging: w._lunging, how: w.lastPick?.how, took: w.lastPick?.took }; w._endLunge('test'); return r; }); // (the dev bench flies the rig: end the fly-in here)
  check(`staggered inside close range (${lz0.cr}, ${lz0.gap} m): a web at the core → the fly-in hit (took ${lz1.took}, ${lz1.how}, lunges ${lz0.lunges} → ${lz1.lunges})`, lz0.fight === 'staggered' && lz0.cr === 'close' && lz1.how === 'lunge' && lz1.lunges === lz0.lunges + 1, JSON.stringify({ lz0, lz1 }));
  await ev(() => { const w = window.__mobius.worldChase; w._endLunge('test'); });
  await until(() => window.__mobius.worldChase.fight.t > 3.0 || window.__mobius.worldChase.fight.state !== 'staggered');
  const g1 = await ev(() => { const w = window.__mobius.worldChase; return { bv: w._bv, gap: w.bossS - w.playerS, ps: w.playerSpeed }; });
  check(`the opening lets Mobius close in (gap ${gs0.toFixed(1)} → ${g1.gap.toFixed(1)} m; jet ${g1.bv.toFixed(1)} m/s = capped at 6 unless Mobius is within 8 m, then matched so he is never flown through)`, (g1.gap < gs0 || g1.gap < 9) && (g1.bv <= 6.01 || (g1.gap < 9 && g1.bv <= g1.ps + 1.6)));
  // pause freezes the fight timers
  const tP0 = await ev(() => { const w = window.__mobius.worldChase; w._benchHold = w.bench; w.bench = null; const t = window.__F().t; window.__mobius.toggleMenu(); return t; }); /* the dev bench would keep flying the rig while paused */ await frames(20); const tP1 = (await F()).t; await ev(() => { window.__mobius.toggleMenu(); const w = window.__mobius.worldChase; w.bench = w._benchHold; }); await frames(5);
  check(`pause suspends the stagger timer (${tP0} → ${tP1} while paused)`, tP0 === tP1);
  await until(() => window.__mobius.worldChase.fight.state === 'recovering', null, Math.max(WAIT, 120000));
  f = await F(); check(`opening ends readably → recovering (shield re-forms: ${f.stability})`, f.state === 'recovering' && f.stability === 60);
  await shot('fight-recovering');
  await until(() => window.__mobius.worldChase.fight.state === 'protected'); await quiet();
  // ---- heavy pumpkin counter: destroyed right after the release, near the jet → counter
  await lead(); await ev(() => window.__mobius.worldChase.debug.attack('heavy'));
  await until(() => window.__mobius.worldChase.fight.state === 'vent'); await frames(2);
  const hk = await ev(() => { const w = window.__mobius.worldChase, it = w.bombs.items.find((x) => x.active && x.kind === 'giant' && x.phase === 'fly'); if (!it) return null; const dj = it.pos.distanceTo(window.__mobius.boss.root.position); window.__webTo(it.pos, 4); return { dj: +dj.toFixed(1), ts: +(w.clock - it.launchT).toFixed(2) }; });
  await frames(3); f = await F();
  check(`heavy pumpkin destroyed ${hk?.ts} s after the release, ${hk?.dj} m from the jet → COUNTER`, !!hk && f.state === 'staggered' && f.hit?.src === 'counter', JSON.stringify({ state: f.state, hit: f.hit, pick: f.pick, menus: await ev(() => [window.__mobius.menus.open, window.__mobius.hub.ctx.allowAttack]) }));
  await ev(() => { const w = window.__mobius.worldChase; w.fight.t = 99; }); await until(() => window.__mobius.worldChase.fight.state === 'protected', null, Math.max(WAIT, 120000)); await quiet();
  // ---- far kill: no counter (time + position); missed opening → recovering → next cycle
  await ev(() => { const w = window.__mobius.worldChase; if (w.bench) w.bench.speed = 5; w._bv = Math.min(w._bv, 6); }); // (slow the bench so the late pumpkin is still in front of Mobius)
  await lead(); await ev(() => window.__mobius.worldChase.debug.attack('heavy'));
  await until(() => window.__mobius.worldChase.fight.state === 'vent');
  await until(() => { const w = window.__mobius.worldChase, it = w.bombs.items.find((x) => x.active && x.kind === 'giant' && x.phase === 'fly'); return !it || w.clock - it.launchT > w.fight.cfg.heavy.counterTime + 0.1; }, null, WAIT);
  const far = await ev(() => { const w = window.__mobius.worldChase, it = w.bombs.items.find((x) => x.active && x.kind === 'giant' && x.phase === 'fly'); if (!it) return null; const r = { dj: +it.pos.distanceTo(window.__mobius.boss.root.position).toFixed(1), ts: +(w.clock - it.launchT).toFixed(2) }; window.__webTo(it.pos, 2); return r; });
  await frames(3); f = await F();
  check(`a late / far heavy kill (${far?.ts} s, ${far?.dj} m) only blocks it — no counter`, !!far && f.state === 'vent' && f.stats.counters === 2 && f.fs.heavyKills >= 2, JSON.stringify({ state: f.state, counters: f.stats.counters, kills: f.fs.heavyKills, pick: f.pick }));
  await until(() => window.__mobius.worldChase.fight.state === 'recovering', null, WAIT);
  await ev(() => { const w = window.__mobius.worldChase; if (w.bench) w.bench.speed = 16; });
  f = await F(); check(`missed opening → recovering (missed ${f.stats.missedHeavies}), no failure`, f.stats.missedHeavies === 1);
  await until(() => window.__mobius.worldChase.fight.state === 'protected', null, WAIT);
  // ---- swing anchors are not stolen by the core assist (core open, aim clearly at an anchor)
  await lead(); await ev(() => window.__mobius.worldChase.debug.attack('heavy')); await until(() => window.__mobius.worldChase.fight.coreEligible);
  const sw0 = await ev(() => {
    const a = window.__mobius, loco = a.locomotion, w = a.worldChase, o = window.__o(), toC = w.corePos.clone().sub(o).normalize();
    const an = loco.anchorCandidates(o).map((c) => c.anchor).filter((x) => x.valid && !loco.occluded(o, x.p, x.building)).map((x) => ({ x, ang: x.p.clone().sub(o).normalize().angleTo(toC) })).filter((q) => q.ang > 0.45).sort((p, q) => p.x.p.distanceTo(o) - q.x.p.distanceTo(o))[0];
    if (!an) return null; window.__inj.push({ type: 'web', hand: 'right', origin: o, dir: an.x.p.clone().sub(o).normalize() }); return { swings: loco.stats.swings, ang: +(an.ang * 57.3).toFixed(0) };
  });
  await frames(3);
  const sw1 = await ev(() => ({ swings: window.__mobius.locomotion.stats.swings, took: window.__mobius.worldChase.lastPick?.took }));
  check(`core open: a web aimed at an anchor ${sw0?.ang}° from the core swings (took "${sw1.took}")`, !!sw0 && sw1.swings === sw0.swings + 1 && sw1.took === 'swing');
  await ev(() => { window.__mobius.locomotion.detach(true); window.__mobius.worldChase.fight.t = 99; }); await until(() => ['recovering', 'protected'].includes(window.__mobius.worldChase.fight.state)); await until(() => window.__mobius.worldChase.fight.state === 'protected', null, WAIT); await quiet();
  // ---- phase 2: spread (three pumpkins), Fan Web clears the group (desktop V = the two-hand gesture's event)
  await ev(() => window.__mobius.worldChase.debug.phase(2)); await ev(() => { window.__mobius.worldChase.fight.nextAttackIn = 0.01; window.__mobius.worldChase.fight.recent = ['spread']; }); await frames(3);
  f = await F(); check(`phase change at a safe boundary → phase ${f.phase}`, f.phase === 2);
  await quiet(); await until(() => window.__mobius.worldChase.fight.state === 'protected');
  await ev(() => window.__mobius.worldChase.debug.attack('spread')); await until(() => window.__mobius.worldChase.held.length === 3, null, WAIT);
  await until(() => { const w = window.__mobius.worldChase, fly = w.bombs.items.filter((x) => x.active && x.phase === 'fly'); return fly.length === 3 && fly.every((it) => it.pos.distanceTo(window.__chest()) < 30); }, null, WAIT);
  const fan0 = await ev(() => { const a = window.__mobius, w = a.worldChase, fly = w.bombs.items.filter((x) => x.active && x.phase === 'fly'); const T = window.__THREE, c = new T.Vector3(); for (const it of fly) c.add(it.pos); c.divideScalar(fly.length); const o = window.__chest(); const spread = Math.max(...fly.map((it) => it.pos.distanceTo(c))); window.__inj.push({ type: 'fanWeb', t: 0, tContact: 0, open: 'left', fist: 'right', source: 'desktop', origin: o, dir: c.clone().sub(o).normalize() }); return { n: fly.length, spread: +spread.toFixed(1), d: +c.distanceTo(o).toFixed(1) }; });
  await frames(3);
  const fan1 = await ev(() => { const w = window.__mobius.worldChase; return { left: w.bombs.items.filter((x) => x.active && x.phase === 'fly').length, fanP: w.fightStats.fanPumpkins, fans: w.fightStats.fans }; });
  check(`spread of ${fan0.n} (group radius ${fan0.spread} m at ${fan0.d} m) → one Fan Web clears ${fan1.fanP}`, fan0.n === 3 && fan1.fanP >= 3 && fan1.left === 0, JSON.stringify(fan1));
  await shot('fight-fanweb');
  const ctxs = await ev(() => ({ fan: window.__mobius.hub.ctx.fanWeb, ctrl: window.__mobius.hub.ctx.fanWebControllers }));
  check(`Fan Web enabled in chase for hands / desktop, not for controllers (two triggers = two swings): ${JSON.stringify(ctxs)}`, ctxs.fan === true && ctxs.ctrl === false);
  // ---- phase change never corrupts an attack in progress
  await until(() => window.__mobius.worldChase.fight.state === 'protected'); await quiet();
  await ev(() => window.__mobius.worldChase.debug.attack('single')); await until(() => window.__mobius.worldChase.held.length > 0, null, WAIT);
  await ev(() => window.__mobius.worldChase.debug.phase(3)); await frames(1);
  f = await F(); const midPhase = f.phase, midState = f.state;
  await until(() => window.__mobius.worldChase.fight.state === 'protected', null, WAIT); await frames(2);
  f = await F();
  check(`HP crosses into phase 3 mid-telegraph: still phase ${midPhase} (${midState}) → phase ${f.phase} after the attack, the throw completed`, midPhase === 2 && midState === 'telegraph' && f.phase === 3 && f.stats.attacks.single >= 2);
  await shot('fight-phase3');
  // ---- protected spam: 30 webs at the body (rate limited) vs the counter opening above
  await quiet();
  const spam0 = await F();
  for (let i = 0; i < 30; i++) { await ev(() => { const w = window.__mobius.worldChase; w.fight.lastWebT = -99; window.__webTo(w.bossPos); }); await frames(2); }
  const spam1 = await F();
  check(`30 protected webs: HP −${(spam0.hp - spam1.hp).toFixed(1)} (shield broke ${spam1.stats.breaks - spam0.stats.breaks}×) vs one counter opening −${(100 - hpS + (hpS - fB.hp)).toFixed(1)}`, spam0.hp - spam1.hp < 15);
  await ev(() => { const w = window.__mobius.worldChase; w.fight.t = 99; }); await frames(5);
  // ---- defeat through the fight → results once
  await ev(async () => { const w = window.__mobius.worldChase; if (w.closeRange.state === 'close') (await import('/src/core/settings.js')).settings.closeCombat = false; /* (v0.46: inside close range the web would be the fly-in hit — this check wants the core web's kill) */ w.debug.setBossHp(0.03); w.fight.forceStagger('counter'); w.fight.lastWebT = -99; window.__webTo(w.corePos); }); await frames(4);
  await until(() => window.__mobius.menus.current === 'worldResults', null, Math.max(WAIT, 120000));
  f = await F(); const res = await ev(() => { const w = window.__mobius.worldChase; return { phase: w.run.phase, outcome: w.run.outcome, frozen: !!window.__mobius.locomotion.frozen, flying: w.bombs.items.filter((x) => x.active).length, icon: w.fightFx.icon.visible, shield: w.fightFx.shield.visible }; });
  check(`last hit → defeated (${f.state}) → results "${res.outcome}", frozen, nothing flying, shield / icon off`, f.state === 'defeated' && res.outcome === 'victory' && res.frozen && res.flying === 0 && !res.icon);
  const late = await ev(() => { const w = window.__mobius.worldChase; return w._fightHit('web', 'core', w.bossPos.clone(), null); });
  check('no hit is accepted after the end', late === null);
  await ev(async () => { (await import('/src/core/settings.js')).settings.closeCombat = true; });
  await ev(() => window.__mobius.menus.panels.worldResults.buttons.find((x) => x.id === 'home').onClick());
  await until(() => window.__mobius.state === 'title', null, Math.max(WAIT, 120000));
  const after = await ev(() => { const a = window.__mobius; return { shield: a.worldChase.fightFx.shield.visible, core: a.worldChase.fightFx.core.visible, boss: a.boss.root.visible }; });
  check(`Back to Home: fight visuals cleared ${JSON.stringify(after)}`, !after.shield && !after.core && !after.boss);
}

// ===================================================================== compatibility: all maps
for (const mapId of MAPS) {
  console.log(`---- ${mapId}`);
  await enter(mapId);
  await ev(() => { const w = window.__mobius.worldChase; w.startBench(900, 17); w.clock = Math.max(w.clock, 7); w._bv = 17; w.playerSpeed = 17; /* bench = instant speed: start him at it too */ });
  let fr = await F(); const fresh = fr.hp === 100 && fr.state === 'protected' && fr.stability === 60 && fr.stats.counters === 0;
  // natural attacks for ~8 s of game time
  const t0 = await ev(() => window.__mobius.worldChase.clock);
  const gaps = [], inside = [];
  while (await ev(() => window.__mobius.worldChase.clock) - t0 < 8) {
    await frames(15);
    const g = await ev(() => { const a = window.__mobius, w = a.worldChase, bp = a.boss.root.position; return { gap: w.bossS - w.playerS, blocked: w.world.pointBlocked(bp.x, bp.y, bp.z, 0.3) }; });
    gaps.push(g.gap); inside.push(g.blocked);
  }
  fr = await F();
  // a forced heavy → counter on the core → stagger → recovery
  await until(() => window.__mobius.worldChase.fight.state === 'protected', null, 900000); await quiet();
  console.log(`  ${mapId}: natural attacks sampled, forcing a heavy`, JSON.stringify(await F()).slice(0, 200));
  let vented = false; // (a forced windup can be cancelled fairly — a respawn / blind turn; then try again)
  for (let k = 0; k < 4 && !vented; k++) {
    await until(() => window.__mobius.worldChase.fight.state === 'protected', null, 900000); await quiet();
    await lead(); await ev(() => window.__mobius.worldChase.debug.attack('heavy'));
    vented = await p.waitForFunction(() => { const f = window.__mobius.worldChase.fight; return f.state === 'vent' || (f.state === 'protected' && f.stats.attacks.heavy > 0 && !f.attack) ? f.state : false; }, null, { timeout: 900000, polling: 50 }).then((h) => h.jsonValue()).then((x) => x === 'vent');
  }
  await frames(2);
  const vis = await ev(() => { const w = window.__mobius.worldChase; return { vis: w._coreVisible(window.__o()), d: +w.corePos.distanceTo(window.__o()).toFixed(1) }; });
  await ev(() => { window.__mobius.worldChase.fight.lastWebT = -99; window.__webTo(window.__mobius.worldChase.corePos, 2); }); await frames(3);
  const fc = await F();
  const ok = fc.state === 'staggered' || (!vis.vis && fc.state === 'vent');
  if (mapId === MAPS[0] || mapId === 'aurora' || mapId === 'molten' || mapId === 'neon') await shot(`fight-${mapId}-stagger`);
  check(`${mapId}: fresh fight ${fresh}; ${fr.stats.attacks.single + fr.stats.attacks.spread} natural attack(s) in 8 s; gap ${Math.min(...gaps).toFixed(0)}–${Math.max(...gaps).toFixed(0)} m; boss in scenery ${inside.filter(Boolean).length}/${inside.length}; core ${vis.d} m visible ${vis.vis} → ${fc.state}`, fresh && ok && Math.max(...gaps) < 60 && Math.min(...gaps) > 0 && !inside.some(Boolean));
  await home();
}
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed`);
if (logs.length) console.log(logs.slice(0, 30).join('\n'));
await b.close();
process.exit(fails ? 1 : 0);
