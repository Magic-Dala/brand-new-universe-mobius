// v0.46 close combat end-to-end (headless Chromium + SwiftShader; needs `npm run dev`). World Chase on one map (MAP, default
// foldscape). ONLY=<comma list> runs a subset (entering a world takes minutes in software GL):
//   react = react.web, react.punch, react.tele, react.stagger, react.off, react.old   Green Maniac hit reactions (one world load)
//   range = range.zone, range.floor, range.pass, range.tele, range.boost, range.stagger, range.pause, range.off, range.restart, range.fin
//           close range (taunt, gap floor, camping boost, lockout; the red ring only while staggered); split them over runs
//           (each run loads the world; range.restart reloads it once more; range.fin ends the run)
//   punch = punch.shield, punch.blue, punch.red, punch.end, punch.contact, punch.throw, punch.burst, punch.fin   (revision 4:
//           the shield gates the web, the fly-in hit, contact push-back, impact bursts; fix round 1: punch.held (attach → pull in
//           → fly-in with the jet web still held), punch.respawn, punch.cancel (stagger ends mid-flight), punch.flash; punch.fin
//           ends the run → run it last)
// Durations are measured in summed game time (the dt Green Maniac's own update receives), not wall time: software GL runs at
// about 1 frame per second with the frame time capped at 0.1 s.
import { chromium } from 'playwright';
const OUT = process.env.OUT || '.';
const MAP = process.env.MAP || 'foldscape';
const ALL = ['react.web', 'react.punch', 'react.tele', 'react.stagger', 'react.off', 'react.old', 'range.zone', 'range.floor', 'range.pass', 'range.tele', 'range.boost', 'range.stagger', 'range.pause', 'range.off', 'range.restart', 'range.fin',
  'punch.shield', 'punch.blue', 'punch.red', 'punch.end', 'punch.contact', 'punch.throw', 'punch.burst', 'punch.held', 'punch.respawn', 'punch.cancel', 'punch.flash', 'punch.fin'];
const SHOTS = process.env.SHOTS || '/mnt/user-data/outputs'; // (punch.blue / punch.red screenshots)
const ONLY = (process.env.ONLY || ALL.join(',')).split(',').filter(Boolean).flatMap((k) => (k === 'react' || k === 'range' || k === 'punch' ? ALL.filter((x) => x.startsWith(`${k}.`)) : [k]));
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

await p.goto(process.env.URL || 'https://localhost:8443/', { waitUntil: 'load' });
await p.waitForFunction(() => window.__mobius && !document.getElementById('enter').disabled, null, { timeout: 200000 });
await ev(async () => {
  const a = window.__mobius, hub = a.hub, orig = hub.update.bind(hub);
  window.__frames = 0; window.__inj = []; window.__held = null;
  hub.update = (f, t) => { orig(f, t); window.__frames++; if (window.__held) Object.assign(hub.webHeld, window.__held); for (const e of window.__inj.splice(0)) hub.events.push(e); }; // (+ injected web events / held webs: the punch checks)
  a.audioOff = true;
  window.__S = (await import('/src/core/settings.js')).settings;
});
const enter = async (id) => {
  await ev((id) => { const a = window.__mobius; a.worldChase.bench = null; a.pendingMap = id; a.enterDesktop(); }, id);
  await p.waitForFunction((id) => { const a = window.__mobius; return a.state === 'world' && a.worldChase.state && a.worldChase.mapId === id && !a.loader.visible; }, id, { timeout: 900000, polling: 500 });
  await ev(() => { window.__mobius.worldChase.stateTime = 99; });
  await until(() => window.__mobius.worldChase.state === 'chase');
  await ev(() => { const w = window.__mobius.worldChase; w.fight.nextAttackIn = 1e9; }); // quiet fight (v0.46: the tether has no cooldown — the punch checks web a staggered boss on purpose)
};
/** Green Maniac's own game clock: the dt his update() receives, summed (window.__mt), and his state per update (window.__ms). */
const hookManiac = () => ev(() => {
  const m = window.__mobius.boss.maniac; if (m.__hooked) return; m.__hooked = true;
  const u = m.update; window.__mt = 0; window.__ms = [];
  m.update = (dt, t) => { u(dt, t); window.__mt += dt; if (window.__ms.length < 4000) window.__ms.push([+window.__mt.toFixed(3), m.state]); };
});
/** fight back to a fresh protected shield (no attacks), gate cleared; then wait until he rides again (no one-shot running). */
const calm = async () => {
  await ev(() => { const w = window.__mobius.worldChase; w.debug.reset(); w.fight.nextAttackIn = 1e9; w.reactGate.reset(); w._hurtUntil = 0; w.app.boss.maniac.setState('ride'); window.__ms.length = 0; });
  await until(() => window.__mobius.boss.maniac.state === 'ride', null, 600000);
};
const st = () => ev(() => window.__mobius.boss.maniac.state);
/** clip names of the running hit actions, heaviest first */
const hitClips = () => ev(() => window.__mobius.boss.maniac.mixer._actions.filter((x) => x.isRunning() && /Hit/.test(x.getClip().name)).sort((x, y) => y.getEffectiveWeight() - x.getEffectiveWeight()).map((x) => x.getClip().name));
/** game time from t0 ({ t: window.__mt, i: window.__ms.length } at the hit) until the state is no longer `s`; returns { dt, to } */
const whileState = async (s, t0, ms = 600000) => {
  await until((s) => window.__mobius.boss.maniac.state !== s, s, ms);
  return ev(([s, t0]) => { const e = window.__ms.find(([t, x], i) => i >= t0.i && x !== s); t0 = t0.t; return { dt: e ? +(e[0] - t0).toFixed(3) : null, to: window.__mobius.boss.maniac.state, fight: window.__mobius.worldChase.fight.state }; }, [s, t0]); // (from the per-update log: the poll itself lags a frame or two)
};

console.log(`---- enter ${MAP} (checks: ${ONLY.join(', ')})`); await enter(MAP); await frames(3); await hookManiac(); console.log(`---- in the chase after ${el()}`);
const clipLen = await ev(() => Object.fromEntries(window.__mobius.boss.maniac.mixer._actions.map((x) => [x.getClip().name, +x.getClip().duration.toFixed(3)])));

