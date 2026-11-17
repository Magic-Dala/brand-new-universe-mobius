// v0.47 Story chase combat end-to-end (headless Chromium + SwiftShader; needs `npm run dev`).
// Real app, frames stepped by hand (deterministic, 60 Hz), input injected right after the real InputHub.update() — the
// same path a wrist web / Light Bomb / Fan Web takes from the headset. Prints PASS / FAIL lines; exit code 1 on any FAIL.
//   ONLY (default all three): chase, endless, off — each loads its own page (a clean Story run).
//   CHROME=/usr/bin/google-chrome URL=https://localhost:5173/ ONLY=chase node tests/e2e/storycombat.e2e.mjs
// Software rendering is slow: the page waits below are long on purpose (BOOT ms, default 240000 for the first load).
// Nothing here says anything about a Quest 3.
import { chromium } from 'playwright';
import { openStory as open, CHROME_ARGS } from './storyharness.mjs';

const GROUPS = (process.env.ONLY || 'chase,endless,off').split(',').filter(Boolean);
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: CHROME_ARGS });
const openStory = (opts) => open(browser, opts);
let fails = 0, passes = 0;
const check = (name, ok, info = '') => { if (ok) passes++; else fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' — ' + (typeof info === 'string' ? info : JSON.stringify(info)) : ''}`); };

// ====================================================================================================== the first chase
if (GROUPS.includes('chase')) {
  console.log('---- chase (settings.storyCombat = true)');
  const { p, errors } = await openStory({ combat: true });
  const ev = (f, arg) => p.evaluate(f, arg);

  const r0 = await ev(async () => { const { a, s, c, C, X = window.__x } = window.__x; X.quiet(); X.render(); X.step(30); X.render(); window.__p0 = new Set(a.renderer.info.programs.map((g) => g.cacheKey));
    return { stage: s.stage, state: c.state, active: C.active, running: C.running, on: C.on, bank: (window.__x.audio.useBank), useStory: window.__x.audio.useStory, storyNames: Object.keys((await window.__imp('/src/data/sfxManifest.js')).SFX_MANIFEST_STORY), hud: !!a.hud.story, storyP: a.hud.storyP.visible, vit: a.hud.vit.visible, boss: a.hud.boss.visible, fightP: a.hud.fightP.visible, p0: X.progs(), ringKind: c.ringKind, gap: +X.gap().toFixed(1), tier: C.stumble.tier(1) }; });
  check('the chase runs the combat loop (stage chase, combat active and running, sample bank on)', r0.stage === 'chase' && r0.state === 'chaseStraight' && r0.active && r0.running && r0.bank === true, r0);
  check('HUD: Light Bomb ring and Flow pips only (no health panel, no boss bar, no fight strip)', r0.hud && r0.storyP && !r0.vit && !r0.boss && !r0.fightP, { story: r0.hud, storyP: r0.storyP, vit: r0.vit, boss: r0.boss, fightP: r0.fightP });
  const P0 = r0.p0;
  // ---- sound: the Story's own samples are in use here (and decoded when the page has audio)
  const rs = await ev(async () => { const X = window.__x, A = X.audio; await A.loadStorySfx(); const names = Object.keys((await window.__imp('/src/data/sfxManifest.js')).SFX_MANIFEST_STORY);
    return { ctx: A.ctx?.state || null, useStory: A.useStory, storyBank: !!A.storyBank, loaded: names.filter((n) => A.storyBank?.has(n)), names, shared: !!A.storyBank && A.storyBank.voices === A.bank.voices, lines: X.a.voice ? Object.keys((await window.__imp('/src/game/voice.js')).VO_LINES).filter((k) => ['STALL', 'PUNCHED', 'ESCAPE'].includes(k)) : [] }; });
  check(`sound: the Story sample set is on in Story (${rs.loaded.length} of ${rs.names.length} names decoded: ${rs.loaded.join(', ')}), one voice pool, the STALL / PUNCHED / ESCAPE lines exist`, rs.useStory === true && rs.storyBank && rs.shared && (rs.ctx !== 'running' || rs.loaded.length === rs.names.length) && rs.lines.length === 3, rs);

  // ---- a web on him outside a stall does not stick; it is a web strike (pressure + 1), rate limited
  const r1 = await ev(() => { const X = window.__x, { c, C, a } = X;
    X.behind(26); X.step(20);
    const p0 = C.stumble.pressure; X.webBoss(); X.step(1);
    const one = { pressure: C.stumble.pressure, took: C.lastPick?.took, how: C.lastPick?.how, jetRope: X.jetRope(), tethers: c.cstats.tethers, jetWebs: C.cstats.jetWebs, tether: !!c.tether, strikes: C.cstats.strikes };
    X.webBoss('left'); X.step(1); const limited = C.stumble.pressure; // 1 frame later: inside the 0.6 s limit
    X.step(40); X.webBoss(); X.step(1);
    return { p0, one, limited, after: C.stumble.pressure, maniac: a.boss.maniac.state }; });
  check('a web on him outside a stall does not stick (a web strike: pressure + 1, no rope on the jet, no v0.21 tether)', r1.one.pressure === r1.p0 + 1 && r1.one.took === 'boss' && r1.one.how === 'strike' && !r1.one.jetRope && r1.one.tethers === 0 && r1.one.jetWebs === 0 && !r1.one.tether, r1.one);
  check('web strikes are rate limited (a second one a frame later does not count; one 0.7 s later does)', r1.limited === r1.one.pressure && r1.after === r1.one.pressure + 1, { limited: r1.limited, after: r1.after });

  // ---- pressure to a stall with web strikes 0.6 s apart
  const r2 = await ev(() => { const X = window.__x, { c, C, a } = X;
    let n = 0; const tw = [];
    while (C.stumble.state === 'chasing' && n < 20) { X.step(37); X.behind(26); X.webBoss(); X.step(1); n++; }
    const at = { state: C.stumble.state, stalls: C.cstats.stalls, frac: C.stumble.frac, warp: a.timeWarp.scale, banner: a.hud.banner.text, maniac: a.boss.maniac.state, strikes: C.cstats.strikes };
    X.render();
    // his speed along the route while stalled (the player close behind, so the v0.46 pacing would be 18 m/s)
    X.behind(13); const b0 = c.bossS; for (let i = 0; i < 60; i++) { X.step(1); tw.push(a.timeWarp.scale); }
    return { n, at, speed: +(c.bossS - b0).toFixed(2), stillStalled: C.stumble.state, cap: X.SC.stall.speedCap, need: X.SC.pressure.threshold, lockout: X.SC.stall.lockout, warpBack: tw.at(-1) }; });
  check(`pressure to a stall (${r2.at.strikes} web strikes in all → stalled, the first-stall banner, impact time)`, r2.at.state === 'stalled' && r2.at.stalls === 1 && r2.at.frac === 1 && r2.at.strikes === r2.need && r2.at.warp < 1 && /失速|stalled/i.test(r2.at.banner || ''), r2.at);
  check(`stalled: his route speed is capped (${r2.speed} m in 1 s ≤ ${r2.cap} m/s) and impact time has ended (scale ${r2.warpBack})`, r2.stillStalled === 'stalled' && r2.speed <= r2.cap + 0.3 && r2.warpBack === 1, r2);

  // ---- the red ring: inside 15 m, only while he is stalled
  const r3 = await ev(() => { const X = window.__x, { c, C } = X;
    X.stall(); X.step(1);
    X.behind(21); X.step(8); const far = { gap: +X.gap().toFixed(1), ring: c.ringKind, ringOn: C.ringOn, vis: c.targetRing.visible };
    X.behind(12); X.step(8); X.render(); const near = { gap: +X.gap().toFixed(1), ring: c.ringKind, ringOn: C.ringOn, vis: c.targetRing.visible, color: c.targetRing.material.color.getHex() };
    C.stumble.cancel(); X.behind(12); X.step(1); const calm = { gap: +X.gap().toFixed(1), ring: c.ringKind, ringOn: C.ringOn, state: C.stumble.state };
    return { far, near, calm }; });
  check('red ring inside 15 m only while stalled (21 m stalled: no red ring; 12 m stalled: red ring; 12 m not stalled: none)', r3.far.ring !== 'red' && !r3.far.ringOn && r3.near.ring === 'red' && r3.near.vis && r3.near.color === 0xff3b30 && r3.calm.ring === null && !r3.calm.ringOn, r3);
  check('beyond the ring while stalled the blue ring marks the jet hook (a web sticks there)', r3.far.ring === 'blue', r3.far);

  // ---- stalled, beyond the ring: a web sticks to the jet; it lets go when the stall ends
  const r3b = await ev(() => { const X = window.__x, { c, C, loco } = X;
    X.stall(); X.step(1); X.behind(22); X.step(8); loco.cling = null; // free to be pulled
    X.webBoss(); X.step(2); const stuck = { how: C.lastPick?.how, rope: X.jetRope(), jetWebs: C.cstats.jetWebs, tethers: c.cstats.tethers, counters: c.cstats.counters };
    C.stumble.cancel(); X.step(2); const after = { rope: X.jetRope(), jetWeb: !!C.jetWeb, valid: C.jetAnchor.valid };
    return { stuck, after }; });
  check('stalled beyond the ring: the web sticks to the jet (no counter), and lets go when the stall ends', r3b.stuck.how === 'attach' && r3b.stuck.rope && r3b.stuck.jetWebs === 1 && r3b.stuck.tethers === 0 && r3b.stuck.counters === 0 && !r3b.after.rope && !r3b.after.jetWeb && !r3b.after.valid, r3b);

  // ---- web the ring → fly-in → punch → break-away → tier up
  const r4 = await ev(() => { const X = window.__x, { c, C, a, loco } = X;
    X.quiet(); X.stall(); X.step(1); X.behind(12); X.step(8);
    const coins0 = a.coins.count, punches0 = C.stumble.punches, tier0 = C.stumble.tier(1), style0 = C.stats.style;
    loco.cling = null; X.webBoss(); X.step(1);
    const start = { lunging: C.lunging, scripted: loco.scripted, how: C.lastPick?.how, lunges: C.cstats.lunges };
    let frames = 0, minScale = 1, hitState = null; while (C.lunging && frames < 150) { X.step(1); frames++; }
    for (let i = 0; i < 8; i++) { minScale = Math.min(minScale, a.timeWarp.scale); if (a.boss.maniac.state === 'hit') hitState = 'hit'; X.step(1); }
    X.render();
    const hit = { frames, done: C.lastLunge?.done, punches: C.stumble.punches - punches0, state: C.stumble.state, scripted: loco.scripted, maniac: hitState, minScale, velAway: +loco.vel.length().toFixed(1), gapAfter: +X.gap().toFixed(1), banner: a.hud.banner.text };
    // the Bitcoins fly to the player (free fall here; the magnet follows)
    let k = 0; while (a.coins.count < coins0 + X.SC.coinBurst && k < 240) { X.step(1); k++; }
    X.render();
    const coins = { got: a.coins.count - coins0, frames: k };
    // break-away: pressure cannot build for the lockout time, he pulls back to his lead, the tier went up
    X.behind(13); X.step(2);
    const g0 = +X.gap().toFixed(1), gain = C.stumble.gain('pumpkin', C.clock), gainLB = C.stumble.gain('lightBomb', C.clock);
    let minGap = 1e9; for (let i = 0; i < 120; i++) { X.step(1); minGap = Math.min(minGap, X.gap()); }
    const away = { g0, gapAfter2s: +X.gap().toFixed(1), minGap: +minGap.toFixed(1), gain, gainLB, tier0, tier: C.stumble.tier(1), state: C.stumble.state, style: C.stats.style - style0, statsPunches: C.stats.punches };
    X.step(60 * 5); const back = { state: C.stumble.state, maniac: a.boss.maniac.state, gain: C.stumble.gain('pumpkin', C.clock) }; C.stumble.cancel();
    return { start, hit, coins, away, back }; });
  check('web at the red ring starts the fly-in (rig scripted, how = lunge)', r4.start.lunging && r4.start.scripted && r4.start.how === 'lunge' && r4.start.lunges === 1, r4.start);
  check(`fly-in reaches him and punches (${r4.hit.frames} frames, punches + 1, Head Hit, slow motion ${r4.hit.minScale}, the rig is free again)`, r4.hit.done === 'contact' && r4.hit.punches === 1 && r4.hit.state === 'lockout' && !r4.hit.scripted && r4.hit.maniac === 'hit' && r4.hit.minScale < 1, r4.hit);
  check(`the punch knocks ${r4.coins.got} Bitcoins out of him and the magnet brings them in (${r4.coins.frames} frames)`, r4.coins.got === 8, r4.coins);
  check(`break-away: no pressure for ${r2.lockout} s, he pulls away (gap ${r4.away.g0} → ${r4.away.gapAfter2s} m in 2 s), tier ${r4.away.tier0} → ${r4.away.tier}`, r4.away.state === 'lockout' && !r4.away.gain && !r4.away.gainLB && r4.away.gapAfter2s > 14 && r4.away.gapAfter2s > r4.away.g0 && r4.away.tier === r4.away.tier0 + 1 && r4.away.statsPunches === 1 && r4.away.style > 0, r4.away);
  check(`after the ${r2.lockout} s lockout pressure builds again`, r4.back.state === 'chasing' && r4.back.gain === true, r4.back);
  check('after a punch he rides the jet again (not left in the stall\'s hurt pose)', r4.back.maniac === 'ride', r4.back);

  // ---- he cannot be reached outside a stall: the 14 m floor, the 1.5 m last resort, body contact only pushes back
  const r5 = await ev(() => { const X = window.__x, { c, C, a, loco, T } = X;
    X.quiet(); C.stumble.cancel(); X.behind(30); X.step(30);
    // a fast player (20 m/s along the route) for 4 s: the gap never drops under the floor by more than a metre
    let sv = c.bossS - 20, minGap = 1e9; const y = a.boss.root.position.y - 3;
    for (let i = 0; i < 240; i++) { sv += 20 / 60; X.at(sv, y); X.step(1); if (i > 30) minGap = Math.min(minGap, X.gap()); }
    const floor = { minGap: +minGap.toFixed(2) };
    // teleported 30 m past him: on the next frame he is at least 1.5 m ahead again (never behind the player)
    X.at(c.bossS + 30, y); X.step(1); const past = { gap: +X.gap().toFixed(2), state: C.stumble.state };
    // body contact outside a stall: pushed back, no punch
    X.step(30); C._refresh(); const punches0 = C.stumble.punches, contacts0 = C.cstats.contacts;
    loco.detach(true); loco.cling = null; loco.placeAt(C.bossPos.clone().add(new T.Vector3(0, -1.3 - 1.0, 0)), null); loco.grounded = false; loco.vel.set(0, 6, 0);
    X.step(2); const bump = { contacts: C.cstats.contacts - contacts0, punches: C.stumble.punches - punches0, vy: +loco.vel.y.toFixed(1), punched: C.lastContact?.punched };
    return { floor, past, bump }; });
  check(`outside a stall he keeps the 14 m floor against a 20 m/s player (min gap ${r5.floor.minGap} m)`, r5.floor.minGap >= 13, r5.floor);
  check(`never flown through: placed 30 m past him → he is ${r5.past.gap} m ahead on the next frame (≥ 1.5 m)`, r5.past.gap >= 1.5 - 1e-6, r5.past);
  check('body contact outside a stall only pushes the player back (no punch)', r5.bump.contacts === 1 && r5.bump.punches === 0 && r5.bump.punched === false, r5.bump);

  // ---- pumpkins: the aim lock shoots one down (pressure + 1); a hit on the player never ends the chase
  const r6 = await ev(() => { const X = window.__x, { c, C, a, s, loco, T } = X;
    X.quiet(); C.stumble.cancel(); X.behind(28); X.step(20);
    // (a) aim lock + web
    const it = X.pumpkin(); X.step(20); a.hub.aim.right.origin.copy(X.chest()); a.hub.aim.right.dir.copy(it.pos.clone().sub(X.chest()).normalize()); a.hub.aim.right.valid = true;
    const p0 = C.stumble.pressure, pk0 = C.stats.pumpkins;
    X.web(it.pos.clone()); X.step(1); X.render();
    const shot = { took: C.lastPick?.took, active: it.active, pressure: C.stumble.pressure - p0, pumpkins: C.stats.pumpkins - pk0 };
    // (b) six pumpkins reach the player
    for (let i = 0; i < 12; i++) C.flow.gain('pumpkin'); const flow0 = C.flow.level; C.stumble.cancel(); for (let i = 0; i < 5; i++) C.stumble.gain('pumpkin', C.clock);
    const hits0 = C.cstats.hitsTaken, lows = []; let minP = 1e9;
    for (let n = 0; n < 6; n++) { X.behind(28); X.pumpkin(); for (let i = 0; i < 200 && X.flying().length; i++) { X.step(1); minP = Math.min(minP, C.stumble.pressure); } lows.push(C.stumble.pressure); }
    X.render();
    const hit = { hits: C.cstats.hitsTaken - hits0, stage: s.stage, state: c.state, fade: +s.fade.a.toFixed(2), menu: a.menus.open, paused: s.paused, running: C.running, flow0, flow: C.flow.level, lows, minP, stumble: C.stumble.state, worldMenu: a.menus.current };
    // (c) what one blast does to the velocity (the same function the blast calls)
    loco.cling = null; loco.vel.set(10, -3, 0); const ch = X.chest(); C._chest.copy(ch); C._playerHit({ pos: ch.clone().add(new T.Vector3(0, 0, -2)) });
    const vel = loco.vel.toArray().map((v) => +v.toFixed(2));
    return { shot, hit, vel }; });
  check('pumpkin aim lock: a web destroys the locked pumpkin (pressure + 1, counted)', r6.shot.took === 'pumpkin' && !r6.shot.active && r6.shot.pressure === 1 && r6.shot.pumpkins === 1, r6.shot);
  check(`a pumpkin hit on the player never ends the chase (${r6.hit.hits} hits: still chasing, no fade, no menu; Flow ${r6.hit.flow0} → ${r6.hit.flow}; pressure never below 0)`, r6.hit.hits === 6 && r6.hit.stage === 'chase' && ['chaseStraight', 'chaseRightTurn'].includes(r6.hit.state) && r6.hit.fade === 0 && !r6.hit.menu && !r6.hit.paused && r6.hit.running && r6.hit.flow < r6.hit.flow0 && r6.hit.minP >= 0 && r6.hit.lows.at(-1) === 0, r6.hit);
  check('a blast costs 40 % of horizontal speed, pushes 3 m/s away, never downward', Math.abs(r6.vel[0] - 6) < 0.01 && Math.abs(r6.vel[1] + 3) < 0.01 && Math.abs(r6.vel[2] - 3) < 0.01, r6.vel);

  // ---- Light Bomb and Fan Web (World Chase's, in the Story)
  const r7 = await ev(() => { const X = window.__x, { c, C, a } = X;
    X.quiet(); C.stumble.cancel(); X.behind(22); X.step(20); C._refresh();
    const p0 = C.stumble.pressure; X.bomb(C.bossPos.clone()); X.step(1); const thrown = { n: C.lightBombs.stats.thrown, ready: C.lightBombReady, locked: null };
    X.render(); X.step(2); thrown.locked = a.hub.ctx.bombLocked; let k = 0; while (C.lightBombs.active.length && k < 200) { X.behind(22); X.step(1); k++; }
    X.render();
    const lb = { pressure: C.stumble.pressure - p0, hitsBoss: C.lightBombs.stats.hitsBoss, frames: k, pick: C.lightBombs.lastPick };
    // cooldown: a second throw right away fizzles
    X.bomb(C.bossPos.clone()); X.step(1); const second = C.lightBombs.stats.thrown;
    // Fan Web against a spread of three
    C.stumble.cancel(); X.behind(26); X.step(5);
    C._onAttack({ type: 'telegraph', attack: 'spread' }, X.chest()); X.step(2); C._onAttack({ type: 'release', attack: 'spread' }, X.chest());
    X.step(25); const flying = X.flying().length, pk0 = C.stats.pumpkins, pr0 = C.stumble.pressure, fanCtx = a.hub.ctx.fanWeb;
    X.render(); X.fan(); X.step(1); X.render(); X.step(5); X.render();
    return { thrown, lb, second, fan: { flying, left: X.flying().length, pumpkins: C.stats.pumpkins - pk0, pressure: C.stumble.pressure - pr0, fans: C.cstats.fans, fanCtx } }; });
  check('Light Bomb: thrown, homes on him, its blast adds 3 pressure; the cooldown locks the next charge', r7.thrown.n === 1 && r7.thrown.locked === true && r7.lb.pressure === 3 && r7.lb.hitsBoss === 1 && r7.second === 1, { ...r7.thrown, ...r7.lb, second: r7.second });
  check(`Fan Web clears a spread of three (${r7.fan.flying} flying → ${r7.fan.left}; pressure + ${r7.fan.pressure})`, r7.fan.fanCtx === true && r7.fan.flying === 3 && r7.fan.left === 0 && r7.fan.pumpkins === 3 && r7.fan.pressure === 3 && r7.fan.fans === 1, r7.fan);

  // ---- tiers: his own throws; the heavy pumpkin countered inside its window stalls him at once
  const r8 = await ev(() => { const X = window.__x, { c, C, a } = X;
    C.stumble.cancel(); C.bombs.clear();
    // (a) his scheduler at this tier, the player 26 m behind, for 20 s of game time
    X.quiet(false); const kinds = [], t0 = C.attacks.stats.single + C.attacks.stats.spread + C.attacks.stats.heavy; let minDist = 1e9;
    const tierNow = C.stumble.tier(c._host().segmentTier());
    for (let i = 0; i < 20 * 60; i++) { if (i % 6 === 0) X.behind(26, 3); X.step(1); if (C.attacks.state === 'telegraph' && kinds.at(-1) !== C.attacks.attack + C.attacks.stats.cancelled) kinds.push(C.attacks.attack + C.attacks.stats.cancelled); for (const it of X.flying()) if (it.t < 0.02) minDist = Math.min(minDist, a.boss.root.position.distanceTo(X.chest())); C.stumble.cancel(); }
    const own = { tierNow, throws: C.attacks.stats.single + C.attacks.stats.spread + C.attacks.stats.heavy - t0, stats: { ...C.attacks.stats }, minDist: +minDist.toFixed(1), stage: X.s.stage };
    X.quiet(); C.bombs.clear(); C.stumble.cancel(); X.step(30);
    // (b) the heavy pumpkin: destroyed right after the release → he stalls at once (impact time 'counter')
    X.behind(26); X.step(5);
    C._onAttack({ type: 'telegraph', attack: 'heavy' }, X.chest()); X.step(3); X.render(); C._onAttack({ type: 'release', attack: 'heavy' }, X.chest());
    X.step(18); const giant = X.flying().find((it) => it.kind === 'giant'); X.render();
    const before = { giant: !!giant, hl: giant?.hl, state: C.stumble.state, since: giant ? +(C.clock - giant.launchT).toFixed(2) : null, toJet: giant ? +giant.pos.distanceTo(a.boss.root.position).toFixed(1) : null };
    a.hub.aim.right.origin.copy(X.chest()); a.hub.aim.right.dir.copy(giant.pos.clone().sub(X.chest()).normalize()); a.hub.aim.right.valid = true;
    X.web(giant.pos.clone()); X.step(1); X.render();
    const after = { state: C.stumble.state, counters: C.cstats.counters, warp: a.timeWarp.scale, giantActive: giant.active };
    C.stumble.cancel(); X.step(60);
    return { own, before, after }; });
  check(`his own throws follow the tier and the fairness rules (tier ${r8.own.tierNow}: ${JSON.stringify(r8.own.stats)}; never inside 14 m: closest release ${r8.own.minDist} m)`, r8.own.throws >= 2 && r8.own.minDist >= 14 && r8.own.stage === 'chase' && (r8.own.tierNow >= 3 || r8.own.stats.heavy === 0), r8.own);
  check('a heavy pumpkin destroyed inside its counter window stalls him at once (impact time)', r8.before.giant && r8.before.hl === 2 && r8.before.state === 'chasing' && r8.after.state === 'stalled' && r8.after.counters === 1 && r8.after.warp < 1 && !r8.after.giantActive, { ...r8.before, ...r8.after });

  // ---- pause freezes the loop; a respawn mid fly-in cancels everything
  const r9 = await ev(() => { const X = window.__x, { c, C, a, s, loco } = X;
    X.quiet(); X.stall(); X.step(1);
    s.pause(); const t0 = C.clock, left0 = C.stumble.stallLeft; X.step(120); const paused = { clock: C.clock === t0, left: C.stumble.stallLeft === left0, state: C.stumble.state }; s.resume();
    X.stall(); X.step(1); X.behind(12); X.step(8); X.pumpkin(); X.step(5); loco.cling = null; X.webBoss(); X.step(3);
    const mid = { lunging: C.lunging, scripted: loco.scripted, flying: X.flying().length };
    const flow0 = (() => { for (let i = 0; i < 6; i++) C.flow.gain('pumpkin'); return C.flow.level; })();
    c.respawn(); X.step(1);
    const now = { lunging: C.lunging, scripted: loco.scripted, state: C.stumble.state, pressure: C.stumble.pressure, alive: C.bombs.items.filter((it) => it.active).length, jetWeb: !!C.jetWeb, flow0, flow: C.flow.level };
    X.step(90); // the fade to the checkpoint and back
    return { paused, mid, now, end: { stage: s.stage, state: c.state, fade: +s.fade.a.toFixed(2), scripted: loco.scripted, running: C.running } }; });
  check('paused: the loop does not advance (clock and stall time frozen)', r9.paused.clock && r9.paused.left && r9.paused.state === 'stalled', r9.paused);
  check('respawn mid fly-in: the fly-in ends, the rig is free, no pumpkin survives, pressure 0, one Flow level lost', r9.mid.lunging && r9.mid.scripted && !r9.now.lunging && !r9.now.scripted && r9.now.state === 'chasing' && r9.now.pressure === 0 && r9.now.alive === 0 && !r9.now.jetWeb && r9.now.flow === r9.now.flow0 - 1 && r9.end.stage === 'chase' && !r9.end.scripted, { ...r9.now, ...r9.end });

  // ---- no shader compile during the chase so far (everything above was drawn at least once)
  const r10 = await ev(() => { const X = window.__x, { a } = X; X.step(5); X.render();
    // which programs are new, and what uses them (for the report when this fails)
    const fresh = a.renderer.info.programs.filter((g) => !window.__p0.has(g.cacheKey)), users = [];
    a.scene.traverse((o) => { for (const m of [].concat(o.material || [])) { const pr = a.renderer.properties.get(m); if (pr?.currentProgram && fresh.includes(pr.currentProgram)) { let path = [], q = o; while (q && path.length < 5) { path.push(q.name || q.type); q = q.parent; } users.push(`${m.type}${m.name ? ':' + m.name : ''} on ${path.join(' < ')}`); } } });
    return { p: X.progs(), fresh: fresh.map((g) => g.name), users: [...new Set(users)].slice(0, 6) }; });
  check(`no shader compile during the chase (programs ${P0} at its start → ${r10.p} after every effect above was drawn)`, r10.p === P0, { start: P0, now: r10.p, fresh: r10.fresh, users: r10.users });

  // ---- the dev switch off mid-run stops the loop cleanly; on again restarts it
  const r11 = await ev(() => { const X = window.__x, { c, C, a, loco } = X;
    X.stall(); X.step(1); X.behind(12); X.step(8); X.pumpkin(); loco.cling = null; X.webBoss(); X.step(3);
    X.settings.storyCombat = false; X.step(2);
    const off = { active: C.active, lunging: C.lunging, scripted: loco.scripted, bank: X.audio.useBank, hud: !!a.hud.story, alive: C.bombs.items.filter((it) => it.active).length, warp: a.timeWarp.scale, fighting: c._fighting };
    X.settings.storyCombat = true; X.step(2);
    return { off, on: { active: C.active, running: C.running, state: C.stumble.state } }; });
  check('switch off mid-run: the loop stops (rig free, no pumpkins, synthesized sound, no HUD panel, time scale 1); on again: it restarts', !r11.off.active && !r11.off.lunging && !r11.off.scripted && r11.off.bank === false && !r11.off.hud && r11.off.alive === 0 && r11.off.warp === 1 && r11.on.active && r11.on.running && r11.on.state === 'chasing', r11);

  // ---- the roof: a stall in progress is cancelled; the v0.21 standoff, dash and kick still reach the roof event
  const r12 = await ev(() => { const X = window.__x, { c, C, a, s, loco, L, T } = X;
    X.quiet();
    let sp = Math.max(c.maxS, 60); const tiers = {};
    while (sp < L.STORY_ROUTE.length - 6) { X.at(sp); X.step(4); sp += 1.6; tiers[c.state] = c._host().segmentTier(); }
    // keep a stall alive until he reaches the roof (the standoff must cancel it)
    let before = null;
    for (let i = 0; i < 1500 && c.state !== 'roofStandoff'; i++) { if (C.stumble.state !== 'stalled') X.stall(); before = { state: c.state, stumble: C.stumble.state, running: C.running }; X.step(1); }
    const pre = { ...before, tiers };
    X.step(5);
    const roof = { maniac: a.boss.maniac.state, jetDamage: X.jetDamage, state: c.state, stumble: C.stumble.state, pressure: C.stumble.pressure, running: C.running, alive: C.bombs.items.filter((it) => it.active).length, hud: !!a.hud.story, cap: c._cap, ring: c.ringKind };
    // web at Green Maniac → dash → contact → kick → roof event (the tail of chase.e2e.mjs, the switch on)
    const C2 = L.KEY_BUILDINGS[1], CC = L.CITY.colliderOf('C'), cp = L.STORY.circle.pos;
    loco.cling = null; loco.detach(true); loco.placeAt(new T.Vector3(cp[0] + 0.3, C2.h, cp[2] - 0.2), null); loco._landRoof(CC); X.step(60);
    const org = loco.feet().add(new T.Vector3(0, 1.3, 0)), tgt = c.bossBody(new T.Vector3());
    c._handleWebs({ events: [{ type: 'web', hand: 'right', origin: org, dir: tgt.clone().sub(org).normalize() }] }, loco);
    const dash = { state: c.state, flow: s.flowState };
    for (let i = 0; i < 240 && s.stage === 'chase'; i++) X.step(1);
    return { pre, roof, dash, final: { stage: s.stage, flow: s.flowState, kicks: c.cstats.kicks, roofFired: s.flow.roofFired, riding: a.boss.riding, combatActive: C.active, strikes: C.cstats.strikes } }; });
  check('route tiers: tier 1 → 2 on the third tile → 3 after the turn', r12.pre.tiers.chaseStraight === 2 && r12.pre.tiers.approachPlatform === 3, r12.pre.tiers);
  check('he reaches the roof during a stall: the stall is cancelled, pressure cleared, nothing of the loop is left', r12.pre.stumble === 'stalled' && r12.roof.state === 'roofStandoff' && r12.roof.stumble === 'chasing' && r12.roof.pressure === 0 && !r12.roof.running && r12.roof.alive === 0 && !r12.roof.hud && r12.roof.cap == null, r12.roof);
  check('the roof finale gets him as v0.46 had him: riding, the jet without stall smoke', r12.roof.maniac !== 'hurt' && r12.roof.jetDamage === 0, { maniac: r12.roof.maniac, jetDamage: r12.roof.jetDamage });
  check('the roof dash and kick still reach the roof event (web on him → RoofWebDash → kick → roofEvent)', r12.dash.state === 'roofDash' && r12.dash.flow === 'RoofWebDash' && r12.final.stage === 'roofEvent' && r12.final.kicks === 1 && r12.final.roofFired === true && r12.final.combatActive === false, { ...r12.dash, ...r12.final });
  check('chase group: no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await p.close();
}

// ============================================================================================ the chase after the factory
if (GROUPS.includes('endless')) {
  console.log('---- endless: the chase after the factory (settings.storyCombat = true)');
  const { p, errors } = await openStory({ combat: true });
  const ev = (f, arg) => p.evaluate(f, arg);
  const r = await ev(async () => { const X = window.__x, { a, s, C, E, loco, T } = X, w = a.cityWorld;
    // some run totals from "the first chase", then straight to the chase after the factory (the Story's own dev skip: 'escape' outside the factory → 'endless')
    C.totals.punches = 2; C.totals.pumpkins = 5; C.totals.style = 1200; C.totals.peakFlow = 1;
    s.enterStage('escape'); X.step(30);
    const start = { stage: s.stage, state: E.state, mode: w.mode, combat: C.active, boss: a.boss.root.visible };
    /** The player on the endless route at arc length sv (held). */
    const at = (sv, dy = 0) => { const pd = w.route.pending; if (pd && w.curTile >= pd.idx - 1) w.choose((pd.allowed || pd.exits)[0]); const q = w.pointAt(sv); q.y += dy; X.hold(q); };
    const behind = (gap) => { const q = w.pointAt(E.bossS - gap); q.y = a.boss.root.position.y - 3; X.hold(q); };
    let sp = E.playerS; at(sp + 14); X.step(5); sp += 14;
    const lead0 = { shield: a.hub.ctx.shield, state: E.state, combat: C.active, running: C.running, kind: C.kind, tier: C.stumble.tier(E._host().segmentTier()), hud: !!a.hud.story, bank: X.audio.useBank };
    // lead with combat: web strikes to a stall, the red ring, the fly-in punch → tier 3
    X.quiet(); let n = 0; behind(24); X.step(10);
    while (C.stumble.state === 'chasing' && n < 20) { X.step(37); behind(24); X.webBoss(); X.step(1); n++; }
    const stalled = { state: C.stumble.state, strikes: C.cstats.strikes };
    behind(12); X.step(8); const ring = { kind: E.ringKind, ringOn: C.ringOn };
    loco.cling = null; X.webBoss(); X.step(1); let k = 0; while (C.lunging && k < 150) { X.step(1); k++; } X.step(4);
    const punch = { punches: C.stumble.punches, state: C.stumble.state, tier: C.stumble.tier(E._host().segmentTier()), scripted: loco.scripted, total: C.stats.punches };
    // his throws in the lead (tier 3 now): let the scheduler run for a while
    X.quiet(false); const thr0 = C.bombs.stats.thrown; for (let i = 0; i < 12 * 60; i++) { if (i % 6 === 0) behind(26); X.step(1); C.stumble.cancel(); }
    const throws = { thrown: C.bombs.stats.thrown - thr0, stats: { ...C.attacks.stats }, stage: s.stage, state: E.state };
    X.quiet(); C.bombs.clear();
    // fly the lead distance; a stall when the lead distance is done → the escape waits for it
    sp = Math.max(sp, E.playerS); const tiles0 = w.curTile; let guard = 0;
    while (w.curTile < E.startTile + 6 && guard++ < 60 * 90) { sp += 0.5; at(sp); X.step(1); if (w.curTile === E.startTile + 5 && C.stumble.state === 'chasing') X.stall(); if (C.stumble.state === 'stalled' && w.curTile === E.startTile + 5) { /* keep the stall alive until the lead distance is done */ C.stumble._t = 0; } }
    const atEnd = { tile: w.curTile - E.startTile, state: E.state, stumble: C.stumble.state, combat: C.active };
    X.step(2); const waits = { state: E.state, stumble: C.stumble.state };
    let g2 = 0; while (E.state === 'lead' && g2++ < 60 * 8) { at(sp); X.step(1); }
    const esc = { state: E.state, combat: C.active, running: C.running, alive: C.bombs.items.filter((it) => it.active).length, hud: !!a.hud.story, banner: a.hud.banner.text, waited: g2 };
    // escape: he climbs away and is gone; a web at him now is only a swing web (no strike, no stall)
    const st0 = C.cstats.strikes; X.webBoss(); X.step(1); const noStrike = C.cstats.strikes === st0 && C.stumble.state === 'chasing';
    let g3 = 0; while (E.state === 'escape' && g3++ < 60 * 8) { at(sp); X.step(1); }
    X.render();
    const free = { state: E.state, boss: a.boss.root.visible, summary: a.hud.summary && { style: a.hud.summary.style, punches: a.hud.summary.punches, pumpkins: a.hud.summary.pumpkins, peakFlow: a.hud.summary.peakFlow }, panel: a.hud.sumP.visible, interactive: a.hud.sumP.interactive, allowLoco: s.allowLocomotion, menu: a.menus.open, combat: C.active, stats: C.stats };
    // free swinging: movement is not blocked while the summary shows; a web only swings
    at(sp + 3); X.step(2); const moved = +loco.feet().distanceTo(w.pointAt(sp + 3)).toFixed(1) < 3;
    const st1 = C.cstats.strikes; X.webBoss(); X.step(1); const webFree = { strikes: C.cstats.strikes - st1, lunging: C.lunging };
    await new Promise((r2) => setTimeout(r2, 5600)); X.step(2); // the summary's own 5 s (HUD time is real time)
    const gone = { summary: !!a.hud.summary, panel: a.hud.sumP.visible, state: E.state };
    return { start, lead0, stalled, ring, punch, throws, atEnd, waits, esc, noStrike, free, moved, webFree, gone, tiles0 }; });
  check('after the factory: endless starts (wait → lead) and the lead runs the combat loop from tier 2', r.start.stage === 'endless' && r.lead0.state === 'lead' && r.lead0.combat && r.lead0.running && r.lead0.kind === 'endless' && r.lead0.tier === 2 && r.lead0.hud, { ...r.start, ...r.lead0 });
  check('the palm shield is available in the lead (his spreads and heavy pumpkins are thrown there)', r.lead0.shield === true, { shield: r.lead0.shield });
  check('lead with combat: web strikes stall him, the red ring shows, the fly-in punches → tier 3', r.stalled.state === 'stalled' && r.ring.kind === 'red' && r.punch.punches === 1 && r.punch.state === 'lockout' && r.punch.tier === 3 && !r.punch.scripted && r.punch.total === 3, { ...r.stalled, ...r.ring, ...r.punch });
  check(`lead: he throws (${r.throws.thrown} pumpkins in 12 s, ${JSON.stringify(r.throws.stats)}) and the chase goes on`, r.throws.thrown >= 1 && r.throws.stage === 'endless' && r.throws.state === 'lead', r.throws);
  check('the lead distance ends during a stall: the escape waits until the stall is over', r.atEnd.tile >= 6 && r.waits.state === 'lead' && r.waits.stumble === 'stalled' && r.esc.state === 'escape' && r.esc.waited > 30, { ...r.atEnd, waits: r.waits, waited: r.esc.waited });
  check('escape: the loop is over (no stall, no pumpkins, no HUD panel) and a web at him does nothing', r.esc.state === 'escape' && !r.esc.combat && !r.esc.running && r.esc.alive === 0 && !r.esc.hud && r.noStrike, r.esc);
  check(`summary as free swinging starts: style ${r.free.summary?.style}, punches ${r.free.summary?.punches}, pumpkins ${r.free.summary?.pumpkins}, peak Flow ${r.free.summary?.peakFlow} (the whole Story run)`, r.free.state === 'free' && !r.free.boss && r.free.panel && r.free.summary && r.free.summary.punches === 3 && r.free.summary.pumpkins >= 5 && r.free.summary.style > 1200 && r.free.summary.peakFlow >= 1, r.free);
  check('the summary does not block movement and nothing is interactive; free swinging has no combat', r.free.interactive === false && r.free.allowLoco && !r.free.menu && r.moved && !r.free.combat && r.webFree.strikes === 0 && !r.webFree.lunging, { moved: r.moved, ...r.webFree });
  check('the summary hides itself after 5 s', !r.gone.summary && !r.gone.panel && r.gone.state === 'free', r.gone);
  check('endless group: no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await p.close();
}

// ================================================================================================= the switch off = v0.46
if (GROUPS.includes('off')) {
  console.log('---- off (settings.storyCombat = false): the v0.46 Story');
  const { p, errors } = await openStory({ combat: false });
  const ev = (f, arg) => p.evaluate(f, arg);
  const r = await ev(() => { const X = window.__x, { a, s, c, C, E, loco, T } = X;
    X.step(30);
    const base = { active: C.active, running: C.running, bank: X.audio.useBank, useStory: X.audio.useStory, hud: !!a.hud.story, storyP: a.hud.storyP.visible, fighting: c._fighting, fanCtx: a.hub.ctx.fanWeb, bombLocked: a.hub.ctx.bombLocked, pools: !!C.bombs };
    // the v0.21 jet tether + counter run: a web on the jet sticks, then he blows it off
    let sp = 60; while (sp < 120) { X.at(sp); X.step(4); sp += 1.6; }
    const q = c.jetAnchor.p.clone(); q.y -= 6; q.z += 16; X.hold(q); X.step(2); loco.cling = null;
    const org = X.chest(), dir = c.jetAnchor.p.clone().sub(org).normalize();
    c._handleWebs({ events: [{ type: 'web', hand: 'right', origin: org, dir }] }, loco);
    const stuck = { tether: c.tether?.phase, tethers: c.cstats.tethers, flow: s.flowState, banner: a.hud.banner.text };
    let warpMin = 1; for (let i = 0; i < 120; i++) { X.step(1); warpMin = Math.min(warpMin, a.timeWarp.scale); }
    const cut = { counters: c.cstats.counters, tether: !!c.tether, rope: X.jetRope() };
    // the v0.21 pumpkin shot: bombs.tryShoot destroys a flying pumpkin (the old pool, not the combat's)
    const it = c.bombs._get(); a.boss.throwPoint(it.pos); c.bombs._launch(it, X.chest(), loco.vel); X.step(15);
    const o2 = X.chest(); c._handleWebs({ events: [{ type: 'web', hand: 'right', origin: o2, dir: it.pos.clone().sub(o2).normalize() }] }, loco);
    const shot = { destroyed: c.bombs.stats.destroyed, active: it.active };
    // a web straight at him is NOT a strike: no pressure anywhere
    X.at(c.bossS - 20); X.step(10); X.webBoss(); X.step(1);
    const calm = { pressure: C.stumble.pressure, strikes: C.cstats.strikes, lunging: C.lunging };
    // pacing is the v0.46 table: no 14 m floor (a fast player closes in under 14 m)
    let sv = c.bossS - 20, minGap = 1e9; for (let i = 0; i < 180; i++) { sv += 24 / 60; X.at(sv); X.step(1); minGap = Math.min(minGap, X.gap()); }
    return { base, stuck, cut, shot, calm, warpMin, minGap: +minGap.toFixed(1), stage: s.stage }; });
  check('switch off: the combat loop is idle (not active, no HUD panel, synthesized sound only, no Fan Web / Light Bomb lock in the chase)', !r.base.active && !r.base.running && r.base.bank === false && r.base.useStory === false && !r.base.hud && !r.base.storyP && !r.base.fighting && r.base.fanCtx === false && r.base.bombLocked === false, r.base);
  check('switch off: the old jet tether and counter run (web sticks → JetTether → he blows it off)', r.stuck.tether === 'stuck' && r.stuck.tethers === 1 && r.stuck.flow === 'JetTether' && r.cut.counters === 1 && !r.cut.rope, { ...r.stuck, ...r.cut });
  check('switch off: bombs.tryShoot destroys a flying pumpkin (the v0.21 pool)', r.shot.destroyed === 1 && !r.shot.active, r.shot);
  check('switch off: no web strike, no pressure, no fly-in, no impact time; the pacing has no 14 m floor', r.calm.pressure === 0 && r.calm.strikes === 0 && !r.calm.lunging && r.warpMin === 1 && r.minGap < 13, { ...r.calm, warpMin: r.warpMin, minGap: r.minGap });
  // the chase after the factory with the switch off: lead has no combat, no summary
  const r2 = await ev(() => { const X = window.__x, { a, s, C, E } = X, w = a.cityWorld;
    s.enterStage('escape'); X.step(30);
    const at = (sv) => { const pd = w.route.pending; if (pd && w.curTile >= pd.idx - 1) w.choose((pd.allowed || pd.exits)[0]); X.hold(w.pointAt(sv)); };
    let sp = E.playerS + 14; at(sp); X.step(5);
    const lead = { state: E.state, combat: C.active, hud: !!a.hud.story, shield: a.hub.ctx.shield };
    let guard = 0; const phases = [E.state]; while (E.state !== 'free' && guard++ < 60 * 120) { sp += 0.5; at(sp); X.step(1); if (phases.at(-1) !== E.state) phases.push(E.state); }
    return { lead, phases, summary: !!a.hud.summary, combat: C.active, thrown: C.bombs ? C.bombs.stats.thrown : 0 }; });
  check('switch off: the chase after the factory is the v0.46 one (lead → escape → free, no combat, no summary)', r2.lead.state === 'lead' && !r2.lead.combat && !r2.lead.hud && !r2.lead.shield && r2.phases.join('>') === 'lead>escape>free' && !r2.summary && !r2.combat && r2.thrown === 0, r2);
  check('off group: no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await p.close();
}

await browser.close();
console.log(`${fails ? 'FAIL' : 'PASS'} storycombat.e2e — ${passes} passed, ${fails} failed (groups: ${GROUPS.join(', ')})`);
process.exit(fails ? 1 : 0);
