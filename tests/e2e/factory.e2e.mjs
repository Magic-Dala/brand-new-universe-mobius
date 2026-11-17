// Factory flow e2e (real app in the browser, deterministic stepping):
// roof circle → ONE bomb → blast → short fall → black Loading (in-scene) → separate interior →
// arena circle → countdown → boss battle → fail/retry (interior only) → win → back to the city.
// Needs the dev server (npm run dev). Usage: node tests/e2e/factory.e2e.mjs   (LANG_UI=en for English)
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required', '--ignore-certificate-errors'] });
const p = await b.newPage({ viewport: { width: 320, height: 180 }, ignoreHTTPSErrors: true });
const errors = []; p.on('pageerror', (e) => errors.push(e.message));
await p.goto(process.env.URL || 'https://localhost:8443/', { waitUntil: 'load' });
await p.waitForTimeout(6000);
await p.selectOption('#lang', process.env.LANG_UI || 'zh-Hant');
await p.click('#enter-desktop', { force: true }).catch(() => p.click('#enter', { force: true }));
await p.waitForTimeout(800);
const r = await p.evaluate(async () => {
  const a = window.__mobius, s = a.story, T = window.__THREE, loco = a.locomotion, f = s.flow;
  const L = await import('/src/data/layout.js');
  (await import('/src/core/settings.js')).settings.storyCombat = false; // v0.47: these checks pin the v0.46 Story chase; the Story chase combat has its own checks in storycombat.e2e.mjs
  (await import('/src/core/settings.js')).settings.tutorials = false; // v0.49: the tutorial after the arena countdown has its own checks in tutorials.e2e.mjs
  const FD = await import('/src/data/factory.js');
  const frame = a.frame.bind(a); a.frame = () => {};
  const out = {}; const ok = (k, v) => { out[k] = v; };
  const audit = { simultaneous: 0, maxBoss: 0, maxHum: 0 };
  const countBoss = () => { let n = 0; a.scene.traverse((o) => { if (o.name === 'boss' && o.visible) n++; }); return n; };
  const step = (n = 1) => { for (let i = 0; i < n; i++) { a.hub.events.length = 0; frame(1 / 60, 0, null); const loaded = !a.city.suspended && a.cityWorld.cells.size > 0; if (loaded && a.interior?.root.visible) audit.simultaneous++; audit.maxBoss = Math.max(audit.maxBoss, countBoss()); audit.maxHum = Math.max(audit.maxHum, (f.hum ? 1 : 0) + (s.chaseCtl.hum ? 1 : 0)); } };
  const until = async (cond, maxFrames = 2000, realWait = false) => { for (let i = 0; i < maxFrames && !cond(); i++) { step(1); if (realWait && i % 10 === 0) await new Promise((r) => setTimeout(r, 15)); } return cond(); };
  try {
  const C = L.KEY_BUILDINGS[1], c = L.STORY.circle.pos; let CC = null;
  const landOn = (x, z) => { loco.detach(true); loco.cling = null; loco.setCityMode([]); loco.placeAt(new T.Vector3(x, C.h, z), null); loco._landRoof(CC); loco.grounded = true; };
  // ---- chase finished up to the factory roof (route complete), as a player would arrive
  a.go('story'); s.suited = true; a.setArmored(true);
  a.city.setFocus(new T.Vector3(c[0], C.h, c[2])); CC = a.cityWorld.colliderOf('C'); // as if the chase streamed the city up to the factory
  landOn(c[0] + 5, c[2] - 5); s.inRoom = false; loco.ignoreColliders = new Set();
  s.enterStage('chase'); step(2);
  const ch = s.chaseCtl;
  s.restartRoofFinale(); step(60 * 3); // v0.21: Green Maniac waits over the circle (the chase itself: chase / combat e2e)
  ok('A_standoff', { flow: s.flowState, objective: s.currentObjective, circle: ch.circle.visible });
  landOn(c[0] + 0.3, c[2] - 0.2); step(120); ok('D_circleAloneNothing', { flow: s.flowState, roofFired: f.roofFired });
  { const org = loco.feet().add(new T.Vector3(0, 1.3, 0)), tg = ch.bossBody(new T.Vector3()); ch._handleWebs({ events: [{ type: 'web', hand: 'right', origin: org, dir: tg.clone().sub(org).normalize() }] }, loco); }
  await until(() => s.stage === 'roofEvent', 300);
  ok('E_roofEvent', { flow: s.flowState, attack: s.allowAttack, locoMode: loco.mode, webs: !!loco.attach });
  // repeated triggers are ignored
  const again = [f.startRoofEvent({ vel: new T.Vector3() }), (s.onChaseComplete({ vel: new T.Vector3() }), s.flowState)];
  ok('F_repeatIgnored', again);
  // pause mid-event: frozen; resume
  step(30); s.pause(); const bp = a.boss.root.position.clone(), st = f.state; step(90); ok('G_pauseFrozen', { same: a.boss.root.position.distanceTo(bp) < 1e-6 && f.state === st, state: st }); s.resume();
  // the throw + blast
  await until(() => f.state === 'RoofExplosion', 900);
  ok('H_explosion', { bombs: f.bombsThrown, explosions: f.explosions, roof: a.city.factory.state, hole: loco.roofHoles.has('C'), bossVisible: a.boss.root.visible, banner: a.hud.banner.text });
  f._explode(); ok('I_reExplodeIgnored', { explosions: f.explosions });
  // short fall: rig origin only, no rotation; then fade to black
  const q0 = a.world.player.quaternion.clone(), y0 = a.world.player.position.y; const cam0 = a.camera.position.clone();
  await until(() => f.state === 'ShortFall', 120);
  let minY = 1e9; for (let i = 0; i < 400 && s.stage === 'roofEvent'; i++) { step(1); minY = Math.min(minY, a.world.player.position.y); }
  ok('J_fall', { depth: +(y0 - minY).toFixed(2), rotated: a.world.player.quaternion.angleTo(q0) > 1e-6, headMoved: a.camera.position.distanceTo(cam0) > 1e-6, fade: +s.fade.a.toFixed(2), stage: s.stage });
  // black Loading screen (in-scene, no DOM): city unloaded before the interior loads
  step(3);
  ok('K_loading', { flow: s.flowState, loader: a.loader.state, text: window.__t(a.loader.textKey), world: a.worldName, citySuspended: a.city.suspended, xrSession: 'kept (no reload)', dom: !!document.querySelector('#loading-overlay') });
  await until(() => a.worldName === 'factory' && s.stage === 'factory', 3000, true);
  ok('L_interior', { flow: s.flowState, world: a.worldName, loader: a.loader.state, chunks: a.cityWorld.cells.size, interiorVisible: a.interior?.root.visible, feetY: +loco.feet().y.toFixed(2), locoMode: loco.mode, attack: s.allowAttack, arcade: a.arcade.state });
  const spawn = loco.feet(); ok('M_spawnClear', { clearance: +FD.clearance(spawn.x - FD.INTERIOR.origin[0], spawn.z - FD.INTERIOR.origin[2]).toFixed(2), underBreach: Math.abs(spawn.x - FD.INTERIOR.origin[0] - FD.INTERIOR.breach.x) < FD.INTERIOR.breach.hw && Math.abs(spawn.z - FD.INTERIOR.origin[2] - FD.INTERIOR.breach.z) < FD.INTERIOR.breach.hd });
  await until(() => f.state === 'AwaitArenaCircle', 1200);
  const hv = a.interior.toWorld(...FD.INTERIOR.bossHover);
  ok('N_arrival', { flow: s.flowState, bossToHover: +a.boss.root.position.distanceTo(hv).toFixed(2), objective: s.currentObjective, arena: f.arena.visible, attack: s.allowAttack });
  // no battle without the circle
  step(120); ok('O_noBattleOutside', { flow: s.flowState, arcade: a.arcade.state });
  // enter the PLAYER START circle → stable → countdown → battle
  const ac = a.interior.toWorld(...FD.INTERIOR.arenaCircle.pos);
  loco.placeAt(ac, null); step(50); ok('P_countdown', { countdown: f.countdown !== null, banner: a.hud.banner.text });
  // stepping out cancels
  loco.placeAt(ac.clone().add(new T.Vector3(3, 0, 0)), null); step(5); ok('Q_cancel', { countdown: f.countdown, flow: s.flowState });
  loco.placeAt(ac, null);
  for (let i = 0; i < 400 && a.arcade.state !== 'playing'; i++) { step(1); if (i % 10 === 0) await new Promise((r) => setTimeout(r, 20)); }
  const ar = a.arcade;
  ok('R_battle', { flow: s.flowState, appState: a.state, arcade: ar.state, arena: +a.arenaOrigin.distanceTo(ac).toFixed(2), bossHome: +a.bossHome.distanceTo(hv).toFixed(2), songId: a.currentSong?.id });
  const run = (fail) => { ar.conductor.stop(); let sim = -0.5; const c2 = ar.conductor; c2.now = () => sim; c2.tick = () => { if (sim >= c2.duration) { c2.state = 'ended'; c2.onEnded?.(); } }; c2.state = 'playing'; c2.pause = () => { c2.state = 'paused'; }; c2.resume = () => { c2.state = 'playing'; }; ar.debug.autoplay = !fail; for (let i = 0; i < 72 * 70 && ar.state === 'playing'; i++) { a.hub.events.length = 0; ar.update(1 / 72, sim); a.fx.update(1 / 72, a.camera); sim += 1 / 72; } ar.debug.autoplay = false; for (const k of ['now', 'tick', 'pause', 'resume']) delete c2[k]; };
  run(true); step(2);
  ok('S_failResults', { menu: a.menus.current, buttons: a.menus.panels.results.buttons.map((x) => (typeof x.label === 'function' ? x.label() : x.label)) });
  a.menus.panels.results.buttons[0].onClick(); step(5);
  ok('T_retryInteriorOnly', { flow: s.flowState, world: a.worldName, citySuspended: a.city.suspended, explosions: f.explosions, bombs: f.bombsThrown, chase: s.chaseCtl.active, inCircle: +loco.feet().distanceTo(ac).toFixed(2) });
  for (let i = 0; i < 400 && a.arcade.state !== 'playing'; i++) { step(1); if (i % 10 === 0) await new Promise((r) => setTimeout(r, 20)); }
  ok('U_retryBattle', { arcade: ar.state });
  run(false); step(2);
  ok('V_win', { menu: a.menus.current, button: a.menus.panels.results.buttons[0].label() });
  a.menus.panels.results.buttons[0].onClick(); // Next → Green Maniac bursts out through the roll-up door
  step(2); ok('W0_escape', { stage: s.stage, flow: s.flowState });
  const esc = []; for (let i = 0; i < 900 && s.stage === 'escape'; i++) { step(1); if (esc.at(-1) !== f.state) esc.push(f.state); if (f.state === 'FollowToDoor' && i % 30 === 0) { const d = a.interior?.toWorld(0, 0, -15.2); if (d) loco.placeAt(d, null); } }
  ok('W1_escapeStates', esc);
  await until(() => s.stage === 'endless' && a.loader.state === 'hidden', 6000, true);
  step(30);
  const E = s.endless;
  ok('W_endless', { world: a.worldName, interior: !!a.interior, door: a.city.factory.doorState ?? a.city.factory.state, stage: s.stage, endless: E.state, mode: a.cityWorld.mode, boss: a.boss.root.visible, fade: +s.fade.a.toFixed(2), cells: a.cityWorld.cells.size, feet: loco.feet().toArray().map((v) => +v.toFixed(1)), onStreet: loco.grounded });
  // fly along the endless route (choosing exits at crossroads): lead → escape → free, never in an empty block
  { const w = a.cityWorld; let sp = E.playerS, empty = 0, minLead = 1e9, maxCells = 0; const phases = [E.state];
    for (let i = 0; i < 60 * 70 && sp < E.playerS + 2400; i++) {
      const pd = w.route.pending; if (pd && w.curTile >= pd.idx - 1) w.choose((pd.allowed || pd.exits)[0]);
      const q = w.pointAt(sp); loco.detach(true); loco.placeAt(q, null); loco.grounded = false; loco.cling = { building: 'X', normal: new T.Vector3(1, 0, 0) }; loco.vel.set(0, 0, 0);
      step(1); sp += 0.3;
      const cc = w.cellAt(q.x, q.z); if (!cc || !cc.ready) empty++;
      if (E.state === 'lead') minLead = Math.min(minLead, E.bossS - E.playerS);
      if (phases.at(-1) !== E.state) phases.push(E.state);
      maxCells = Math.max(maxCells, w.cells.size);
    }
    ok('W2_endlessRun', { phases, tiles: E.tiles, emptyFrames: empty, minLead: +minLead.toFixed(1), maxCells, rebases: w.stats.rebases, pos: loco.feet().toArray().map((v) => +v.toFixed(0)), anchors: w.stats.anchors, bossPin: w.pins.get('boss') ?? null }); }
  // v0.22c: free swinging off the route line (side blocks) → no "too far from the route" recovery
  { const w = a.cityWorld, f0 = loco.feet(); const pr = w.progress(f0.x, f0.z), p0 = w.pointAt(pr.s), p1 = w.pointAt(pr.s + 10);
    const side = new T.Vector3(-(p1.z - p0.z), 0, p1.x - p0.x).normalize();
    let fades = 0, banners = new Set();
    for (const off of [40, 80, 100]) { loco.detach(true); loco.cling = null; loco.placeAt(p0.clone().addScaledVector(side, off).setY(70), null); loco.grounded = false; loco.vel.set(0, 0, 0);
      for (let i = 0; i < 120; i++) { step(1); if (s.fade.a > 0.3) fades++; banners.add(a.hud.banner.text); } }
    ok('W2b_freeOffRoute', { fades, tooFar: [...banners].some((x) => /route|路線/.test(x || '')), cell: !!w.cellAt(loco.feet().x, loco.feet().z), endless: E.state }); }
  // pause: endless frozen
  { s.pause(); const t0 = E.stateTime; step(60); ok('W3_pauseFrozen', E.stateTime === t0); s.resume(); }
  // back to the main menu → no leftovers (story city rebuilt from the start, boss pins / endless gone)
  a.go('modeSelect'); await until(() => a.loader.state === 'hidden', 3000, true); step(5);
  ok('W4_menuClean', { state: a.state, mode: a.cityWorld.mode, endless: E.state, pins: [...a.cityWorld.pins.keys()], attached: !!a.cityWorld.attached, tile0: !!a.cityWorld.tileCell(0), oi: a.cityWorld.oi, door: a.city.factory.doorState ?? null, cells: a.cityWorld.cells.size });
  ok('X_audit', audit);
  // ---- loading failure → error with Retry / Main Menu (never a permanent black screen)
  s.flow.reset(); s.flow.roofFired = true; a.debug.failInteriorLoad = 1; s.enterStage('loadingInterior');
  await until(() => a.loader.state === 'error', 600, true);
  ok('Y_loadError', { loader: a.loader.state, err: window.__t(a.loader.errKey), buttons: a.loader.panel.buttons.map((x) => x.label()) });
  a.loader.panel.buttons[0]?.onClick(); // Retry
  await until(() => a.worldName === 'factory' && s.stage === 'factory', 3000, true);
  ok('Z_retryLoaded', { world: a.worldName, stage: s.stage, loader: a.loader.state });
  // ---- main menu from the interior → the city comes back
  a.menuMain();
  await until(() => a.state === 'modeSelect' && a.loader.state === 'hidden', 3000, true);
  ok('ZA_mainMenu', { state: a.state, world: a.worldName, interior: !!a.interior, citySuspended: a.city.suspended, menu: a.menus.current, fade: +s.fade.a.toFixed(2) });
  // ---- Arcade Mode is played in the factory interior too
  a.startArcade();
  for (let i = 0; i < 4000 && a.arcade.state !== 'playing'; i++) { step(1); if (i % 10 === 0) await new Promise((r) => setTimeout(r, 15)); }
  { const ac2 = a.interior?.toWorld(...FD.INTERIOR.arenaCircle.pos), hv2 = a.interior?.toWorld(...FD.INTERIOR.bossHover);
    ok('ZC_arcadeInFactory', { world: a.worldName, arcade: a.arcade.state, storyArcade: !!a.storyArcade, arena: ac2 ? +a.arenaOrigin.distanceTo(ac2).toFixed(2) : null, bossHome: hv2 ? +a.bossHome.distanceTo(hv2).toFixed(2) : null, chunks: a.cityWorld.cells.size, loader: a.loader.state }); }
  const it0 = a.interior; run(false); step(2);
  a.menus.panels.results.buttons[0].onClick(); // Retry → same interior, no reload
  for (let i = 0; i < 400 && a.arcade.state !== 'playing'; i++) { step(1); if (i % 10 === 0) await new Promise((r) => setTimeout(r, 15)); }
  ok('ZD_arcadeRetry', { arcade: a.arcade.state, sameInterior: a.interior === it0, world: a.worldName });
  a.arcade.stop(); a.go('songSelect');
  await until(() => a.worldName === 'city' && a.loader.state === 'hidden', 3000, true);
  ok('ZE_toSongSelect', { state: a.state, world: a.worldName, interior: !!a.interior });
  // ---- XR session end while inside the interior
  a.go('story'); s.suited = true; s.flow.roofFired = true; s.enterStage('loadingInterior');
  await until(() => a.worldName === 'factory', 3000, true);
  a._onSessionEnd(); step(3);
  ok('ZB_sessionEnd', { state: a.state, world: a.worldName, interior: !!a.interior, citySuspended: a.city.suspended, chunks: a.cityWorld.cells.size });
  } catch (e) { out.ERROR = `${e.message} ${String(e.stack).split('\n').slice(0, 3).join(' | ')}`; }
  a.frame = frame;
  return out;
});
for (const [k, v] of Object.entries(r)) console.log(k.padEnd(22), JSON.stringify(v));
console.log('errors', errors);
await b.close();