if (want('react.web')) { // a web on his shield: 'hit' within 3 frames, back to riding after the clip by itself
  await calm();
  const r = await ev(() => { const w = window.__mobius.worldChase, f = window.__frames; const r = w._fightHit('web', 'body', w.bossPos.clone(), null); return { kind: r?.kind, f, s: w.app.boss.maniac.state, t0: { t: window.__mt, i: window.__ms.length } }; });
  let n = 0, s = await st(); while (s !== 'hit' && n < 3) { await frames(1); n++; s = await st(); }
  const clips = await hitClips();
  const back = await whileState('hit', r.t0);
  const len = clips[0] ? clipLen[clips[0]] : 0;
  check(`react (web on the shield → ${r.kind}): state ${s} after ${n} frame(s) (clip ${clips[0]} ${len} s), back to '${back.to}' after ${back.dt} s of game time`,
    r.kind === 'shield' && s === 'hit' && n <= 3 && /^(head|body)Hit2?$/.test(clips[0] || '') && back.to === 'ride' && back.dt >= len - 0.35 && back.dt <= len + 0.2, JSON.stringify({ r, clips, back }));
}
if (want('react.punch')) { // a punch-sourced reaction is always the head hit (Math.random forced high: a coin flip would pick body)
  await calm();
  const r = await ev(() => { const w = window.__mobius.worldChase, R = Math.random; Math.random = () => 0.99; try { return { ok: w._react('punch'), s: w.app.boss.maniac.state, t0: { t: window.__mt, i: window.__ms.length } }; } finally { Math.random = R; } });
  const clips = await hitClips();
  const back = await whileState('hit', r.t0);
  check(`react (punch): reaction ${r.ok}, state ${r.s}, clip ${clips[0]}; back to '${back.to}' after ${back.dt} s`, r.ok && r.s === 'hit' && /^headHit2?$/.test(clips[0] || '') && back.to === 'ride' && back.dt > 0.5, JSON.stringify({ r, clips, back }));
}
if (want('react.tele')) { // during a forced heavy telegraph a web hit does not change his state (the windup stays readable)
  await calm();
  // (the hit lands in the same task as the forced attack: with the player standing still the chase may abort the telegraph
  // on the next fight update)
  const r = await ev(() => { const w = window.__mobius.worldChase, m = w.app.boss.maniac; w.debug.attack('heavy'); w.reactGate.reset(); const s0 = m.state, f = w.fight.state; const r = w._fightHit('web', 'body', w.bossPos.clone(), null); return { s0, s1: m.state, fight: f, kind: r?.kind }; });
  await frames(2);
  const s2 = await st();
  check(`react (heavy telegraph): fight ${r.fight}, web → ${r.kind}; maniac ${r.s0} → ${r.s1} (2 frames later ${s2})`, r.fight === 'telegraph' && r.kind !== 'blocked' && r.kind !== 'none' && r.s1 === r.s0 && s2 !== 'hit', JSON.stringify(r));
}
if (want('react.stagger')) { // during a stagger he shows 'hurt'; a reaction plays over it and returns to it
  await calm();
  await ev(() => window.__mobius.worldChase.debug.stagger());
  await until(() => window.__mobius.boss.maniac.state === 'hurt', null, 120000);
  const r = await ev(() => { const w = window.__mobius.worldChase; w.reactGate.reset(); const r = w._fightHit('web', 'body', w.bossPos.clone(), null); return { kind: r?.kind, s: w.app.boss.maniac.state, fight: w.fight.state, t0: { t: window.__mt, i: window.__ms.length } }; });
  const back = await whileState('hit', r.t0);
  check(`react (stagger): ${r.fight} web → ${r.kind}, state ${r.s} → '${back.to}' after ${back.dt} s (fight ${back.fight})`, r.fight === 'staggered' && r.s === 'hit' && back.dt > 0.5 && back.to === 'hurt' && back.fight === 'staggered', JSON.stringify({ r, back }));
}
if (want('react.off')) { // switch off: a damaging hit gives the v0.45 hurt flinch (and its timer)
  await calm();
  await ev(() => window.__mobius.worldChase.debug.stagger());
  await until(() => window.__mobius.boss.maniac.state === 'hurt', null, 120000);
  const r = await ev(() => { const w = window.__mobius.worldChase, m = w.app.boss.maniac; window.__S.closeCombat = false; m.setState('ride'); const s0 = m.state; const r = w._fightHit('lightBomb', 'body', w.bossPos.clone(), `e2e-off-${window.__frames}`); return { s0, kind: r?.kind, hp: r?.hp, s: m.state, timer: w._hurtUntil > w.clock }; });
  await frames(2);
  const s2 = await st();
  await ev(() => { window.__S.closeCombat = true; });
  check(`react (closeCombat off): ${r.s0} + lightBomb ${r.kind} (${r.hp} hp) → ${r.s} (hurt timer ${r.timer}); 2 frames later ${s2}`, r.s0 === 'ride' && r.hp >= 2 && r.s === 'hurt' && r.timer && s2 === 'hurt', JSON.stringify(r));
}
if (want('react.old')) { // an older GLB (no taunt / headHit / bodyHit): taunt and hit do not throw (taunt = faceBack, hit = hurt shake)
  const r = await ev(async () => {
    const { loadGreenManiacAnimated, createGreenManiacAnimated } = await import('/src/art/greenManiacAnimated.js');
    const model = await loadGreenManiacAnimated();
    const had = ['taunt', 'headHit', 'bodyHit'].filter((k) => model.clips[k]);
    for (const k of Object.keys(model.clips)) if (/^(taunt|headHit|bodyHit)/.test(k)) delete model.clips[k]; // + the copies derived at load
    const out = { had, states: [] };
    try {
      const m = createGreenManiacAnimated(model); let t = 0; const step = (n) => { for (let i = 0; i < n; i++) { t += 0.1; m.update(0.1, t); } };
      m.setState('ride'); step(3); out.states.push(m.state);
      m.setState('taunt'); step(15); out.states.push(m.state);
      m.setState('hit', 'body'); step(2); out.states.push(m.state);
      m.setState('faceFront'); step(15); out.states.push(m.state);
      m.setState('hit'); step(2); out.states.push(m.state);
      out.ok = true;
    } catch (e) { out.ok = false; out.err = String(e?.stack || e); }
    return out;
  });
  check(`react (older GLB without ${r.had.join(' / ')}): ride → taunt → hit → faceFront → hit without throwing: ${r.states.join(' → ')}`, r.ok && r.had.length === 3 && (r.states[1] === 'stretchBack' || r.states[1] === 'faceBack') && r.states[2] === 'hurt' && r.states[3] === 'ride' && r.states[4] === 'hurt', JSON.stringify(r));
}

