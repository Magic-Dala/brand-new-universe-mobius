// v0.41 World Chase combat end-to-end (headless Chromium + SwiftShader; needs `npm run dev`).
//   MODE=combat (default): desktop preview. Per map: pumpkin web assist + Light Bomb at chase speed (bench flight),
//     pause excluded from the timer, airborne victory while swinging (rig frozen, results, fixed time, Bitcoins),
//     Back to Home → title page, a second run starts clean. One map also runs a defeat (player HP 0).
//   MODE=xr: the IWER Quest 3 emulator: Enter VR Game → chase → victory → Back to Home ends the session → title.
// Injected input: events are appended right after the real InputHub.update(), so they take the exact same path as a
// wrist web / Light Bomb from the headset (aim origin + direction in world space).
import { chromium } from 'playwright';
const OUT = process.env.OUT || '.';
const MODE = process.env.MODE || 'combat';
const WAIT = +(process.env.WAIT || 120000); // (v1.1: game-clock waits in real ms; raise on a slow software renderer)
const MAPS = (process.env.MAPS || 'foldscape,forest,redrock,neon,moonlit,cloudpalace,aurora,molten').split(',');
const FULL = new Set((process.env.FULL || 'molten,neon,foldscape').split(','));
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required', '--ignore-certificate-errors'] });
const p = await b.newPage({ viewport: { width: +(process.env.W || 1280), height: +(process.env.H || 720) }, ignoreHTTPSErrors: true });
const logs = []; p.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`)); p.on('console', (m) => { if (m.type() === 'error') logs.push(`[error] ${m.text()}`); });
const results = []; let fails = 0;
const check = (name, ok, info = '') => { results.push({ name, ok, info }); if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`); };
const shot = (name) => p.screenshot({ path: `${OUT}/${name}.png`, timeout: 240000 }).catch((e) => console.log('shot failed', name, e.message));
const ev = (fn, arg) => p.evaluate(fn, arg);
const frames = async (n) => { const f0 = await ev(() => window.__frames || 0); await p.waitForFunction((x) => (window.__frames || 0) >= x, f0 + n, { timeout: 600000, polling: 100 }); };

await p.goto(process.env.URL || 'https://localhost:8443/', { waitUntil: 'load' });
await p.waitForFunction(() => window.__mobius && !document.getElementById('enter').disabled, null, { timeout: +(process.env.BOOT || 600000) }); // (v1.1: BOOT, default 10 min: software rendering on a slow machine)
// test hooks: frame counter + input injection after the real hub update
await ev(async () => {
  const a = window.__mobius, hub = a.hub, orig = hub.update.bind(hub), T = window.__THREE;
  (await import('/src/core/settings.js')).settings.finisher = false; // v0.45: these checks pin the instant victory at the killing hit (rig frozen mid-swing); the finisher has its own checks in feel.e2e.mjs (fin.*)
  window.__inj = []; window.__frames = 0;
  hub.update = (f, t) => { orig(f, t); window.__frames++; if (window.__aimFn) window.__aimFn(hub, T); for (const e of window.__inj.splice(0)) { if (e.useAim) { e.origin = hub.aim[e.hand].origin.clone(); e.dir = hub.aim[e.hand].dir.clone(); } hub.events.push(e); } }; // (useAim: the wrist's aim this frame, like a real shot)
  a.audioOff = true;
  window.__chest = () => a.locomotion.feet(new T.Vector3()).add(new T.Vector3(0, 1.3, 0));
});
const waitWorld = (id) => p.waitForFunction((id) => { const a = window.__mobius; return a.state === 'world' && a.worldChase.state && a.worldChase.mapId === id && !a.loader.visible; }, id, { timeout: 900000, polling: 500 });
const waitChase = () => p.waitForFunction(() => window.__mobius.worldChase.state === 'chase', null, { timeout: WAIT, polling: 250 });

