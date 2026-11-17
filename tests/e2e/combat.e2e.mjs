// v0.21 story chase combat + roof finale e2e (real app, deterministic stepping). Needs the dev server.
// Usage: CHROME=… node tests/e2e/combat.e2e.mjs
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required', '--ignore-certificate-errors'] });
const p = await b.newPage({ viewport: { width: 320, height: 180 }, ignoreHTTPSErrors: true });
const errors = []; p.on('pageerror', (e) => errors.push(e.message));
await p.goto(process.env.URL || 'https://localhost:8443/', { waitUntil: 'load' });
await p.waitForTimeout(7000);
await p.selectOption('#lang', process.env.LANG_UI || 'zh-Hant');
await p.click('#enter-desktop', { force: true }).catch(() => p.click('#enter', { force: true }));
await p.waitForTimeout(800);
const r = await p.evaluate(async () => {
  const a = window.__mobius, s = a.story, T = window.__THREE, loco = a.locomotion;
  const L = await import('/src/data/layout.js');
  (await import('/src/core/settings.js')).settings.storyCombat = false; // v0.47: these checks pin the v0.46 Story chase; the Story chase combat has its own checks in storycombat.e2e.mjs
  const { STORY_COMBAT: SC } = await import('/src/data/storyCombat.js');
  const { routePoint, routeHeight } = await import('/src/game/chase.js');
  const frame = a.frame.bind(a); a.frame = () => {};
  const out = {}; const ok = (k, v) => { out[k] = v; };
  const step = (n = 1, each) => { for (let i = 0; i < n; i++) { a.hub.events.length = 0; frame(1 / 60, 0, null); each?.(i); } };
  const until = async (cond, maxFrames = 2000, realWait = false) => { for (let i = 0; i < maxFrames && !cond(); i++) { step(1); if (realWait && i % 10 === 0) await new Promise((r2) => setTimeout(r2, 15)); } return cond(); };
  const chest = () => loco.feet().add(new T.Vector3(0, 1.3, 0));
  const fire = (target, origin = chest()) => c._handleWebs({ events: [{ type: 'web', hand: 'right', origin, dir: target.clone().sub(origin).normalize() }] }, loco);
  const hold = (pos) => { loco.detach(true); loco.placeAt(pos, null); loco.grounded = false; loco.cling = { building: 'X', normal: new T.Vector3(1, 0, 0) }; };
  const at = (sv, y) => { const q = routePoint(sv); q.y = y ?? routeHeight(sv); return q; };
  let c;
  try {
    // ---- window → chase (flyby) → out of the room
    a.go('story'); s.suited = true; a.setArmored(true); s.enterStage('window'); step(5);
    { const o = L.ROOM.origin; loco.placeAt(new T.Vector3(o[0], o[1], o[2] - 2.4), 0); step(10); }
    a.hub.desk.keys.add('KeyG'); step(50); a.hub.desk.keys.delete('KeyG'); step(1);
    c = s.chaseCtl; const B = c.bombs;
    step(60 * 5.2); s.inRoom = false; loco.ignoreColliders = new Set();
    ok('A_chase', { stage: s.stage, state: c.state, flow: s.flowState });

    // ---- 1. bombs: wind-up tell, thrown, can be shot, can hit; paused near the turn
    let sp = 30, windupFrames = 0, shot = 0;
    hold(at(sp));
    for (let i = 0; i < 60 * 40 && (B.stats.thrown < 4 || !shot); i++) {
      if (i % 20 === 0 && sp < 300) { sp += 6; hold(at(sp)); } // creep along (Green Maniac keeps his lead)
      step(1); if (B.windup) windupFrames++;
      const f = B.flying[0];
      if (f && B.stats.thrown >= 2 && !shot && f.t > 0.3) { fire(f.pos); shot = B.stats.destroyed; }
    }
    ok('B1_bombs', { ...B.stats, windupFrames, maxActiveCfg: SC.bombs.maxActive, alive: B.activeCount, hint: c._bombHint });
    { const t0 = B.stats.thrown; hold(at(L.ROUTE.sTurn - 15)); c.maxS = Math.max(c.maxS, L.ROUTE.sTurn - 15); step(60 * 8); ok('B2_pausedNearTurn', { newThrows: B.stats.thrown - t0, state: c.state }); }
    hold(at(250)); c.maxS = Math.max(c.maxS, 250); step(60 * 3);

    // ---- 2. tether refused when too far / occluded
    B.clear(); B.timer = 99;
    c.tetherReadyAt = 0; step(1);
    { const hook = c.jetAnchor.p.clone(); const far = hook.clone().add(new T.Vector3(0, -6, 45)); loco.detach(true); loco.cling = null; loco.placeAt(far.clone().setY(far.y - 1.3), null); loco.grounded = false;
      const n0 = c.cstats.tethers; fire(c.jetAnchor.p.clone()); ok('C1_tooFar', { tethered: c.cstats.tethers - n0, refused: c.cstats.tetherRefused, dist: +chest().distanceTo(c.jetAnchor.p).toFixed(1), attachedTo: loco.attach?.anchor.id || null }); }
    { // occluded: the far side of a tall building (range check relaxed for this probe only)
      const hook = c.jetAnchor.p.clone(); const cols = a.cityWorld.collidersNear(hook.x, hook.z, 70).filter((k) => k.y1 > hook.y + 8 && k.base);
      cols.sort((x, y) => Math.hypot(x.x - hook.x, x.z - hook.z) - Math.hypot(y.x - hook.x, y.z - hook.z));
      const k = cols[0], dir = new T.Vector3(k.x - hook.x, 0, k.z - hook.z).normalize();
      const behind = new T.Vector3(k.x, hook.y, k.z).addScaledVector(dir, Math.max(k.hw, k.hd) + 3);
      const md = SC.tether.maxDist; SC.tether.maxDist = 200;
      const chk = c.tetherCheck(behind); SC.tether.maxDist = md;
      ok('C2_occluded', { why: chk.why, building: k.id });
    }

    // ---- 3/4. tether → counter: web cut, chase continues, no teleport / speed spike
    const nearJet = () => { const h = c.jetAnchor.p, fw = routePoint(c.bossS + 6).sub(routePoint(c.bossS)).setY(0).normalize(); return h.clone().addScaledVector(fw, -12).add(new T.Vector3(0, -4.3, 0)); };
    hold(nearJet()); step(2); hold(nearJet()); step(1);
    { loco.cling = null; loco.grounded = false; loco.vel.set(0, 0, -8); c.tetherReadyAt = 0; step(1);
      const d0 = chest().distanceTo(c.jetAnchor.p); fire(c.jetAnchor.p.clone());
      const fs = [s.flowState], speeds = [], jumps = []; let prev = loco.feet(), prevV = loco.vel.clone(), maxDv = 0, cutFrame = -1;
      for (let i = 0; i < 90; i++) {
        step(1); const f = loco.feet(); jumps.push(f.distanceTo(prev)); prev = f; speeds.push(loco.vel.length());
        const dv = loco.vel.clone().sub(prevV).length(); if (cutFrame >= 0 && i - cutFrame <= 10) { out.D_cutWindow = out.D_cutWindow || { maxDv: 0, maxStep: 0 }; out.D_cutWindow.maxDv = Math.max(out.D_cutWindow.maxDv, +dv.toFixed(2)); out.D_cutWindow.maxStep = Math.max(out.D_cutWindow.maxStep, +jumps.at(-1).toFixed(2)); } if (dv > maxDv) { maxDv = dv; out.D_dvAt = { i, flow: s.flowState, before: prevV.toArray().map((x) => +x.toFixed(1)), after: loco.vel.toArray().map((x) => +x.toFixed(1)), attached: loco.attach?.anchor.id || null, cling: !!loco.cling, grounded: loco.grounded }; } prevV = loco.vel.clone();
        if (fs.at(-1) !== s.flowState) { fs.push(s.flowState); if (s.flowState === 'TetherCounter') cutFrame = i; }
      }
      ok('D1_tether', { distAtFire: +d0.toFixed(1), flowSeq: fs, tethers: c.cstats.tethers, counters: c.cstats.counters, attached: loco.attach?.anchor.id || null, stage: s.stage, chaseState: c.state, cutFrame });
      ok('D2_noJump', { maxStep_m: +Math.max(...jumps).toFixed(2), maxSpeed: +Math.max(...speeds).toFixed(1), maxDvPerFrame: +maxDv.toFixed(2), velBefore: c.tether?.velBefore?.length().toFixed?.(1) ?? null });
      // cooldown: an immediate second web at the jet does not tether
      const n1 = c.cstats.tethers; hold(nearJet()); loco.cling = null; fire(c.jetAnchor.p.clone()); ok('D3_cooldown', { newTethers: c.cstats.tethers - n1, readyIn: +(c.tetherReadyAt - c.clock).toFixed(2) });
      step(2); loco.detach(true);
    }

    // ---- 5. to the factory: Green Maniac stops over the blue circle
    { let s2 = Math.max(300, c.maxS); while (s2 < L.ROUTE.length - 6) { hold(at(s2)); step(4); s2 += 1.6; } }
    await until(() => c.state === 'roofStandoff', 60 * 20);
    const C = L.KEY_BUILDINGS[1], cp = L.STORY.circle.pos, CC = a.cityWorld.colliderOf('C');
    { const hv = c.hoverPoint(c.clock); const bp = a.boss.root.position;
      ok('E_standoff', { state: c.state, flow: s.flowState, bossToHover: +bp.distanceTo(hv).toFixed(2), overCircle: +Math.hypot(bp.x - cp[0], bp.z - cp[2]).toFixed(2), aboveRoof: +(bp.y - C.h).toFixed(2), objective: s.currentObjective, newBombsAllowed: B.windup !== null }); }
    // 6. roof stage: a web on the JET does not tether / counter any more
    { const n = c.cstats.tethers, to = SC.roof.dashTimeout; SC.roof.dashTimeout = 0.1; loco.cling = null; loco.placeAt(new T.Vector3(cp[0] + 6, C.h, cp[2]), null); loco._landRoof(CC); step(5); fire(c.jetAnchor.p.clone().add(new T.Vector3(0, -0.6, 0)));
      const st = c.state; step(20); SC.roof.dashTimeout = to; c.dashReadyAt = 0;
      ok('F_noCounterOnRoof', { newTethers: c.cstats.tethers - n, counters: c.cstats.counters, startedDash: st, state: c.state, stage: s.stage }); }
    // 7. standing in the circle does nothing
    if (s.stage === 'chase') { loco.placeAt(new T.Vector3(cp[0], C.h, cp[2]), null); loco._landRoof(CC); step(180); ok('G_circleNoBlast', { state: c.state, stage: s.stage, roofFired: s.flow.roofFired, roof: a.city.factory.state }); }

    // ---- 8/11. dash that cannot reach him (timeout) → safe abort, retry allowed, NO kick / blast
    if (s.stage === 'chase') {
      const to = SC.roof.dashTimeout; SC.roof.dashTimeout = 0.15;
      fire(c.bossBody(new T.Vector3())); const st = c.state;
      step(30); SC.roof.dashTimeout = to;
      ok('H_abort', { started: st, after: c.state, aborts: c.cstats.dashAborts, kicks: c.cstats.kicks, roofFired: s.flow.roofFired, scripted: loco.scripted, locoMode: loco.mode, why: c.lastAbort });
      { const behind = new T.Vector3(cp[0], C.h + 5, cp[2]); const cols = a.cityWorld.collidersNear(cp[0], cp[2], 90).filter((k) => k.id !== 'C' && k.y1 > C.h + 12 && k.base);
        const k = cols[0], dir = new T.Vector3(k.x - cp[0], 0, k.z - cp[2]).normalize(); behind.set(k.x, C.h + 8, k.z).addScaledVector(dir, Math.max(k.hw, k.hd) + 2);
        c.dashReadyAt = 0; const dr = SC.roof.dashRange; SC.roof.dashRange = 300; ok('H2_dashOccluded', { why: c.dashCheck(behind).why }); SC.roof.dashRange = dr; }
    }
    // ---- 9. very fast dash (one frame ≫ contact radius) still registers the contact (swept)
    if (s.stage === 'chase') {
      loco.placeAt(new T.Vector3(cp[0] + 5, C.h, cp[2] + 2), null); loco._landRoof(CC); step(60);
      const sv = SC.roof.dashSpeed, sa = SC.roof.dashAccel; SC.roof.dashSpeed = 600; SC.roof.dashAccel = 1e6;
      const tgt = c.bossBody(new T.Vector3()); fire(tgt);
      let frames = 0; for (; frames < 30 && s.stage === 'chase'; frames++) step(1);
      SC.roof.dashSpeed = sv; SC.roof.dashAccel = sa;
      ok('I_fastKick', { frames, stage: s.stage, flow: s.flowState, kicks: c.cstats.kicks, contactToBody: +(c.kickInfo ? c.kickInfo.point.distanceTo(tgt) : -1).toFixed(2), stepPerFrame_m: +(600 / 60).toFixed(1) });
    }
    // ---- 10. the roof event runs ONCE: kick-off, landing, giant bomb, blast, fall → loading
    const f = s.flow;
    { const seq = [f.state]; let maniacOnRoof = false, giantSeen = false, jetMoved = 0; const j0 = a.boss.root.position.clone();
      for (let i = 0; i < 60 * 18 && s.stage === 'roofEvent'; i++) { step(1); if (seq.at(-1) !== f.state) seq.push(f.state); if (!a.boss.riding && Math.abs(a.boss.maniac.root.position.y - C.h) < 0.05) maniacOnRoof = true; if (f.giant?.root.visible) giantSeen = true; jetMoved = Math.max(jetMoved, a.boss.root.position.distanceTo(j0)); if (f.state === 'BossBombThrow' && (f.phase === 'aim' || f.phase === 'draw') && f.phaseT < 0.05) { ok('J0_landed', { feetY: +loco.feet().y.toFixed(2), onCircle: +Math.hypot(loco.feet().x - cp[0], loco.feet().z - cp[2]).toFixed(2), maniacToPlayer: +a.boss.maniac.root.position.distanceTo(loco.feet()).toFixed(2), riding: a.boss.riding }); } }
      ok('J_roofEvent', { seq, maniacOnRoof, giantSeen, jetMoved: +jetMoved.toFixed(1), explosions: f.explosions, giantThrows: f.giantThrows, stage: s.stage, roof: a.city.factory.state });
      ok('J2_repeat', { start: f.startRoofEvent({ point: new T.Vector3(), vel: new T.Vector3() }), complete: (s.onChaseComplete({ point: new T.Vector3(), vel: new T.Vector3() }), s.stage), explosions: f.explosions, kicks: c.cstats.kicks });
    }
    await until(() => a.worldName === 'factory' && s.stage === 'factory', 3000, true);
    ok('K_interior', { world: a.worldName, stage: s.stage, riding: a.boss.riding, flow: s.flowState });
    // ---- restart during the roof event → back to the standoff, no leftovers
    a.menuMain?.(); await until(() => a.state === 'modeSelect' && a.loader.state === 'hidden', 3000, true);
    a.go('story'); s.suited = true; a.setArmored(true);
    a.city.setFocus(new T.Vector3(cp[0], C.h, cp[2]));
    s.enterStage('chase'); step(2); s.restartRoofFinale(); step(60 * 4);
    { const n = c.cstats; fire(c.bossBody(new T.Vector3())); for (let i = 0; i < 200 && s.stage === 'chase'; i++) step(1); for (let i = 0; i < 60 * 2.6 && f.state !== 'BossBombThrow'; i++) step(1); step(20);
      ok('L0_beforeRestart', { stage: s.stage, flow: s.flowState, kicks: n.kicks });
      s.pause(); s.restartStage(); step(3 * 60);
      ok('L_restartRoof', { stage: s.stage, state: c.state, flow: s.flowState, roofFired: f.roofFired, roof: a.city.factory.state, riding: a.boss.riding, giant: !!f.giant?.root.visible, bombsAlive: c.bombs.activeCount, tether: !!c.tether, dash: !!c.dash, scripted: loco.scripted, paused: s.paused }); }
  } catch (e) { out.ERROR = `${e.message} ${String(e.stack).split('\n').slice(0, 3).join(' | ')}`; }
  a.frame = frame;
  return out;
});
for (const [k, v] of Object.entries(r)) console.log(k.padEnd(20), JSON.stringify(v));
console.log('errors', errors);
await b.close();