// ---------------------------------------------------------------- v0.46 close range
/** per running chase frame: [clock, gap, closeRange state, ring visible, maniac state] (window.__cl), installed once */
const hookRange = () => ev(() => {
  const w = window.__mobius.worldChase; if (w.__rh) return; w.__rh = true; window.__cl = [];
  const u = w.update.bind(w);
  w.update = (dt, t, r) => { u(dt, t, r); if (w.state && w.closeRange && window.__cl.length < 6000) window.__cl.push([+w.clock.toFixed(3), +(w.bossS - w.playerS).toFixed(2), w.closeRange.state, w.closeRing.visible, w.app.boss.maniac.state]); };
});
const clock = () => ev(() => window.__mobius.worldChase.clock);
/** wait for `sec` of chase game time (the chase's own clock: frozen while paused) */
const gameWait = async (sec) => { const t0 = await clock(); await until(([t0, sec]) => window.__mobius.worldChase.clock >= t0 + sec || !window.__mobius.worldChase.run.running, [t0, sec], 600000); };
/** frame log since game time t0 */
const logSince = (t0) => ev((t0) => window.__cl.filter((x) => x[0] > t0 + 2e-3), t0); // (the log's clock is rounded to 1 ms)
/** put the (frozen) player on the route `gap` m behind him, facing along the route; `lift` m above the route line */
const put = (gap, lift = -1.4) => ev(([gap, lift]) => {
  const a = window.__mobius, w = a.worldChase, l = a.locomotion, s = w.bossS - gap, p = w.world.pointAt(s), h = w.world.headingAt(s);
  l.freeze(); p.y += lift; l.placeAt(p, -h); l.vel.set(0, 0, 0);
  w.playerS = s; w.maxS = Math.max(w.maxS, s); w._prevPS = null; w.playerSpeed = 0; w.playerSpeedNow = 0; w._bv = 0;
}, [gap, lift]);
const R = () => ev(() => { const w = window.__mobius.worldChase; return { cr: w.closeRange.state, ring: w.closeRing.visible, m: w.app.boss.maniac.state, gap: +(w.bossS - w.playerS).toFixed(2), minGap: w.closeRange.minGap, fight: w.fight.state, clock: +w.clock.toFixed(2), t: +w.closeRange._t.toFixed(3), state: w.state }; });
const untilR = (fn, ms = 600000) => until(fn, null, ms);
const rangeCalm = async () => { // fight quiet, he rides, the player far behind (close range closed)
  await ev(() => { const w = window.__mobius.worldChase; w.debug.reset(); w.fight.nextAttackIn = 1e9; w.reactGate.reset(); w._hurtUntil = 0; window.__S.closeCombat = true; if (w.app.boss.maniac.state === 'hurt' || w.app.boss.maniac.state === 'stand') w.app.boss.maniac.setState('ride'); });
  await ev(() => { const a = window.__mobius, w = a.worldChase; w.bench = null; a.locomotion.freeze(); a.locomotion.vel.set(0, 0, 0); w.bossS = w.playerS + 30; w._bv = 0; });
  await untilR(() => { const w = window.__mobius.worldChase; return w.closeRange.state === 'far' && w.app.boss.maniac.state === 'ride'; });
};
/** desktop head yaw / pitch toward his body point */
const lookAtBoss = () => ev(() => { const a = window.__mobius, hub = a.hub, rig = a.locomotion.rig, cam = a.camera, d = a.worldChase.bossPos.clone().sub(cam.getWorldPosition(cam.position.clone().set(0, 0, 0))); const q = rig.quaternion.clone().invert(); d.applyQuaternion(q); hub.desk.yaw = Math.atan2(-d.x, -d.z); hub.desk.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z)); });
const toTaunt = async (gap) => { await put(gap); await untilR(() => window.__mobius.boss.maniac.state === 'taunt'); return R(); };
if (ONLY.some((k) => k.startsWith('range.') || k.startsWith('punch.'))) await hookRange();