/** Launch one pumpkin from Green Maniac's hand at the player (same code path as his throws). */
const launchPumpkin = () => ev(() => {
  const a = window.__mobius, B = a.worldChase.bombs, it = B._get(); if (!it) return null;
  a.boss.throwPoint(it.pos); B._launch(it, window.__chest(), a.locomotion.vel); return it.id;
});
/** Web from the right wrist aimed `deg` off the pumpkin (yaw offset). */
const webAt = (deg, key) => ev(({ deg, key }) => {
  const a = window.__mobius, T = window.__THREE, B = a.worldChase.bombs, it = B.items.find((x) => x.active && x.phase === 'fly' && `p${x.id}` === key) || B.items.find((x) => x.active && x.phase === 'fly');
  if (!it) return 'none';
  const o = window.__chest().add(new T.Vector3(0.25, 0.1, 0)), d = it.pos.clone().sub(o).normalize().applyAxisAngle(new T.Vector3(0, 1, 0), (deg * Math.PI) / 180);
  const Y = new T.Vector3(0, 1, 0); // the wrist follows the moving player and keeps aiming `deg` off the moving pumpkin
  window.__aimFn = (hub) => { const oo = window.__chest().add(new T.Vector3(0.25, 0.1, 0)); hub.aim.right.origin.copy(oo); if (it.active) hub.aim.right.dir.copy(it.pos.clone().sub(oo).normalize().applyAxisAngle(Y, (deg * Math.PI) / 180)); hub.aim.right.valid = true; };
  window.__pendingWeb = { o, d, id: it.id };
  return { id: it.id, dist: +it.pos.distanceTo(o).toFixed(1) };
}, { deg, key });

