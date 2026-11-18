// v1.1 chase pumpkins: the flight path preview and the soft tracking, end to end (headless Chromium + SwiftShader; needs
// `npm run dev`). The real app, frames stepped by hand (deterministic, 60 Hz), throws forced through the same code the
// fight uses. Prints PASS / FAIL lines and a draw-call table; exit code 1 on any FAIL. Nothing here says anything about
// a Quest 3.
//   CHROME=/usr/bin/google-chrome URL=https://localhost:8443/ OUT=<dir for pictures> node tests/e2e/bombpath.e2e.mjs
//   ONLY=world,story (default both)   MAP=foldscape (the World Chase map)
//   DRAWCALLS=1: only the draw-call measurement (also runs against a v1.0.0 server, where there is no preview)
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { openStory, CHROME_ARGS, URL, BOOT } from './storyharness.mjs';
const OUT = process.env.OUT || '.', MAP = process.env.MAP || 'foldscape', ONLY = (process.env.ONLY || 'world,story').split(','), DC = !!process.env.DRAWCALLS;
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: CHROME_ARGS });
let fails = 0;
const check = (name, ok, info = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' — ' + (typeof info === 'string' ? info : JSON.stringify(info)) : ''}`); };
const table = [];
const saveSide = async (p, name) => { try { const url = await p.evaluate(() => window.__side()); writeFileSync(`${OUT}/${name}.png`, Buffer.from(url.split(',')[1], 'base64')); } catch (e) { console.log('side picture failed', name, e.message); } };

// helpers installed in the page (both worlds): count paths, record the closest drawn point to the head, render and count draw calls
const HELPERS = () => {
  const a = window.__mobius;
  window.__pf = () => a._bombPathFx || null;
  window.__minD = Infinity;
  const fx = a._bombPathFx;
  if (fx && !fx._wrapped) { const c = fx.commit.bind(fx); fx.commit = (h, t) => { c(h, t); if (fx.count) window.__minD = Math.min(window.__minD, fx.stats.minDist); }; fx._wrapped = true; }
  // a picture from the side (a debug camera beside the line from Green Maniac to the player): the paths read best from there
  window.__side = () => {
    const T = window.__THREE, cam = new T.PerspectiveCamera(55, a.renderer.domElement.width / a.renderer.domElement.height, 0.1, 600);
    const head = a.camera.getWorldPosition(new T.Vector3()), boss = a.boss.root.position.clone(), mid = head.clone().lerp(boss, 0.5), d = boss.clone().sub(head).setY(0).normalize();
    cam.position.copy(mid).add(new T.Vector3(-d.z, 0, d.x).multiplyScalar(Math.max(12, head.distanceTo(boss) * 0.75))).add(new T.Vector3(0, 4, 0)); cam.lookAt(mid);
    a.renderer.render(a.scene, cam); return a.renderer.domElement.toDataURL('image/png');
  };
  window.__calls = () => { a.renderer.info.autoReset = false; a.renderer.info.reset(); a.renderer.render(a.scene, a.camera); const n = a.renderer.info.render.calls; a.renderer.info.autoReset = true; return n; };
};

// =============================================================================================== World Chase
if (ONLY.includes('world')) {
  const p = await b.newPage({ viewport: { width: 800, height: 450 }, ignoreHTTPSErrors: true });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const ev = (fn, arg) => p.evaluate(fn, arg);
  await p.goto(URL, { waitUntil: 'load', timeout: BOOT });
  await p.waitForFunction(() => window.__mobius && !document.getElementById('enter').disabled, null, { timeout: BOOT });
  await ev(() => { const a = window.__mobius; a.audioOff = true; a.pendingMap = null; });
  await ev((id) => { const a = window.__mobius; a.worldChase.bench = null; a.pendingMap = id; a.enterDesktop(); }, MAP);
  await p.waitForFunction((id) => { const a = window.__mobius; return a.state === 'world' && a.worldChase.state && a.worldChase.mapId === id && !a.loader.visible; }, MAP, { timeout: 900000, polling: 500 });
  await ev(() => { window.__mobius.worldChase.stateTime = 99; });
  await p.waitForFunction(() => window.__mobius.worldChase.state === 'chase', null, { timeout: 120000, polling: 250 });
  await ev(() => {
    const a = window.__mobius, T = window.__THREE, hub = a.hub, orig = hub.update.bind(hub), frame = a.frame.bind(a), w = a.worldChase;
    a.frame = () => {}; window.__inj = [];
    hub.update = (f, t) => { orig(f, t); if (window.__aimFn) window.__aimFn(hub, T); for (const e of window.__inj.splice(0)) hub.events.push(e); };
    const X = window.__x = {
      a, w, T, B: w.bombs, F: w.fight,
      step(n = 1, draw = 6) { for (let i = 0; i < n; i++) { hub.events.length = 0; frame(1 / 60, 0, null); if (draw && i % draw === draw - 1) a.renderer.render(a.scene, a.camera); } },
      chest: () => a.locomotion.feet(new T.Vector3()).add(new T.Vector3(0, 1.3, 0)),
      look(pt) { const cam = a.camera, rig = a.world.player, c = cam.getWorldPosition(new T.Vector3()), d = pt.clone().sub(c); hub.desk.yaw = Math.atan2(-d.x, -d.z) - rig.rotation.y; hub.desk.pitch = Math.max(-1.3, Math.min(1.3, Math.atan2(d.y, Math.hypot(d.x, d.z)))); },
      quiet() { w.clock = Math.max(w.clock, 12); w.fight.nextAttackIn = 1e9; w.bombs.clear(); w.held.length = 0; w._tele = null; },
      lead() { w.bossS = w.playerS + 26; },
      flying: () => w.bombs.items.filter((it) => it.active && it.phase === 'fly'),
    };
    window.__aimFn = () => X.look(w.bossPos);
    X.quiet(); X.step(20);
  });
  await ev(HELPERS);
  const hasFx = await ev(() => !!window.__pf());
  // ---- draw calls (v1.0.0 has no preview: the same scene is measured on both builds)
  const dc = await ev(async () => {
    const X = window.__x, S = (await import('/src/core/settings.js')).settings, R = {};
    X.lead(); X.step(10, 0); R.idle = window.__calls();
    X.w.debug.attack('spread'); X.step(50, 0); R.telegraph = window.__calls(); if ('bombPath' in S) { S.bombPath = false; X.step(1, 0); R.telegraphOff = window.__calls(); S.bombPath = true; X.step(1, 0); }
    for (let i = 0; i < 200 && !X.flying().length; i++) X.step(1, 0);
    X.step(15, 0); R.flight = window.__calls(); if ('bombPath' in S) { S.bombPath = false; X.step(1, 0); R.flightOff = window.__calls(); S.bombPath = true; }
    for (let i = 0; i < 400 && (X.flying().length || X.held?.length); i++) X.step(1, 0);
    X.quiet(); X.step(5, 0);
    return R;
  });
  table.push({ world: `World Chase (${MAP})`, ...dc });
  if (!DC && hasFx) {
    const fxProg0 = await ev(() => window.__mobius.renderer.info.programs.length);
    // ---- each attack kind: the path during the telegraph and in flight
    for (const kind of ['single', 'spread', 'heavy']) {
      const r = await ev((kind) => {
        const X = window.__x, w = X.w, fx = window.__pf(), FIGHT_T = { single: 0.95, spread: 1.4, heavy: 2.4 }[kind];
        X.quiet(); X.lead(); for (let i = 0; i < 600 && w.fight.state !== 'protected'; i++) X.step(1, 0);
        X.quiet(); X.step(10, 0); window.__minD = Infinity;
        w.debug.attack(kind);
        const R = { kind };
        for (let i = 0; i < 400 && !(w._tele && w._tele.t >= FIGHT_T * 0.6); i++) X.step(1, 0);
        R.held = w.held.filter((it) => it.active).length; R.tele = { count: fx.count, visible: fx.mesh.visible, alpha: fx.owners.flatMap((o) => o.recs.slice(0, o.count).map((q) => +q.alpha.toFixed(2))) };
        return R;
      }, kind);
      await p.screenshot({ path: `${OUT}/bombpath-world-${kind}-telegraph.png` }).catch(() => {}); await saveSide(p, `bombpath-world-${kind}-telegraph-side`);
      const r2 = await ev((kind) => {
        const X = window.__x, w = X.w, fx = window.__pf(), R = {};
        for (let i = 0; i < 400 && !X.flying().length; i++) X.step(1, 0);
        X.step(12, 0); X.a.renderer.render(X.a.scene, X.a.camera);
        R.flying = X.flying().length; R.count = fx.count; R.tracking = X.flying().filter((it) => it.trk).length; R.kinds = X.flying().map((it) => it.kind);
        return R;
      }, kind);
      await p.screenshot({ path: `${OUT}/bombpath-world-${kind}-flight.png` }).catch(() => {}); await saveSide(p, `bombpath-world-${kind}-flight-side`);
      const r3 = await ev(() => { const X = window.__x; for (let i = 0; i < 600 && X.flying().length; i++) X.step(1, 0); return { minD: window.__minD, left: window.__pf().count }; });
      check(`World Chase ${kind}: a path for every held pumpkin during the telegraph (${r.held} held, ${r.tele.count} paths, visible ${r.tele.visible}, alpha ${r.tele.alpha.join('/')})`, r.held > 0 && r.tele.count === r.held && r.tele.visible && r.tele.alpha.every((x) => x > 0.2));
      check(`World Chase ${kind}: a path for every flying pumpkin (${r2.flying} flying, ${r2.count} paths, ${r2.tracking} tracking, ${r2.kinds.join('/')})`, r2.flying > 0 && r2.count === r2.flying && r2.tracking === r2.flying);
      check(`World Chase ${kind}: nothing drawn within fadeNear (3.0 m) of the camera (closest drawn point ${r3.minD.toFixed(2)} m); all gone after the flight`, r3.minD >= 3.0 - 1e-6 && r3.left === 0);
    }
    // ---- a cancelled telegraph removes it at once
    const c = await ev(() => {
      const X = window.__x, w = X.w, fx = window.__pf(); X.quiet(); X.lead();
      for (let i = 0; i < 600 && w.fight.state !== 'protected'; i++) X.step(1, 0); // (after the heavy throw: its vent and recovery first)
      X.quiet(); X.step(5, 0);
      w.debug.attack('single'); X.step(30, 0); const before = fx.count;
      w._respawning = true; X.step(1, 0); w._respawning = false; // the fight cancels a telegraph when the player respawns (its own abort path)
      return { before, after: fx.count, held: w.held.length, state: w.fight.state, cancelled: w.fight.log.filter((e) => e.type === 'cancel').length };
    });
    check(`World Chase: a cancelled telegraph removes its path at once (${c.before} → ${c.after}, fight ${c.state})`, c.before === 1 && c.after === 0 && c.held === 0 && c.cancelled >= 1, c);
    // ---- a tracked pumpkin is shot down by a web: gone, and its path with it
    const s = await ev(() => {
      const X = window.__x, w = X.w, B = X.B, fx = window.__pf(); X.quiet(); X.lead(); X.step(5, 0);
      const it = B._get(); X.a.boss.throwPoint(it.pos); B._launch(it, X.chest(), X.a.locomotion.vel); X.step(20, 0);
      const R = { trk: it.trk, count: fx.count, d0: B.stats.destroyed };
      const o = X.chest().add(new X.T.Vector3(0.25, 0.1, 0)); window.__inj.push({ type: 'web', hand: 'right', origin: o, dir: it.pos.clone().sub(o).normalize() }); X.step(1, 0);
      R.d1 = B.stats.destroyed; R.active = it.active; R.after = fx.count; return R;
    });
    check(`World Chase: a tracked pumpkin is shot down by a web, its path disappears the same frame (tracking ${s.trk}, paths ${s.count} → ${s.after})`, s.trk === true && s.d1 === s.d0 + 1 && !s.active && s.count === 1 && s.after === 0, s);
    // ---- a tracked pumpkin is blocked by the palm shield (desktop key B: the same detector / energy path as the palm)
    const sh = await ev(() => {
      const X = window.__x, w = X.w, B = X.B, a = X.a, fx = window.__pf(); X.quiet(); X.lead(); w.hp.reset(); a.shield.energy.reset(); X.step(5, 0);
      a.hub.desk.keys.add('KeyB'); X.step(4, 0);
      const it = B._get(); a.boss.throwPoint(it.pos); B._launch(it, X.chest(), a.locomotion.vel); X.step(10, 0);
      const R = { up: a.shield.anyActive, trk: it.trk, b0: B.stats.blocked, h0: B.stats.hits };
      for (let i = 0; i < 400 && it.active; i++) X.step(1, 0);
      R.b1 = B.stats.blocked; R.h1 = B.stats.hits; R.after = fx.count; a.hub.desk.keys.delete('KeyB'); X.step(2, 0); return R;
    });
    check(`World Chase: a tracked pumpkin is blocked by the palm shield (blocked ${sh.b0} → ${sh.b1}, hits ${sh.h0} → ${sh.h1}, path gone)`, sh.up && sh.trk && sh.b1 === sh.b0 + 1 && sh.h1 === sh.h0 && sh.after === 0, sh);
    // ---- arrival within ±0.15 s of T (a player who stays put; the pumpkin reaches him at its planned flight time)
    const ar = await ev(() => {
      const X = window.__x, w = X.w, B = X.B, a = X.a; X.quiet(); X.lead(); w.hp.reset(); X.step(5, 0);
      const out = [];
      for (let k = 0; k < 3; k++) {
        const it = B._get(); a.boss.throwPoint(it.pos); B._launch(it, X.chest(), a.locomotion.vel, { T: 1.6 + 0.4 * k }); const T = it.T;
        let t = 0, best = 1e9, bt = 0; const id = it.id;
        for (let i = 0; i < 400 && it.active && it.id === id; i++) { X.step(1, 0); t += 1 / 60; const d = it.pos.distanceTo(X.chest()); if (d < best) { best = d; bt = t; } }
        out.push({ T: +T.toFixed(3), arrival: +bt.toFixed(3), closest: +best.toFixed(2) });
        w.hp.reset(); X.step(30, 0);
      }
      return out;
    });
    check(`World Chase: arrival within ±0.15 s of T (${ar.map((x) => `T ${x.T} s → ${x.arrival} s`).join(', ')})`, ar.every((x) => Math.abs(x.arrival - x.T) <= 0.15 + 1 / 60), ar);
    const fxProg1 = await ev(() => window.__mobius.renderer.info.programs.length);
    check(`World Chase: no shader program built during these throws (${fxProg0} → ${fxProg1})`, fxProg1 === fxProg0);
    check(`World Chase: no page errors`, errs.length === 0, errs.slice(0, 3).join(' | '));
  }
  await p.close();
}

// =============================================================================================== Story chase
if (ONLY.includes('story')) {
  const { p, errors } = await openStory(b, { viewport: { width: 800, height: 450 }, draw: 0 });
  await p.evaluate(HELPERS);
  await p.evaluate(() => { const X = window.__x; X.look = (pt) => { const a = X.a, hub = a.hub, T = X.T, cam = a.camera, rig = a.world.player, c = cam.getWorldPosition(new T.Vector3()), d = pt.clone().sub(c); hub.desk.yaw = Math.atan2(-d.x, -d.z) - rig.rotation.y; hub.desk.pitch = Math.max(-1.3, Math.min(1.3, Math.atan2(d.y, Math.hypot(d.x, d.z)))); }; });
  const hasFx = await p.evaluate(() => !!window.__pf());
  const dc = await p.evaluate(async () => {
    const X = window.__x, C = X.C, S = X.settings, R = {};
    X.quiet(); X.behind(26, 3); X.step(10); X.look(X.a.boss.root.position); X.step(2); R.idle = window.__calls();
    // a forced telegraph (the scheduler's own state, held still: no release until the test says so)
    const up = C.attacks.update.bind(C.attacks); C.attacks.update = () => { C.attacks._t += 1 / 60; return []; };
    C.attacks._state = 'telegraph'; C.attacks._attack = 'spread'; C.attacks._t = 0; C._onAttack({ type: 'telegraph', attack: 'spread' }, X.chest());
    for (let i = 0; i < 50; i++) { X.behind(26, 3); X.step(1); }
    R.telegraph = window.__calls(); if ('bombPath' in S) { S.bombPath = false; X.step(1); R.telegraphOff = window.__calls(); S.bombPath = true; X.step(1); }
    C.attacks._state = 'hold'; C.attacks.update = up; C._onAttack({ type: 'release', attack: 'spread' }, X.chest()); X.step(15);
    R.flight = window.__calls(); if ('bombPath' in S) { S.bombPath = false; X.step(1); R.flightOff = window.__calls(); S.bombPath = true; }
    for (let i = 0; i < 400 && X.flying().length; i++) X.step(1);
    return R;
  });
  table.push({ world: 'Story chase', ...dc });
  if (!DC && hasFx) {
    const p0 = await p.evaluate(() => window.__x.progs());
    for (const kind of ['single', 'spread', 'heavy']) {
      const r = await p.evaluate((kind) => {
        const X = window.__x, C = X.C, fx = window.__pf(), len = { single: 0.95, spread: 1.4, heavy: 2.4 }[kind];
        X.quiet(); X.behind(26, 3); X.step(5); window.__minD = Infinity;
        const up = C.attacks.update.bind(C.attacks); C.attacks.update = () => { C.attacks._t += 1 / 60; return []; };
        C.attacks._state = 'telegraph'; C.attacks._attack = kind; C.attacks._t = 0; C._onAttack({ type: 'telegraph', attack: kind }, X.chest());
        for (let i = 0; i < Math.round(len * 0.6 * 60); i++) { X.behind(26, 3); X.step(1); }
        X.look(X.a.boss.root.position); X.step(1); X.render();
        const R = { held: C.held.filter((it) => it.active).length, count: fx.count, visible: fx.mesh.visible };
        window.__rel = () => { C.attacks._state = 'hold'; C.attacks.update = up; C._onAttack({ type: 'release', attack: kind }, X.chest()); };
        return R;
      }, kind);
      await p.screenshot({ path: `${OUT}/bombpath-story-${kind}-telegraph.png` }).catch(() => {}); await saveSide(p, `bombpath-story-${kind}-telegraph-side`);
      const r2 = await p.evaluate(() => { const X = window.__x, fx = window.__pf(); window.__rel(); X.step(12); X.look(X.a.boss.root.position); X.step(1); X.render(); const f = X.flying(); return { flying: f.length, count: fx.count, tracking: f.filter((it) => it.trk).length }; });
      await p.screenshot({ path: `${OUT}/bombpath-story-${kind}-flight.png` }).catch(() => {}); await saveSide(p, `bombpath-story-${kind}-flight-side`);
      const r3 = await p.evaluate(() => { const X = window.__x; for (let i = 0; i < 600 && X.flying().length; i++) { X.quiet(); X.step(1); } return { minD: window.__minD, left: window.__pf().count, flying: X.flying().length, held: X.C.held.length }; }); // (quiet every step: the scheduler's own next throw after the hold is not part of this check)
      check(`Story chase ${kind}: a path for every held pumpkin during the telegraph (${r.held} held, ${r.count} paths)`, r.held > 0 && r.count === r.held && r.visible);
      check(`Story chase ${kind}: a path for every flying pumpkin (${r2.flying} flying, ${r2.count} paths, ${r2.tracking} tracking)`, r2.flying > 0 && r2.count === r2.flying && r2.tracking === r2.flying);
      check(`Story chase ${kind}: nothing drawn within fadeNear (3.0 m) of the camera (closest ${r3.minD.toFixed(2)} m); all gone after the flight`, r3.minD >= 3.0 - 1e-6 && r3.left === 0, r3);
    }
    const c = await p.evaluate(() => {
      const X = window.__x, C = X.C, fx = window.__pf(); X.quiet(); X.behind(26, 3); X.step(5);
      const up = C.attacks.update.bind(C.attacks); C.attacks.update = () => { C.attacks._t += 1 / 60; return []; };
      C.attacks._state = 'telegraph'; C.attacks._attack = 'single'; C.attacks._t = 0; C._onAttack({ type: 'telegraph', attack: 'single' }, X.chest());
      for (let i = 0; i < 20; i++) { X.behind(26, 3); X.step(1); }
      const before = fx.count; C.attacks.update = up; C._onAttack({ type: 'cancel', attack: 'single' }, X.chest()); C.attacks._state = 'idle'; C.attacks._attack = null;
      return { before, after: fx.count };
    });
    check(`Story chase: a cancelled telegraph removes its path at once (${c.before} → ${c.after})`, c.before === 1 && c.after === 0, c);
    const sd = await p.evaluate(() => {
      const X = window.__x, B = X.C.bombs, fx = window.__pf(); X.quiet(); X.behind(26, 3); X.step(5);
      const it = X.pumpkin(); X.step(15); const R = { trk: it.trk, count: fx.count, d0: B.stats.destroyed };
      X.web(it.pos.clone()); X.step(1); R.d1 = B.stats.destroyed; R.after = fx.count; R.active = it.active; return R;
    });
    check(`Story chase: a tracked pumpkin shot down by a web takes its path with it (paths ${sd.count} → ${sd.after})`, sd.trk && sd.d1 === sd.d0 + 1 && !sd.active && sd.after === 0, sd);
    const p1 = await p.evaluate(() => window.__x.progs());
    check(`Story chase: no shader program built during these throws (${p0} → ${p1})`, p1 === p0);
    check('Story chase: no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  }
  await p.close();
}

console.log('\ndraw calls (one rendered frame each; "off" = the same frame with settings.bombPath = false)');
console.log('world                     idle  telegraph  telegraph-off  flight  flight-off');
for (const r of table) console.log(`${r.world.padEnd(24)} ${String(r.idle).padStart(5)} ${String(r.telegraph).padStart(10)} ${String(r.telegraphOff ?? '-').padStart(14)} ${String(r.flight).padStart(7)} ${String(r.flightOff ?? '-').padStart(11)}`);
for (const r of table) if (r.telegraphOff !== undefined && !DC) check(`${r.world}: the path preview costs at most 1 draw call (telegraph +${r.telegraph - r.telegraphOff}, flight +${r.flight - r.flightOff})`, r.telegraph - r.telegraphOff <= 1 && r.flight - r.flightOff <= 1);
await b.close();
console.log(fails ? `\n${fails} FAIL` : '\nALL PASS');
process.exit(fails ? 1 : 0);