if (want('range.zone')) { // 14 m: taunt (shield up: no ring); 2.5 m: the floor holds 2 s; 18 m: off. Staggered at 7 m: the red ring (screenshot).
  await rangeCalm();
  const t0 = await clock(); const a = await toTaunt(14); const dtT = (await clock()) - t0;
  check(`range (14 m): close range ${a.cr}, maniac ${a.m} after ${dtT.toFixed(2)} s of game time, ring ${a.ring} (shield up: none), floor ${a.minGap} m`, a.cr === 'close' && a.m === 'taunt' && !a.ring && a.minGap === 2.2 && dtT < 2.5, JSON.stringify(a));
  await put(2.5); const g0 = await clock(); await gameWait(2);
  const log = await logSince(g0), mn = Math.min(...log.map((x) => x[1])), mx = Math.max(...log.map((x) => x[1]));
  check(`range (2.5 m): the gap stays ${mn.toFixed(2)} … ${mx.toFixed(2)} m over ${(log.at(-1)[0] - g0).toFixed(2)} s of game time (≥ 2 m), close the whole time, no ring`, mn >= 2 && mx < 15 && log.every((x) => x[2] === 'close' && !x[3]), JSON.stringify(log.slice(0, 5)));
  await put(18); await untilR(() => window.__mobius.worldChase.closeRange.state === 'far');
  const b = await R(); await untilR(() => window.__mobius.boss.maniac.state === 'ride'); const c = await R();
  check(`range (18 m): close range ${b.cr}, ring ${b.ring}; maniac turns forward (${b.m}) → ${c.m}`, b.cr === 'far' && !b.ring && c.m === 'ride' && !c.ring, JSON.stringify({ b, c }));
  // screenshot: staggered, lift the player to his height and look at him
  await put(7, 3.5); await ev(() => window.__mobius.worldChase.debug.stagger()); await frames(2); await lookAtBoss(); await frames(3);
  const shot = await R();
  await p.screenshot({ path: `${OUT}/close-ring.png` });
  check(`range (staggered, screenshot at 7 m): red ring ${shot.ring}, close range ${shot.cr} → ${OUT}/close-ring.png`, shot.ring && shot.cr === 'close' && shot.fight === 'staggered', JSON.stringify(shot));
}
if (want('range.floor')) { // the player closing at speed (bench 16 m/s, his reference speed lagging): he never lets the gap fall below 2 m
  await rangeCalm();
  await ev(() => { const a = window.__mobius, w = a.worldChase; a.locomotion.unfreeze(); w.startBench(900, 16); });
  await frames(2);
  await ev(() => { const w = window.__mobius.worldChase; w.bossS = w.playerS + 6; w._bv = 9; w.playerSpeed = 9; w._prevPS = null; });
  const g0 = await clock(); await gameWait(2.5);
  const log = await logSince(g0); await ev(() => { window.__mobius.worldChase.bench = null; });
  const mn = Math.min(...log.map((x) => x[1]));
  check(`range (closing at 16 m/s from 6 m, his speed 9): min gap ${mn.toFixed(2)} m over ${(log.at(-1)[0] - g0).toFixed(2)} s, close range ${log.at(-1)[2]}`, mn >= 2 && log.at(-1)[2] === 'close', JSON.stringify(log.map((x) => x[1])));
}
if (want('range.pass')) { // a staggered boss approached fast (bench 20 m/s from 12 m): never passed — gap ≥ 1.5 m over 3 s of game time
  await rangeCalm();
  await ev(() => { const a = window.__mobius, w = a.worldChase; a.locomotion.unfreeze(); w.startBench(900, 20); });
  await frames(2);
  await ev(() => { const w = window.__mobius.worldChase; w.debug.stagger(); w.bossS = w.playerS + 12; w._bv = 6; w.playerSpeed = 20; w._prevPS = null; w.closeRange.clamps = 0; });
  const g0 = await clock(); await gameWait(3);
  const log = await logSince(g0), info = await ev(() => { const w = window.__mobius.worldChase; w.bench = null; return { fight: w.fight.state, clamps: w.closeRange.clamps }; });
  const mn = Math.min(...log.map((x) => x[1]));
  check(`range (staggered boss, player at 20 m/s from 12 m): min gap ${mn.toFixed(2)} m over ${(log.at(-1)[0] - g0).toFixed(2)} s (fight ${info.fight}, last-resort clamps ${info.clamps}), close range ${log.at(-1)[2]}`, mn >= 1.5 && log.at(-1)[2] === 'close' && log.some((x) => x[1] < 10), JSON.stringify(log.map((x) => x[1])));
}
if (want('range.tele')) { // a single throw started while taunting: close range ends during the windup → he keeps facing the player until the release
  await rangeCalm(); await toTaunt(8); await gameWait(1.5);
  await gameWait(Math.max(0, 6.5 - await clock())); // (the fight aborts a windup during the first 6 s of the chase — _fairness 'base': this check may run first)
  const a = await ev(() => { const w = window.__mobius.worldChase; w.fight.fightT = Math.max(w.fight.fightT, 8); w.debug.attack('single'); return { fight: w.fight.state, back: w.app.boss.maniac.facingBack }; });
  await put(18);
  const t0 = await clock();
  await untilR(() => window.__mobius.worldChase.fight.state !== 'telegraph');
  const log = await logSince(t0), rel = await R();
  const during = log.filter((x) => x[4] === 'faceFront').length ? 'turned' : 'kept';
  const clips = await ev(() => window.__mobius.boss.maniac.mixer._actions.filter((x) => x.isRunning() && /^throw/.test(x.getClip().name)).map((x) => x.getClip().name));
  await untilR(() => window.__mobius.boss.maniac.state === 'ride');
  check(`range (single telegraph from a taunt, close range ends): ${JSON.stringify(a)}; during the windup he ${during} facing the player (states ${[...new Set(log.map((x) => x[4]))].join(', ')}), throw clip ${clips.join('/')}; after release fight ${rel.fight}, then he turns forward → ride`, a.fight === 'telegraph' && a.back && during === 'kept' && clips.includes('throwBack') && log.some((x) => x[2] === 'far'), JSON.stringify({ a, log: log.slice(0, 12), clips }));
}
if (want('range.boost')) { // camping 5 s → boost (no ring) → 19 m → lockout: no approach (9 m: no ring / taunt; 5 m: the 8 m floor) → far after 6 s
  await rangeCalm();
  await toTaunt(8); const tc = await ev(() => window.__cl.findLast((x) => x[2] !== 'close')?.[0] ?? 0);
  await untilR(() => window.__mobius.worldChase.closeRange.state !== 'close');
  const a = await R(), tb = await ev(() => window.__cl.find((x, i, L) => i > 0 && x[2] === 'boost' && L[i - 1][2] === 'close')?.[0]);
  check(`range (camping at 8 m): ${a.cr} after ${(tb - tc).toFixed(2)} s of game time, ring ${a.ring}, floor ${a.minGap} m (the boost keeps the early floor)`, a.cr === 'boost' && !a.ring && a.minGap === 2.2 && tb - tc >= 4.9 && tb - tc <= 5.4, JSON.stringify({ a, tc, tb }));
  await untilR(() => window.__mobius.worldChase.closeRange.state !== 'boost');
  const b = await R(), tl = b.clock;
  const blog = await logSince(tb);
  check(`range (boost): gap → ${b.gap} m, then ${b.cr} (game time ${(tl - tb).toFixed(2)} s); maniac turned forward (${b.m})`, b.cr === 'lockout' && b.gap >= 19 && blog.every((x) => !x[3]), JSON.stringify(b));
  const g0 = await clock(); await put(9); await gameWait(1);
  const c = await R(), clog = await logSince(g0);
  check(`range (lockout, 9 m): close range ${c.cr}, ring never, maniac never taunts (${[...new Set(clog.map((x) => x[4]))].join(', ')}), floor ${c.minGap}`, c.cr === 'lockout' && clog.every((x) => !x[3] && x[2] === 'lockout' && x[4] !== 'taunt') && c.minGap === null, JSON.stringify(c));
  const g1 = await clock(); await put(5); await gameWait(2);
  const d = await R(), dlog = await logSince(g1);
  check(`range (lockout, 5 m): the v0.45 floor pushes the gap back to ${d.gap} m (≥ 8) within 2 s; no taunt`, d.gap >= 8 && dlog.every((x) => x[4] !== 'taunt' && !x[3]), JSON.stringify(d));
  await untilR(() => window.__mobius.worldChase.closeRange.state !== 'lockout');
  const e = await R(), te = await ev(() => window.__cl.find((x, i, L) => i > 0 && x[2] === 'far' && L[i - 1][2] === 'lockout')?.[0]);
  check(`range (lockout end): ${e.cr} after ${(te - tl).toFixed(2)} s of game time, floor ${e.minGap} (far: the v0.45 rule)`, e.cr === 'far' && e.minGap === null && te - tl >= 5.9 && te - tl <= 6.4, JSON.stringify({ e, tl, te }));
}
if (want('range.stagger')) { // stagger while close: the ring stays, no boost in 5 s; v0.49: with the red ring on he faces the player (Taunt) through the stagger (was the v0.45 stagger pose, his back to them); at its end he still taunts
  await rangeCalm(); await toTaunt(8); await gameWait(1.5); // (the turn into the taunt done)
  const g0 = await ev(() => { const w = window.__mobius.worldChase; w.debug.stagger(); return w.clock; });
  await gameWait(5);
  const a = await R(), log = await logSince(g0);
  check(`range (stagger at 8 m): 5 s of game time → close range ${a.cr} (never boost), ring ${a.ring}, maniac ${a.m}, fight ${a.fight}`, a.fight === 'staggered' && log.every((x) => x[2] === 'close' && x[3]) && a.m === 'taunt', /* (v0.49: the red ring is on → he has turned to face the player and stays turned until the stagger ends) */ JSON.stringify({ a, states: [...new Set(log.map((x) => x[4]))] }));
  await untilR(() => window.__mobius.worldChase.fight.state !== 'staggered');
  const t1 = await clock(); await untilR(() => window.__mobius.boss.maniac.state === 'taunt'); const t2 = await clock();
  const b = await R();
  check(`range (stagger ends at 8 m): fight ${b.fight}, maniac back to ${b.m} after ${(t2 - t1).toFixed(2)} s, close range ${b.cr}, camping count ${b.t} s`, b.m === 'taunt' && b.cr === 'close' && t2 - t1 < 1.5 && b.t < 2, JSON.stringify(b));
}
if (want('range.pause')) { // paused in close range: the camping count and the chase stand still; staggered: the red ring hides while paused
  await rangeCalm(); await toTaunt(8); await gameWait(1);
  const a = await ev(() => { const w = window.__mobius.worldChase; w.pause(); return { t: +w.closeRange._t.toFixed(3), ring: w.closeRing.visible }; }); await frames(6);
  const b = await R(); await ev(() => window.__mobius.worldChase.resume()); await frames(1);
  const c = await R();
  check(`range (pause): camping count ${a.t} → ${b.t} s over 6 paused frames (no ring with the shield up: ${a.ring}), close range ${b.cr}`, !a.ring && b.t === a.t && !b.ring && b.cr === 'close' && !c.ring && c.t > b.t, JSON.stringify({ a, b, c }));
  await ev(() => window.__mobius.worldChase.debug.stagger()); await frames(2);
  const d = await R(); await ev(() => window.__mobius.worldChase.pause()); await frames(3);
  const e = await R(); await ev(() => window.__mobius.worldChase.resume()); await frames(2);
  const f = await R();
  check(`range (pause, staggered): red ring ${d.ring} → paused ${e.ring} → resumed ${f.ring}`, d.ring && !e.ring && f.ring && f.fight === 'staggered', JSON.stringify({ d, e, f }));
}
if (want('range.off')) { // switch off while close: far, he turns forward, no ring, the 8 m floor
  await rangeCalm(); await toTaunt(8);
  const g0 = await ev(() => { window.__S.closeCombat = false; return window.__mobius.worldChase.clock; });
  await untilR(() => window.__mobius.boss.maniac.state === 'ride');
  await put(5); await gameWait(2);
  const a = await R(), log = await logSince(g0);
  await ev(() => { window.__S.closeCombat = true; });
  check(`range (switch off): close range ${a.cr}, floor ${a.minGap}, maniac ${a.m}, ring never, gap back to ${a.gap} m (≥ 8) from 5 m`, a.cr === 'far' && a.minGap === null && a.m === 'ride' && a.gap >= 8 && log.every((x) => !x[3] && x[2] === 'far'), JSON.stringify({ a, states: [...new Set(log.map((x) => x[4]))], bad: log.filter((x) => x[3] || x[2] !== 'far').slice(0, 5) }));
}
if (want('range.restart')) { // restart() while close: far at once, ring hidden; the new run starts far
  await rangeCalm(); await toTaunt(8);
  await ev(() => window.__mobius.worldChase.restart()); await frames(1);
  const a = await ev(() => { const w = window.__mobius.worldChase; return { cr: w.closeRange.state, ring: w.closeRing.visible, state: w.state }; });
  await p.waitForFunction(() => { const a = window.__mobius, w = a.worldChase; return a.state === 'world' && w.state === 'intro' && !a.loader.visible; }, null, { timeout: 900000, polling: 500 });
  const b = await ev(() => { const w = window.__mobius.worldChase; return { cr: w.closeRange.state, ring: w.closeRing.visible, state: w.state }; });
  check(`range (restart while close): right after ${JSON.stringify(a)}; new run ${JSON.stringify(b)}`, a.cr === 'far' && !a.ring && b.cr === 'far' && !b.ring, '');
}
if (want('range.fin')) { // killed while close: the finisher starts, close range far, no ring, he turns forward
  await rangeCalm(); await toTaunt(8);
  const a = await ev(() => { const w = window.__mobius.worldChase; window.__S.finisher = true; w.debug.setBossHp(1 / w.bossHp.max); const d = w._bossHit(20, w.bossPos.clone(), 'e2e-kill', 'lightBomb', 'weak'); return { d, state: w.state, cr: w.closeRange.state, ring: w.closeRing.visible, m: w.app.boss.maniac.state }; });
  await frames(2);
  const b = await R();
  check(`range (killed while close): ${a.state}, close range ${a.cr}, ring ${a.ring}, maniac ${a.m}; 2 frames later ${b.state} / ${b.cr} / ring ${b.ring}`, a.state === 'finisher' && a.cr === 'far' && !a.ring && a.m !== 'taunt' && b.cr === 'far' && !b.ring, JSON.stringify({ a, b }));
}