for (const mapId of MODE === 'combat' ? MAPS : []) {
  console.log(`---- ${mapId}`);
  await ev((id) => { const a = window.__mobius; a.worldChase.bench = null; if (!a.desktop) { a.pendingMap = id; a.enterDesktop(); } else a.menus.panels.worldMaps.buttons.find((x) => x.id === `map-${id}`).onClick(); }, mapId); // (in-VR map panel = a real selection)
  await waitWorld(mapId);
  const s0 = await ev(() => { const w = window.__mobius.worldChase; return { hp: w.hp.hp, boss: w.bossHp.hp, time: w.run.time, phase: w.run.phase, frozen: !!window.__mobius.locomotion.frozen, hud: window.__mobius.hud.mode }; });
  check(`${mapId}: fresh run (HP ${s0.hp}/${s0.boss}, timer ${s0.time}, ${s0.phase}, frozen ${s0.frozen}, HUD ${s0.hud})`, s0.hp === 100 && s0.boss === 100 && s0.time === 0 && s0.phase === 'preparing' && !s0.frozen && s0.hud === 'chase');
  // start the chase (the intro waits for the first move) and fly the route at chase speed (dev bench, 18 m/s)
  await ev(() => { const w = window.__mobius.worldChase; w.stateTime = 99; });
  await waitChase();
  await ev(() => { const w = window.__mobius.worldChase; w.startBench(600, 18); w.clock = Math.max(w.clock, 7); w._bv = 18; w.playerSpeed = 18; /* bench = instant speed: start him at it too */ w.bombs.timer = 99; w.fight.nextAttackIn = 1e9; }); // (v0.42: the fight's own attacks off for these checks)
  await frames(30);
  // ---- pumpkin web assist while moving: 6° off → hit (highlighted first), 25° off → no hit
  await ev(() => { window.__mobius.worldChase.bench.speed = 10; }); // (SwiftShader steps 0.1 s per frame: at 18 m/s the pumpkin would fly past within the test's frames)
  let id = await launchPumpkin(); await frames(1);
  let info = await webAt(6); await frames(1);
  const lit = await ev(() => { const B = window.__mobius.worldChase.bombs; return B.items.filter((x) => x.active && x.hl === 1).map((x) => x.id); });
  const d0 = await ev(() => window.__mobius.worldChase.bombs.stats.destroyed);
  await ev(() => { const P = window.__pendingWeb; window.__inj.push({ type: 'web', hand: 'right', useAim: true }); });
  await frames(2);
  const d1 = await ev(() => window.__mobius.worldChase.bombs.stats.destroyed);
  const why = await ev(() => { const w = window.__mobius.worldChase, a = window.__mobius, T = window.__THREE, it = w.bombs.items.find((x) => x.active && x.phase === 'fly'), fwd = new T.Vector3(0, 0, -1).applyQuaternion(a.camera.getWorldQuaternion(new T.Quaternion())); return { ahead: it ? +it.pos.clone().sub(window.__chest()).dot(fwd).toFixed(1) : null, clock: +w.clock.toFixed(2), pick: w.lastPick, hit: w.lastHit, stats: w.bombs.stats, active: w.bombs.items.filter((x) => x.active).map((x) => [x.id, x.phase, x.kind]) }; });
  check(`${mapId}: web 6° off a moving pumpkin (${info.dist} m) is assisted — highlighted [${lit}] then destroyed`, d1 === d0 + 1 && lit.includes(id), `${d0}→${d1} ${JSON.stringify(why)}`);
  if (mapId === MAPS[0]) { id = await launchPumpkin(); await frames(1); await webAt(5); await frames(1); await shot(`combat-${mapId}-lock`); await ev(() => { const P = window.__pendingWeb; window.__inj.push({ type: 'web', hand: 'right', useAim: true }); }); await frames(3); }
  id = await launchPumpkin(); await frames(1); info = await webAt(25); await frames(1);
  const e0 = await ev(() => window.__mobius.worldChase.bombs.stats.destroyed);
  await ev(() => { const P = window.__pendingWeb; window.__inj.push({ type: 'web', hand: 'right', useAim: true }); });
  await frames(3);
  const e1 = await ev(() => window.__mobius.worldChase.bombs.stats.destroyed);
  check(`${mapId}: web 25° off is not pulled onto the pumpkin`, e1 === e0, `destroyed ${e0}→${e1}`);
  // ---- a deliberate swing shot at an anchor is not stolen by a pumpkin in flight elsewhere
  await ev(() => { window.__mobius.worldChase.bombs.clear(); }); id = await launchPumpkin(); await frames(1);
  const sw0 = await ev(() => {
    const a = window.__mobius, loco = a.locomotion, w = a.worldChase, o = window.__chest().add(new window.__THREE.Vector3(0.25, 0.1, 0));
    const it = w.bombs.items.find((x) => x.active && x.phase === 'fly'); const toP = it ? it.pos.clone().sub(o).normalize() : null;
    const an = loco.anchorCandidates(o).map((c) => c.anchor).filter((x) => x.valid && !loco.occluded(o, x.p, x.building)).map((x) => ({ x, ang: toP ? x.p.clone().sub(o).normalize().angleTo(toP) : 9 })).filter((q) => q.ang > 0.5).sort((p, q) => p.x.p.distanceTo(o) - q.x.p.distanceTo(o))[0];
    if (!an) return null;
    const d = an.x.p.clone().sub(o).normalize();
    window.__aimFn = (hub) => { hub.aim.right.origin.copy(o); hub.aim.right.dir.copy(d); hub.aim.right.valid = true; };
    window.__inj.push({ type: 'web', hand: 'right', origin: o, dir: d });
    return { swings: loco.stats.swings, destroyed: w.bombs.stats.destroyed, ang: +(an.ang * 57.3).toFixed(0) };
  });
  await frames(2);
  const sw1 = await ev(() => ({ swings: window.__mobius.locomotion.stats.swings, destroyed: window.__mobius.worldChase.bombs.stats.destroyed }));
  check(`${mapId}: web aimed at a swing anchor (pumpkin ${sw0?.ang}° away) attaches the swing, pumpkin untouched`, !!sw0 && sw1.swings === sw0.swings + 1 && sw1.destroyed === sw0.destroyed, JSON.stringify({ sw0, sw1 }));
  await ev(() => { window.__aimFn = null; window.__mobius.worldChase.bombs.clear(); window.__mobius.locomotion.detach(true); });
  // ---- Light Bomb at chase speed toward Green Maniac (8° off): homing hit → HP drops once; cooldown blocks a second throw
  const lb = await ev(() => {
    const a = window.__mobius, w = a.worldChase, T = window.__THREE, o = window.__chest().add(new T.Vector3(0.25, 0.1, 0));
    const d = w.bossPos.clone().sub(o).normalize().applyAxisAngle(new T.Vector3(1, 0, 0), 0.14);
    window.__inj.push({ type: 'bombThrow', hand: 'right', origin: o, dir: d, worldVelocity: d.clone().multiplyScalar(4) });
    return { hp: w.bossHp.hp, dist: +w.bossPos.distanceTo(o).toFixed(1) };
  });
  await frames(2);
  const lb2 = await ev(() => { const w = window.__mobius.worldChase; return { pick: w.lightBombs.lastPick, ready: w.lightBombs.ready, locked: window.__mobius.hub.ctx.bombLocked }; });
  await ev(() => { const a = window.__mobius, T = window.__THREE, o = window.__chest(); window.__inj.push({ type: 'bombThrow', hand: 'right', origin: o, dir: new T.Vector3(0, 0, -1), worldVelocity: new T.Vector3(0, 0, -4) }); });
  await p.waitForFunction(() => window.__mobius.worldChase.lightBombs.active.length === 0, null, { timeout: WAIT, polling: 100 });
  const lb3 = await ev(() => { const w = window.__mobius.worldChase; return { hp: w.bossHp.hp, thrown: w.lightBombs.stats.thrown, hits: w.lightBombs.stats.hitsBoss, log: w.bossHp.log.slice(-2), chip: w.fight.cfg.dmg.protected.lightBomb.hp, shield: w.fight.stability, shieldMax: w.fight.cfg.shield.max }; });
  check(`${mapId}: Light Bomb at 18 m/s → locked on Green Maniac (${lb.dist} m), one hit on the shield ${lb.hp}→${lb3.hp} (v0.42: protected = shield damage, little HP); cooldown blocks the 2nd throw (hub bombLocked ${lb2.locked})`, lb2.pick === 'boss' && Math.abs(lb3.hp - (lb.hp - lb3.chip)) < 1e-9 && lb3.shield < lb3.shieldMax && lb3.thrown === 1 && lb2.locked === true, JSON.stringify(lb3));
  // ---- Light Bomb clears a pumpkin
  await p.waitForFunction(() => window.__mobius.worldChase.lightBombs.ready, null, { timeout: 600000, polling: 200 }); // cooldown (game time)
  id = await launchPumpkin(); await frames(1);
  await ev(() => { const a = window.__mobius, T = window.__THREE, w = a.worldChase, it = w.bombs.items.find((x) => x.active && x.phase === 'fly'); const o = window.__chest(); const d = it.pos.clone().sub(o).normalize(); window.__inj.push({ type: 'bombThrow', hand: 'right', origin: o, dir: d, worldVelocity: d.clone().multiplyScalar(4) }); });
  await frames(2);
  await p.waitForFunction(() => window.__mobius.worldChase.lightBombs.active.length === 0, null, { timeout: WAIT, polling: 100 });
  const pk = await ev(() => { const w = window.__mobius.worldChase; return { thrown: w.lightBombs.stats.thrown, pick: w.lightBombs.lastPick, pumpkins: w.lightBombs.stats.pumpkins, left: w.bombs.items.filter((x) => x.active).length, hp: w.hp.hp }; });
  check(`${mapId}: Light Bomb destroys an incoming pumpkin`, pk.pumpkins >= 1 && pk.left === 0, JSON.stringify(pk));
  // ---- pause is excluded from the chase time
  const tA = await ev(() => { const t = window.__mobius.worldChase.run.time; window.__mobius.toggleMenu(); return t; }); await frames(10); // (read + pause in one call: no frame in between)
  const tB = await ev(() => window.__mobius.worldChase.run.time);
  await ev(() => window.__mobius.toggleMenu()); await frames(20);
  const tC = await ev(() => window.__mobius.worldChase.run.time);
  check(`${mapId}: timer stops while paused (${tA.toFixed(2)} → ${tB.toFixed(2)} paused → ${tC.toFixed(2)})`, Math.abs(tB - tA) < 1e-6 && tC > tB);
  await ev(() => { window.__mobius.worldChase.bench = null; });
  if (!FULL.has(mapId)) continue;
  if (mapId === MAPS[0]) await shot(`combat-${mapId}-hud`);
  let w0 = Date.now(); await frames(10); const msRun = (Date.now() - w0) / 10;
  // ---- airborne victory while swinging: attach to an anchor in the air, then the final hit
  const sw = await ev(() => {
    const a = window.__mobius, T = window.__THREE, w = a.worldChase, loco = a.locomotion;
    const s = w.playerS + 30, p0 = w.world.pointAt(s); loco.placeAt(new T.Vector3(p0.x, p0.y - 2, p0.z), -w.world.headingAt(s)); loco.grounded = false; loco.vel.set(0, 0, -12).applyAxisAngle(new T.Vector3(0, 1, 0), -w.world.headingAt(s));
    const chest = window.__chest();
    const an = loco.anchorCandidates(chest).map((c) => c.anchor).filter((x) => x.valid && !loco.occluded(chest, x.p, x.building)).sort((x, y) => x.p.distanceTo(chest) - y.p.distanceTo(chest))[0];
    if (!an) return { ok: false };
    a.hub.desk.keys.add('KeyE'); // desktop "hold the web" (= the hand keeps the web pose / the trigger held)
    const ok = !!loco.attachTo({ ...an, moving: false }, { hand: 'right', origin: chest.clone(), dir: an.p.clone().sub(chest).normalize() });
    return { ok, d: +an.p.distanceTo(chest).toFixed(1) };
  });
  await frames(12);
  const pre = await ev(() => { const a = window.__mobius, w = a.worldChase; return { ropes: a.locomotion.ropes.length, grounded: a.locomotion.grounded, sp: +a.locomotion.vel.length().toFixed(1), y: +a.locomotion.rig.position.y.toFixed(2), time: w.run.time, coins: a.coins.count }; });
  await ev(() => { const w = window.__mobius.worldChase; w.bossHp.hp = 4; w._bossHit(4, w.bossPos.clone(), null, 'test'); });
  const frozen0 = await ev(() => { const r = window.__mobius.locomotion.rig.position; return [r.x, r.y, r.z]; });
  await frames(8); await shot(`combat-${mapId}-victory-effect`);
  await p.waitForFunction(() => window.__mobius.menus.current === 'worldResults', null, { timeout: WAIT, polling: 100 });
  await ev(() => { window.__w0 = performance.now(); }); await frames(20); // ≥ 20 more frames (+ the transition) with the panel up
  const held = await ev(() => ((performance.now() - window.__w0) / 1000).toFixed(1));
  await ev(() => { window.__mobius.hub.desk.keys.delete('KeyE'); });
  w0 = Date.now(); await frames(10); const msRes = (Date.now() - w0) / 10;
  console.log(`  (desktop SwiftShader wall time per frame: chase ${msRun.toFixed(0)} ms, results ${msRes.toFixed(0)} ms — not a Quest number)`);
  const post = await ev(() => { const a = window.__mobius, w = a.worldChase, r = a.locomotion.rig.position; return { pos: [r.x, r.y, r.z], ropes: a.locomotion.ropes.length, frozen: !!a.locomotion.frozen, state: w.state, phase: w.run.phase, time: w.run.time, final: w.run.final, panels: Object.entries(a.menus.panels).filter(([, q]) => q.visible).map(([k]) => k), bombs: w.bombs.items.filter((x) => x.active).length }; });
  const drift = Math.hypot(post.pos[0] - frozen0[0], post.pos[1] - frozen0[1], post.pos[2] - frozen0[2]);
  check(`${mapId}: airborne victory mid-swing (was ${pre.sp} m/s, rope ${pre.ropes}, grounded ${pre.grounded}) → frozen, drift ${drift.toExponential(1)} m over 20+ frames (${held} s)`, sw.ok && pre.ropes === 1 && !pre.grounded && drift < 1e-6 && post.ropes === 0 && post.frozen);
  check(`${mapId}: results once (${post.panels}), time fixed ${post.final?.time.toFixed(2)} = ${post.time.toFixed(2)}, Bitcoins ${post.final?.coins}, map "${post.final?.mapName}"`, post.panels.length === 1 && post.panels[0] === 'worldResults' && post.final.outcome === 'victory' && Math.abs(post.final.time - post.time) < 1e-9 && post.final.coins === pre.coins && post.bombs === 0 && !!post.final.mapName);
  // headset tracking still drives the view: turning the (desktop) head moves the camera, rig stays
  await ev(() => { window.__mobius.hub.desk.yaw += 0.6; }); await frames(4);
  const look = await ev(() => { const a = window.__mobius, r = a.locomotion.rig.position; return { yaw: a.camera.rotation.y, pos: [r.x, r.y, r.z] }; });
  check(`${mapId}: looking around still works while frozen`, Math.abs(look.pos[1] - frozen0[1]) < 1e-9);
  // a second victory / damage after the end is ignored
  const again = await ev(() => { const w = window.__mobius.worldChase; const a = w._bossHit(50, w.bossPos.clone(), null, 'late'), b = w._playerHit(50, null, 'late'); w._resolve('defeat'); return { a, b, outcome: w.run.outcome, shown: window.__mobius.menus.current }; });
  check(`${mapId}: no damage / second resolution after the end`, again.a === 0 && again.b === 0 && again.outcome === 'victory' && again.shown === 'worldResults');
  if (mapId === MAPS[0] || mapId === 'molten') { await ev(() => { window.__mobius.menus.placeInFront(window.__mobius.menus.panels.worldResults); }); await frames(4); await shot(`combat-${mapId}-results`); }
  // ---- Back to Home (the button's own handler) → title page; then a second run starts clean
  const g0 = await ev(() => window.__mobius.renderer.info.memory.geometries);
  await ev(() => window.__mobius.menus.panels.worldResults.buttons.find((x) => x.id === 'home').onClick());
  await p.waitForFunction(() => window.__mobius.state === 'title', null, { timeout: WAIT, polling: 200 });
  const home = await ev(() => { const a = window.__mobius; return { title: getComputedStyle(document.getElementById('title')).display !== 'none', ws: a.worldChase.state, frozen: !!a.locomotion.frozen, lb: a.worldChase.lightBombs.active.length, bombs: a.worldChase.bombs.items.filter((x) => x.active).length, menus: a.menus.current, sel: document.getElementById('map-select')?.value ?? null, stored: (() => { try { return localStorage.getItem('mobius.map.v1') || 'foldscape'; } catch { return '?'; } })() }; });
  // (v0.49 moved the map picker into VR: the title page has none, so the saved selection must simply still be a map)
  check(`${mapId}: Back to Home → title page (no map picker, saved map "${home.stored}" valid), world gone, nothing left running`, home.title && home.ws === null && !home.frozen && home.lb === 0 && home.bombs === 0 && home.menus === null && home.sel === null && MAPS.includes(home.stored), `stored ${home.stored}`);
  if (mapId === MAPS[0]) await shot(`combat-home`);
  void g0;
}
// ---- defeat (player HP 0) on the first map, after a clean re-entry
if (MODE === 'combat') {
  const id = MAPS[0];
  await ev((id) => { const a = window.__mobius; a.pendingMap = id; a.enterDesktop(); }, id);
  await waitWorld(id);
  await ev(() => { const w = window.__mobius.worldChase; w.stateTime = 99; }); await waitChase(); await frames(30);
  const st = await ev(() => { const a = window.__mobius, w = a.worldChase; return { hp: w.hp.hp, boss: w.bossHp.hp, time: w.run.time, frozen: !!a.locomotion.frozen, mode: a.locomotion.mode }; });
  check(`re-entry: HP ${st.hp}, Green Maniac ${st.boss}, timer ${st.time.toFixed(2)} s (≤ 30 frames since the chase began, not continued), frozen ${st.frozen}, locomotion ${st.mode}`, st.hp === 100 && st.boss === 100 && st.time <= 4.5 && !st.frozen && st.mode === 'city');
  // gravity works in the new run
  const g = await ev(() => { const a = window.__mobius, T = window.__THREE, w = a.worldChase, l = a.locomotion; const s = w.playerS + 20, q = w.world.pointAt(s); l.placeAt(new T.Vector3(q.x, q.y + 6, q.z)); l.grounded = false; return l.rig.position.y; });
  await frames(6);
  const g1 = await ev(() => window.__mobius.locomotion.rig.position.y);
  check(`re-entry: gravity restored (fell ${(g - g1).toFixed(2)} m in 6 frames)`, g - g1 > 0.05);
  // five pumpkin blasts (damage protection between them) → defeat
  for (let i = 0; i < 6; i++) await ev((i) => { const w = window.__mobius.worldChase; w.clock += 2; w._playerHit(20, `test${i}`, 'pumpkin'); }, i);
  await p.waitForFunction(() => window.__mobius.menus.current === 'worldResults', null, { timeout: WAIT, polling: 100 });
  const df = await ev(() => { const a = window.__mobius, w = a.worldChase; return { outcome: w.run.outcome, hp: w.hp.hp, frozen: !!a.locomotion.frozen, log: w.hp.log.length }; });
  check(`defeat: player HP 0 → results (defeat), frozen, ${df.log} hits counted`, df.outcome === 'defeat' && df.hp === 0 && df.frozen && df.log === 5);
  await ev(() => window.__mobius.menus.placeInFront(window.__mobius.menus.panels.worldResults)); await frames(4); await shot('combat-defeat-results');
  await ev(() => window.__mobius.menus.panels.worldResults.buttons.find((x) => x.id === 'home').onClick());
  await p.waitForFunction(() => window.__mobius.state === 'title', null, { timeout: WAIT, polling: 200 });
  check('defeat: Back to Home → title', true);
  // story mode never shows chase results / HP
  const story = await ev(() => { const a = window.__mobius; return { storyHasRun: !!a.story.run, chaseState: a.worldChase.state }; });
  check('story / arcade untouched: no World Chase run outside the world', story.chaseState === null);
}
// ---- XR (IWER Quest 3 emulator): Enter VR Game → victory → Back to Home ends the session
if (MODE === 'xr') {
  const id = MAPS[0];
  await p.evaluate((id) => { window.__mobius.pendingMap = id; }, id); // v0.49: the website has no map picker any more (maps are picked inside VR)
  await p.click('#enter', { force: true });
  await waitWorld(id);
  await ev(() => { const w = window.__mobius.worldChase; w.stateTime = 99; }); await waitChase(); await frames(40);
  const xr0 = await ev(() => ({ xr: window.__mobius.xrActive, hud: window.__mobius.hud.mode }));
  await shot('xr-chase-hud');
  await ev(() => { const w = window.__mobius.worldChase; w.bossHp.hp = 4; w._bossHit(4, w.bossPos.clone(), null, 'test'); });
  await p.waitForFunction(() => window.__mobius.menus.current === 'worldResults', null, { timeout: WAIT, polling: 100 });
  await frames(10); await shot('xr-results');
  await ev(() => window.__mobius.menus.panels.worldResults.buttons.find((x) => x.id === 'home').onClick());
  await p.waitForFunction(() => window.__mobius.state === 'title' && !window.__mobius.xrActive, null, { timeout: WAIT, polling: 200 });
  const xr1 = await ev(() => ({ xr: window.__mobius.xrActive, title: getComputedStyle(document.getElementById('title')).display !== 'none', ws: window.__mobius.worldChase.state }));
  check(`xr: in VR (${xr0.xr}, HUD ${xr0.hud}) → victory → Back to Home ends the session → title page`, xr0.xr && xr0.hud === 'chase' && !xr1.xr && xr1.title && xr1.ws === null);
  // and Enter VR Game again starts a fresh run
  await p.click('#enter', { force: true });
  await waitWorld(id);
  const xr2 = await ev(() => { const w = window.__mobius.worldChase; return { hp: w.hp.hp, boss: w.bossHp.hp, time: w.run.time, frozen: !!window.__mobius.locomotion.frozen }; });
  check(`xr: re-entered — HP ${xr2.hp}/${xr2.boss}, timer ${xr2.time}, frozen ${xr2.frozen}`, xr2.hp === 100 && xr2.boss === 100 && xr2.time === 0 && !xr2.frozen);
}
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed`);
if (logs.length) console.log(logs.slice(0, 30).join('\n'));
await b.close();
process.exit(fails ? 1 : 0);
