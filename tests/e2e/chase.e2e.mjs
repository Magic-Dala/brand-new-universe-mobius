// Chase state-machine e2e (real app in the browser, deterministic stepping).
// Needs `npm run dev` running. Usage: node tests/e2e/chase.e2e.mjs
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
  const a = window.__mobius, s = a.story, T = window.__THREE, loco = a.locomotion;
  const L = await import('/src/data/layout.js');
  (await import('/src/core/settings.js')).settings.storyCombat = false; // v0.47: these checks pin the v0.46 Story chase; the Story chase combat has its own checks in storycombat.e2e.mjs
  const { routePoint, routeHeight } = await import('/src/game/chase.js');
  const frame = a.frame.bind(a); a.frame = () => {};
  const step = (n = 1) => { for (let i = 0; i < n; i++) { a.hub.events.length = 0; frame(1 / 60, 0, null); } };
  const out = {}; const ok = (k, v) => { out[k] = v; };
  const hold = (pos) => { loco.detach(true); loco.placeAt(pos, null); loco.grounded = false; loco.cling = { building: 'X', normal: new T.Vector3(1, 0, 0) }; };
  const movePlayerTo = (sv, y) => { const q = routePoint(sv); q.y = y ?? routeHeight(sv); hold(q); };
  // --- jump straight to the window stage, suited
  a.go('story'); s.suited = true; a.setArmored(true); s.enterStage('window'); step(5);
  ok('stage0', s.stage);
  // approaching the window without pushing must NOT trigger
  const o = L.ROOM.origin; loco.placeAt(new T.Vector3(o[0], o[1], o[2] - 2.4), 0); step(60);
  ok('nearWindowNoTrigger', s.stage === 'window' && !s.chaseCtl.active);
  // push the sashes open (simulate the hand pushing through the frame)
  a.hub.desk.keys.add('KeyG'); step(50); a.hub.desk.keys.delete('KeyG'); step(1);
  ok('openedAngles', a.room.parts.windowSashes.map((w) => +w.angle.toFixed(2)));
  ok('chaseStarted', s.stage === 'chase' && s.chaseCtl.state);
  // re-trigger window logic: must not restart the flyby
  const st0 = s.chaseCtl.stateTime; s._s_window(); step(1);
  ok('noDoubleFlyby', s.chaseCtl.state === 'bossFlyby' && s.chaseCtl.stateTime > st0);
  ok('bannerZh', a.hud.banner.text);
  // flyby: boss passes close in front of the window
  let minD = 1e9; for (let i = 0; i < 60 * 5.2; i++) { step(1); minD = Math.min(minD, a.boss.root.position.distanceTo(new T.Vector3(o[0], o[1] + 1.6, o[2] - 3))); }
  ok('flybyClosest_m', +minD.toFixed(1)); ok('afterFlyby', s.chaseCtl.state);
  // player still in the room → boss waits ahead (hover), not running away
  step(240); const c = s.chaseCtl;
  ok('waitWhileInRoom_gap', +(c.bossS - c.playerS).toFixed(1));
  // leave the room & progress along the route; sample the boss lead
  const leads = []; let sp = 10;
  s.inRoom = false; loco.ignoreColliders = new Set();
  while (sp < L.ROUTE.sTurn - 60) { movePlayerTo(sp); step(6); leads.push(+(c.bossS - c.playerS).toFixed(1)); sp += 1.6; }
  ok('bossLeadMinMax', [Math.min(...leads), Math.max(...leads)]); ok('leads', leads.filter((_, i) => i % 8 === 0)); ok('stateBeforeTurn', c.state);
  ok('tileReady', [0,1,2,3,4,5,6,7].map((k) => { const cc = a.cityWorld.tileCell(k); return cc ? (cc.ready ? 'R' : 'n') : '-'; }).join('')); ok('bossLimit', [c.bossLimit(), c.bossS]);
  ok('streaming', { cells: a.cityWorld.stats.cells, unreadyHere: !a.cityWorld.cellAt(loco.feet().x, loco.feet().z)?.ready, curTile: a.cityWorld.curTile, bossPin: a.cityWorld.pins.get('boss') });
  // land on C early (before making the turn): must not open the circle stage
  const C = L.KEY_BUILDINGS[1];
  const CC = L.CITY.colliderOf('C');
  loco.cling = null; loco.placeAt(new T.Vector3(...L.STORY.exploreSpawn.pos), null); loco._landRoof(CC);
  step(60); ok('earlyOnC_state', c.state); ok('earlyOnC_hint', a.hud.banner.text); ok('earlyOnC_cp', c.cp.id);
  movePlayerTo(sp); step(10);
  // stop for a while: boss must hover (lead bounded), never jump away
  const b0 = c.bossS; step(300); ok('stoppedLeadGrowth', +(c.bossS - b0).toFixed(1));
  // approach the turn → right-turn state + banner
  while (sp < L.ROUTE.sTurn - 40) { movePlayerTo(sp); step(4); sp += 1.6; }
  ok('turnState', c.state); ok('turnBanner', a.hud.banner.text);
  // v0.22c fall: landing on the street is NOT a respawn (hint only); a 10 s fall with no anchor is
  movePlayerTo(sp); step(2); loco.cling = null; loco.grounded = false; loco.vel.set(0, -10, 0);
  for (let i = 0; i < 900 && !loco.grounded; i++) step(1);
  step(60); ok('afterStreet', { state: c.state, grounded: loco.grounded, feetY: +loco.feet().y.toFixed(1), banner: a.hud.banner.text, fade: +s.fade.a.toFixed(2) });
  { const { settings } = await import('/src/core/settings.js'); const tf = settings.thrusterMaxFall; settings.thrusterMaxFall = 1.5; // slow fall from high up
    const q = routePoint(sp); q.y = 170; loco.detach(true); loco.cling = null; loco.placeAt(q, null); loco.grounded = false; loco.vel.set(0, 0, 0);
    let fellAt = -1; for (let i = 0; i < 60 * 12 && fellAt < 0; i++) { step(1); if (s.fade.a > 0.5) fellAt = i / 60; }
    settings.thrusterMaxFall = tf; step(200);
    ok('after10sFall', { respawnAt_s: +fellAt.toFixed(1), state: c.state, cp: c.cp.id, cling: !!loco.cling }); }
  // finish the route: turn + east leg
  while (sp < L.ROUTE.length - 6) { movePlayerTo(sp); step(4); sp += 1.6; }
  step(360); ok('approachState', c.state); ok('circleVisible', c.circle.visible);
  // v0.21: Green Maniac waits over the circle; standing / skimming in the circle never triggers anything
  const cp = L.STORY.circle.pos;
  loco.cling = null; loco.detach(true); loco.placeAt(new T.Vector3(cp[0] - 6, C.h + 1.5, cp[2]), null); loco.grounded = false; loco.vel.set(9, 0, 0);
  step(50); ok('skimNoTrigger', { state: c.state, stage: s.stage });
  loco.placeAt(new T.Vector3(cp[0] + 0.3, C.h, cp[2] - 0.2), null); loco._landRoof(CC);
  step(240); ok('standInCircleNoTrigger', { state: c.state, stage: s.stage, roofFired: s.flow.roofFired, objective: s.currentObjective });
  // pause: nothing advances
  s.pause(); const bs = c.bossS, bpos = a.boss.root.position.clone(); step(120); ok('pausedFrozen', c.bossS === bs && a.boss.root.position.distanceTo(bpos) < 1e-6); s.resume();
  // web at Green Maniac → dash → contact → kick → roof event
  const org = loco.feet().add(new T.Vector3(0, 1.3, 0)), tgt = c.bossBody(new T.Vector3());
  c._handleWebs({ events: [{ type: 'web', hand: 'right', origin: org, dir: tgt.clone().sub(org).normalize() }] }, loco);
  ok('dashStarted', { state: c.state, flow: s.flowState });
  for (let i = 0; i < 240 && s.stage === 'chase'; i++) step(1);
  ok('final', { stage: s.stage, flow: s.flowState, kicks: c.cstats.kicks, roofFired: s.flow.roofFired, riding: a.boss.riding });
  a.frame = frame;
  return out;
});
for (const [k, v] of Object.entries(r)) console.log(k.padEnd(22), JSON.stringify(v));
console.log('errors', errors);
await b.close();