// ---------------------------------------------------------------- v0.46 revision 4: the shield gates the web, the fly-in hit, contact, bursts
if (ONLY.some((k) => k.startsWith('punch.'))) await ev(async () => { // audio / time-warp / fx.boom call logs (the calls still happen with audio off)
  const a = window.__mobius, A = (await import('/src/core/audio.js')).audio; window.__snd = []; window.__warp = []; window.__booms = [];
  const pl = A.play.bind(A); A.play = (n, ...x) => { window.__snd.push(n); if (window.__snd.length > 400) window.__snd.shift(); return pl(n, ...x); };
  const rq = a.timeWarp.request.bind(a.timeWarp); a.timeWarp.request = (k, o) => { window.__warp.push(k); return rq(k, o); };
  const bm = a.fx.boom.bind(a.fx); a.fx.boom = (pos, o = {}) => { window.__booms.push([+(window.__mobius.worldChase.clock).toFixed(2), o.color, o.size]); return bm(pos, o); };
});
const P = () => ev(() => { const a = window.__mobius, w = a.worldChase, l = a.locomotion, T = window.__THREE, chest = l.feet(new T.Vector3()).add(new T.Vector3(0, 1.3, 0));
  return { fight: w.fight.state, stab: +w.fight.stability.toFixed(1), hp: +w.bossHp.hp.toFixed(2), tethers: w.stats.tethers, tether: !!w.tether, holds: l.holds(w.jetAnchor), lunging: w._lunging, scripted: l.scripted,
    blue: w.targetRing.visible, red: w.closeRing.visible, cr: w.closeRange.state, gap: +(w.bossS - w.playerS).toFixed(2), dist: +chest.distanceTo(w.bossPos).toFixed(2), m: a.boss.maniac.state, state: w.state, fs: { ...w.fightStats },
    lastHit: w.lastHit, lastContact: w.lastContact, lastLunge: w.lastLunge, thrown: w.bombs.stats.thrown, clock: +w.clock.toFixed(2), pick: w.lastPick, booms: window.__booms.length, snd: window.__snd.length, warp: [...window.__warp], ban: a.hud.banner?.text, flow: w.flow.points, vel: +l.vel.length().toFixed(2) }; });
/** a web from the camera at his body point (the real hub → _onWeb path) */
const webAtHim = (hand = 'right') => ev((hand) => { const a = window.__mobius, T = window.__THREE, w = a.worldChase, o = a.camera.getWorldPosition(new T.Vector3()); window.__inj.push({ type: 'web', hand, origin: o, dir: w.bossPos.clone().sub(o).normalize() }); }, hand);
const punchCalm = async () => { await until(() => window.__mobius.boss.maniac.state !== 'hit', null, 300000); /* (a reaction still playing would return to the stagger pose after rangeCalm's reset) */ await rangeCalm(); await ev(() => { const w = window.__mobius.worldChase; w._contactT = -9; w._fxT = -9; w._tetherDmgStag = -1; window.__held = { left: true, right: true }; }); };
/** shield broken: a chip break (core shut — beyond close range a web at him is never the core), its window stretched to `len` s
 *  of game time; cause 'counter': the 6 s counter stagger (opening cap 30 — a break's cap 10 ends it with the first punch) */
const breakShield = (len = 6, cause = 'break', cap = null) => ev(([len, cause, cap]) => { const w = window.__mobius.worldChase; w.fight.forceStagger(cause); w.fight.staggerLen = len; if (cap) w.fight.staggerCause = cap; /* (cap 'counter': the 30 hp opening cap with the core shut) */ }, [len, cause, cap]);
/** free the (frozen) player and give them `v` m/s toward his body point */
const goAt = (v) => ev((v) => { const a = window.__mobius, w = a.worldChase, l = a.locomotion, T = window.__THREE; l.unfreeze(); const c = l.feet(new T.Vector3()).add(new T.Vector3(0, 1.3, 0)); l.vel.copy(w.bossPos).sub(c).normalize().multiplyScalar(v); }, v);
const sndSince = (n) => ev((n) => window.__snd.slice(n), n);
const cutText = () => ev(() => window.__t('story.tether.cut'));

if (want('punch.shield')) { // shield up at 12 m (taunting) and at 20 m: a web at him is a strike — no tether, no lunge, shield damage, no ring
  await punchCalm();
  for (const g of [12, 20]) {
    if (g === 12) await toTaunt(12); else { await put(20); await frames(2); }
    await gameWait(0.7);
    const a = await P(); await webAtHim(); await frames(2); const b = await P();
    check(`punch (shield up, ${g} m, ${a.cr}${a.m === 'taunt' ? ', taunting' : ''}): web → ${b.pick?.took}/${b.pick?.how} ${b.lastHit?.src}/${b.lastHit?.kind}, shield ${a.stab} → ${b.stab}, tethers ${a.tethers} → ${b.tethers}, lunges ${b.fs.lunges - a.fs.lunges}, rings blue ${b.blue} red ${b.red}`,
      b.pick?.took === 'boss' && b.pick?.how === 'strike' && b.lastHit?.src === 'web' && b.stab < a.stab && b.tethers === a.tethers && !b.tether && !b.holds && b.fs.lunges === a.fs.lunges && !b.lunging && !a.blue && !a.red && !b.blue && !b.red, JSON.stringify({ a, b }));
  }
}
if (want('punch.blue')) { // staggered at 20 m: blue ring only; a web attaches to the jet, is held 2 s (no cut, no thrown pumpkin, no blast); a second attach in the same stagger deals no damage
  await punchCalm(); await put(20); await breakShield(8); await frames(2);
  const a = await P(); await put(20, 3.5); await frames(1); await lookAtBoss(); await frames(2);
  const s = await P(); await p.screenshot({ path: `${SHOTS}/close-blue-ring.png` });
  check(`punch (staggered, 20 m): rings blue ${a.blue} / red ${a.red}, close range ${a.cr} (screenshot: blue ${s.blue} → ${SHOTS}/close-blue-ring.png)`, a.fight === 'staggered' && a.blue && !a.red && a.cr === 'far' && s.blue && !s.red, JSON.stringify({ a, s }));
  const n0 = await P(); await webAtHim('left'); await frames(2); const b = await P();
  const t0 = await clock(); await gameWait(2); const c = await P(), cut = await cutText();
  check(`punch (staggered, 20 m): web → ${b.pick?.how}, tethers ${n0.tethers} → ${b.tethers}, attached ${b.holds}, damage ${b.lastHit?.src} ${b.lastHit?.hp} hp; held ${(c.clock - t0).toFixed(2)} s of game time: attached ${c.holds}, pumpkins thrown ${b.thrown} → ${c.thrown}, booms ${b.booms} → ${c.booms}, banner "${c.ban}", blue ring ${c.blue}`,
    b.pick?.how === 'attach' && b.tethers === n0.tethers + 1 && b.tether && b.holds && b.lastHit?.src === 'tether' && b.lastHit?.hp > 0 && c.tether && c.holds && c.thrown === b.thrown && c.booms === b.booms && c.ban !== cut && c.fight === 'staggered' && !c.blue, JSON.stringify({ n0, b, c }));
  await ev(() => window.__mobius.worldChase._releaseTether()); await frames(1);
  const d0 = await P(); await webAtHim('left'); await frames(2); const d = await P();
  check(`punch (staggered, second attach in the same stagger): tethers ${d0.tethers} → ${d.tethers}, boss HP ${d0.hp} → ${d.hp} (no damage)`, d.tethers === d0.tethers + 1 && d.holds && d.hp === d0.hp, JSON.stringify({ d0, d }));
}
if (want('punch.end')) { // the stagger ends while the web is on the jet: a quiet release (release sound; no blast, no banner)
  await punchCalm(); await put(20); await breakShield(8); await frames(2);
  await webAtHim('left'); await frames(2); const a = await P(), n = a.snd;
  await ev(() => { const F = window.__mobius.worldChase.fight; F.t = F.staggerLen; }); await frames(3);
  const b = await P(), snd = await sndSince(n), cut = await cutText();
  check(`punch (stagger ends while attached ${a.holds}): fight ${b.fight}, attached ${b.holds}, tether ${b.tether}; sounds ${JSON.stringify(snd)}, booms ${a.booms} → ${b.booms}, banner "${b.ban}"`,
    a.holds && b.fight === 'recovering' && !b.holds && !b.tether && snd.includes('release') && !snd.includes('boomEnemy') && b.booms === a.booms && b.ban !== cut, JSON.stringify({ a, b, snd }));
}
if (want('punch.red')) { // staggered at 12 m: red ring only; web → lunge → contact → Head Hit, punch sound, burst, rebound; locomotion free again
  await punchCalm(); await put(12, 3.5); await breakShield(8, 'counter'); await frames(2);
  const a = await P(); await lookAtBoss(); await frames(1);
  await goAt(6); const n = (await P()).snd; await webAtHim(); await frames(1);
  const l0 = await P();
  await until(() => window.__mobius.worldChase.lastLunge?.done != null, null, 300000);
  await p.screenshot({ path: `${SHOTS}/close-lunge-hit.png` });
  const b = await P(), snd = await sndSince(n);
  const clips = await hitClips();
  await frames(3); const c = await P();
  check(`punch (staggered, 12 m): rings blue ${a.blue} / red ${a.red}, maniac ${a.m}; web → ${l0.pick?.how}, lunging ${l0.lunging} (scripted ${l0.scripted}); ${JSON.stringify(b.lastLunge)} → contact ${b.lastContact?.kind} −${b.lastContact?.hp} hp (HP ${a.hp} → ${b.hp}), maniac ${b.m} clip ${clips[0]}, away ${b.lastContact?.away} m/s, warp ${JSON.stringify(b.warp.slice(-1))}, Flow +${b.flow - a.flow}, bursts +${b.fs.bursts - a.fs.bursts}, sounds ${JSON.stringify(snd)}; scripted after ${b.scripted} / 3 frames later ${c.scripted} (screenshot ${SHOTS}/close-lunge-hit.png)`,
    a.red && !a.blue && a.m === 'taunt' /* v0.49: he has turned to face the player */ && l0.pick?.how === 'lunge' && b.lastLunge?.done === 'contact' && b.lastContact?.lunge && b.lastContact?.kind !== 'shield' && b.lastContact?.hp === 10 && a.hp - b.hp >= 10 && b.m === 'hit' && /^headHit/.test(clips[0] || '') && b.lastContact.away >= 8 && b.warp.at(-1) === 'punch' && b.flow - a.flow >= 2 && b.fs.bursts > a.fs.bursts && snd.includes('punch') && !b.scripted && !c.scripted && !c.lunging && c.state === 'chase', JSON.stringify({ a, l0, b, c, clips, snd }));
}
if (want('punch.contact')) { // shield up: the chest at him (placed 1.45 m behind his body point at 18 m/s — at ~1 fps his early brake would
  // otherwise keep the gap: locomotion steps 1/30 s per frame, his pursuit 0.1 s) → a punch on the shield, pushed back; the route gap never below 1.5 m
  await punchCalm(); await put(10, 3.5); await frames(2);
  const a = await P(), g0 = await clock();
  await ev(() => { const a = window.__mobius, w = a.worldChase, l = a.locomotion, T = window.__THREE; l.unfreeze(); const h = w.world.headingAt(w.bossS), f = new T.Vector3(Math.sin(h), 0, -Math.cos(h));
    const ft = w.bossPos.clone().addScaledVector(f, -1.45); ft.y -= 1.3; l.placeAt(ft, -h); l.vel.copy(f).multiplyScalar(18); w.playerS = w.bossS - 1.5; w._prevPS = null; w._bv = 0; window.__cd = []; if (!w.__cdh) { w.__cdh = true; const u = w.update.bind(w); w.update = (dt, t, r) => { u(dt, t, r); if (window.__cd && window.__cd.length < 500) { const c = l.feet(new T.Vector3()).add(new T.Vector3(0, 1.3, 0)); window.__cd.push([+w.clock.toFixed(2), +(w.bossS - w.playerS).toFixed(2), +c.distanceTo(w.bossPos).toFixed(2)]); } }; } });
  const ok = await until((n) => window.__mobius.worldChase.fightStats.contacts > n, a.fs.contacts, 60000).then(() => true, () => false);
  if (!ok) console.log('no contact:', JSON.stringify(await ev(() => { const a = window.__mobius, w = a.worldChase, l = a.locomotion, T = window.__THREE, c = l.feet(new T.Vector3()).add(new T.Vector3(0, 1.3, 0)); return { st: w.state, close: w.closeOn, lung: w._lunging, resp: w._respawning, vis: a.boss.root.visible, d: c.distanceTo(w.bossPos), cd: window.__cd?.slice(0, 8), cT: w._contactT, clock: w.clock, frozen: l.frozen }; })));
  const b = await P();
  await gameWait(1); const c = await P(), log = await ev(() => window.__cd);
  const after = log.filter((x) => x[0] > b.lastContact.t), mnGap = Math.min(...log.map((x) => x[1])), d1 = after.at(-1)?.[2];
  check(`punch (shield up, contact): ${b.lastContact?.kind} (shield ${a.stab} → ${b.stab}), pushed back at ${b.lastContact?.away} m/s, maniac ${b.m}; over ${(c.clock - g0).toFixed(1)} s the route gap ≥ ${mnGap} m, distance to him ${after[0]?.[2]} → ${d1} m; contacts ${c.fs.contacts} (cooldown), scripted ${c.scripted}`,
    (b.lastContact?.kind === 'shield' || b.lastContact?.kind === 'break') && b.stab < a.stab && b.lastContact.away >= 8 && mnGap >= 1.5 && d1 > after[0][2] && !c.scripted && !b.lastContact.lunge, JSON.stringify({ a, b, c, log: log.slice(0, 20) }));
  await ev(() => { window.__cd = null; window.__mobius.locomotion.freeze(); });
}
if (want('punch.throw')) { // 16 m with the shield up: outside close range — he does not taunt, the attack range allows a throw (≥ 14 m), and a throw
  // started there is released (forced: right after entering the chase the route's start / recovery modules are quiet, so the
  // fairness check would hold a natural throw back for reasons that have nothing to do with close range)
  await punchCalm(); await put(16); await frames(2); await gameWait(0.5);
  const a = await P(), g0 = await clock(), fair0 = await ev(() => { const w = window.__mobius.worldChase; return { dist: +w._fair.dist?.toFixed(2), min: 14 }; });
  await ev(() => { const w = window.__mobius.worldChase; w.debug.attack('single'); });
  await until(() => { const w = window.__mobius.worldChase; return w.bombs.stats.thrown > 0 && w.fight.state !== 'telegraph'; }, null, 300000);
  const b = await P(), log = await logSince(g0 - 0.5);
  check(`punch (shield up, 16 m): close range ${a.cr}, maniac ${a.m}, attack distance ${fair0.dist} m (≥ ${fair0.min}); single → thrown ${a.thrown} → ${b.thrown} after ${(b.clock - g0).toFixed(1)} s, maniac states ${[...new Set(log.map((x) => x[4]))].join(', ')}, close range ${[...new Set(log.map((x) => x[2]))].join(', ')}`,
    a.cr === 'far' && a.m === 'ride' && fair0.dist >= 14 && b.thrown > a.thrown && !log.some((x) => x[4] === 'taunt') && log.every((x) => x[2] === 'far'), JSON.stringify({ a, b, fair0 }));
  await ev(() => { const w = window.__mobius.worldChase; w.fight.nextAttackIn = 1e9; w.bombs.clear(); });
}
if (want('punch.burst')) { // an ordinary web hit makes one pooled burst; two hits 0.1 s apart make one; a limited (blocked) web none
  await punchCalm(); await put(20); await frames(2); await gameWait(0.5);
  const a = await P(); await webAtHim(); await frames(2); const b = await P();
  const bl = await ev(() => { const w = window.__mobius.worldChase; w._fxT = -9; w._fightHit('web', 'body', w.bossPos.clone(), null); const n = w.fightStats.bursts, r = w._fightHit('web', 'body', w.bossPos.clone(), null); w._fxT = -9; return { kind: r?.kind, d: w.fightStats.bursts - n }; }); // (back to back: the web limiter blocks the second)
  await gameWait(0.4);
  // two Light Bomb hits one 0.1 s frame apart (the second fired from inside the chase update, by game time)
  const c0 = await P();
  await ev(() => { const w = window.__mobius.worldChase; window.__b2 = null; if (!w.__b2h) { w.__b2h = true; const u = w.update.bind(w); w.update = (dt, t, r) => { u(dt, t, r); if (window.__b2 && !window.__b2.t2 && w.clock >= window.__b2.at - 1e-6) { w._fightHit('lightBomb', 'body', w.bossPos.clone(), 'e2e-b2'); window.__b2.t2 = w.clock; } }; }
    w._fightHit('lightBomb', 'body', w.bossPos.clone(), 'e2e-b1'); window.__b2 = { t1: w.clock, at: w.clock + 0.1, t2: null }; });
  await until(() => window.__b2?.t2 != null, null, 120000); const c = await P(); const { t1, t2 } = await ev(() => window.__b2);
  const b2 = b;
  const pooled = await ev(() => { const fx = window.__mobius.fx; return { booms: fx.booms.items.length, sys: fx.vfx.systems.length }; });
  check(`punch (bursts): web ${b.lastHit?.kind} → bursts +${b.fs.bursts - a.fs.bursts} (fx.boom calls ${a.booms} → ${b.booms}); limited web ${bl.kind} → +${bl.d}; two Light Bomb hits ${(t2 - t1).toFixed(2)} s apart → +${c.fs.bursts - c0.fs.bursts}; boom pool ${pooled.booms} items`,
    b.lastHit?.kind === 'shield' && b.fs.bursts - a.fs.bursts === 1 && b.booms > a.booms && bl.kind === 'blocked' && bl.d === 0 && t2 - t1 <= 0.15 && t2 > t1 && c.fs.bursts - c0.fs.bursts === 1 && pooled.booms <= 16, JSON.stringify({ a, b, b2, c0, c, t1, t2 }));
}
if (want('punch.held')) { // C1: web at 20 m (blue) → attached; pulled in to 12 m still holding it (red) → the other hand's web = the fly-in (the jet web released), punch, rebound
  await punchCalm(); await put(20); await breakShield(8, 'break', 'counter'); await frames(2);
  await webAtHim('left'); await frames(2); const a = await P();
  await ev(() => { const a = window.__mobius, w = a.worldChase, l = a.locomotion, s = w.bossS - 12, p = w.world.pointAt(s), h = w.world.headingAt(s); p.y += 3.5; l.placeAt(p, -h); w.playerS = s; w._prevPS = null; w._bv = 0; }); // (pulled in: moved without put() — its freeze() would drop the web)
  await frames(2); const b = await P();
  await lookAtBoss(); await goAt(6); await webAtHim('right'); await frames(1); const c = await P();
  await until(() => window.__mobius.worldChase.lastLunge?.done != null, null, 300000); const d = await P(); await frames(2); const e = await P();
  check(`punch (held jet web): attached at 20 m (${a.pick?.how}, holds ${a.holds}); at 12 m still holding (${b.holds}), rings blue ${b.blue} / red ${b.red}; web with the other hand → ${c.pick?.how}, lunging ${c.lunging}, jet web released ${!c.holds && !c.tether}; → ${d.lastLunge?.done}, ${d.lastContact?.kind} −${d.lastContact?.hp} hp, away ${d.lastContact?.away} m/s; tether ${e.tether}, scripted ${e.scripted}`,
    a.pick?.how === 'attach' && a.holds && b.holds && b.red && !b.blue && c.pick?.how === 'lunge' && c.lunging && !c.holds && !c.tether && d.lastLunge?.done === 'contact' && d.lastContact?.lunge && d.lastContact.hp === 10 && d.lastContact.away >= 8 && !e.tether && !e.holds && !e.scripted, JSON.stringify({ a, b, c, d }));
}
if (want('punch.respawn')) { // M1: a respawn during the fly-in ends it (scripted restored); during the fade a web starts nothing and no ring shows
  await punchCalm(); await put(14, 3.5); await breakShield(10, 'break', 'counter'); await frames(2);
  await goAt(0); await webAtHim(); await frames(1); const a = await P();
  await ev(() => window.__mobius.worldChase.respawn('story.fail.fall')); const b = await P();
  await webAtHim(); // (same task as the respawn: processed in the next frame, inside the fade)
  await frames(1); const c = await P(); const r0 = await ev(() => window.__mobius.worldChase._respawning), r1 = c.pick?.t >= b.clock ? c.pick?.how : 'none';
  await until(() => !window.__mobius.worldChase._respawning, null, 300000); await frames(2); const d = await P();
  check(`punch (respawn mid-flight): lunging ${a.lunging} → respawn → lunging ${b.lunging}, scripted ${b.scripted}, done ${b.lastLunge?.done}; web during the fade (still fading ${r0}, how ${r1}) → lunges ${b.fs.lunges} → ${c.fs.lunges}, rings ${c.blue}/${c.red}; after the fade scripted ${d.scripted}`,
    a.lunging && !b.lunging && !b.scripted && b.lastLunge?.done === 'respawn' && r1 !== 'lunge' && r1 !== 'attach' && c.fs.lunges === b.fs.lunges && !c.lunging && (!r0 || (!c.blue && !c.red)) && !d.scripted && !d.lunging, JSON.stringify({ a, b, c, d }));
}
if (want('punch.cancel')) { // M2: the stagger ends while the fly-in is in flight → cancelled: no hit, no rebound, scripted restored
  await punchCalm(); await put(14, 3.5); await breakShield(10, 'break', 'counter'); await frames(2);
  await goAt(0); await webAtHim(); await frames(1); const a = await P();
  await ev(() => { const F = window.__mobius.worldChase.fight; F.t = F.staggerLen; }); await until(() => window.__mobius.worldChase.lastLunge?.done != null, null, 120000); await frames(1);
  const b = await P();
  check(`punch (stagger ends mid-flight): lunging ${a.lunging} at ${a.dist} m → ${b.lastLunge?.done}, fight ${b.fight}, contacts ${a.fs.contacts} → ${b.fs.contacts}, HP ${a.hp} → ${b.hp}, scripted ${b.scripted}`,
    a.lunging && b.lastLunge?.done === 'staggerEnd' && b.fs.contacts === a.fs.contacts && b.hp === a.hp && !b.scripted && !b.lunging, JSON.stringify({ a, b }));
}
if (want('punch.flash')) { // M3: a punch right after another hit (< 0.25 s) still shows its large burst and white flash
  await punchCalm(); await put(20); await breakShield(8, 'break', 'counter'); await frames(2); await gameWait(0.4);
  const r = await ev(() => { const w = window.__mobius.worldChase, n0 = w.fightStats.bursts, b0 = window.__booms.length;
    w._fightHit('lightBomb', 'body', w.bossPos.clone(), 'e2e-fl1'); const n1 = w.fightStats.bursts; w._fightHit('punch', 'body', w.bossPos.clone(), null); const n2 = w.fightStats.bursts;
    const t = w._fxT, c = w.clock; w._fightHit('web', 'body', w.bossPos.clone(), null); // (right after the punch: the limiter is stamped)
    return { lb: n1 - n0, punch: n2 - n1, after: w.fightStats.bursts - n2, stamped: t === c, booms: window.__booms.slice(b0).map((x) => x[1]) }; });
  check(`punch (burst after another hit): Light Bomb +${r.lb}, punch +${r.punch} (same frame), web right after +${r.after}; limiter stamped ${r.stamped}; boom colours ${JSON.stringify(r.booms)}`,
    r.lb === 1 && r.punch === 1 && r.after === 0 && r.stamped && r.booms.includes(0xffffff), JSON.stringify(r));
}
if (want('punch.fin')) { // boss at 1 HP, staggered: the fly-in hit kills → the finisher starts; locomotion is not left scripted
  await punchCalm(); await put(10, 3.5); await breakShield(8); await frames(2);
  await ev(() => { const w = window.__mobius.worldChase; window.__S.finisher = true; w.debug.setBossHp(1 / w.bossHp.max); });
  await lookAtBoss(); await goAt(6); await webAtHim(); await frames(1); const l0 = await P();
  await until(() => window.__mobius.worldChase.lastLunge?.done != null, null, 300000);
  const b = await P(); await frames(5); const c = await P(), fin = await ev(() => window.__mobius.worldChase.finisher.state);
  check(`punch (kill by the fly-in): lunge ${l0.lunging} → ${b.lastLunge?.done}, state ${b.state} (finisher ${fin}), scripted ${b.scripted} / 5 frames later ${c.scripted}, lunging ${c.lunging}`,
    l0.lunging && b.lastLunge?.done === 'contact' && b.state === 'finisher' && !b.scripted && !c.scripted && !c.lunging && (c.state === 'finisher' || c.state === 'victory' || c.state === 'results'), JSON.stringify({ l0, b, c, fin }));
}

console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed`);
if (logs.length) console.log(logs.slice(0, 30).join('\n'));
void OUT;
await b.close();
process.exit(fails || !results.length ? 1 : 0);
