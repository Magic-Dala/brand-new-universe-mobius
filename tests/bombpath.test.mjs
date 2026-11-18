// v1.1 chase pumpkins: the flight path preview and the soft tracking (pure pieces, ChaseBombs, and a seeded simulation
// of scripted players: v1.0.0 = tracking off beside v1.1.0 = tracking on). Run directly to print only the table:
//   node tests/bombpath.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.performance = globalThis.performance || { now: () => Date.now() };
const THREE = await import('three');
const { trackedAim, steer, tracking, passedPlayer, samplePath } = await import('../src/game/bombPath.js');
const { BOMB_PATH } = await import('../src/data/bombPath.js');
const { ChaseBombs, bombAimPoint, launchVelocity, flightTimeFor } = await import('../src/game/chaseBombs.js');
const { BombPathFx } = await import('../src/game/bombPathFx.js');
const { STORY_COMBAT } = await import('../src/data/storyCombat.js');
const { CHASE_COMBAT } = await import('../src/worlds/chaseCombat.js');
const { FIGHT } = await import('../src/worlds/bossFight.js');
const { settings } = await import('../src/core/settings.js');
const { mulberry32 } = await import('../src/data/box.js');
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const CFG = { ...STORY_COMBAT.bombs, ...CHASE_COMBAT.bombs, maxActive: 4, giantScale: FIGHT.heavy.scale, swept: true }; // the World Chase / Story chase pool
const K = { ...BOMB_PATH.tracking, leadFactor: CFG.leadFactor, maxLead: CFG.maxLead };

// ------------------------------------------------------------------------------------------------ pure pieces
test('trackedAim: today\'s limited lead for the time left, plus the offset, never more than maxShift from the release aim', () => {
  const aim0 = V(0, 10, 0), chest = V(0, 10, 0);
  assert.ok(trackedAim(aim0, chest, V(0, 0, 0), 1, null, K).distanceTo(chest) < 1e-9, 'a standing player: the chest');
  const a = trackedAim(aim0, chest, V(30, 0, 0), 2, null, K);
  assert.ok(Math.abs(a.x - K.maxLead) < 1e-9, 'lead capped at maxLead');
  assert.ok(Math.abs(trackedAim(aim0, chest, V(2, 0, 0), 1, null, K).x - 2 * K.leadFactor) < 1e-9, 'lead = vel · tRem · leadFactor');
  assert.ok(Math.abs(trackedAim(aim0, chest, V(0, 0, 0), 1, V(0, 0, 2.6), K).z - 2.6) < 1e-9, 'the spread offset is kept');
  const far = trackedAim(aim0, V(50, 10, 0), V(0, 0, 0), 1, null, K);
  assert.ok(Math.abs(far.distanceTo(aim0) - K.maxShift) < 1e-9, 'clamped to maxShift');
});
test('steer: toward the velocity that reaches the aim in the time left, by at most accel · dt', () => {
  const pos = V(0, 20, 40), vel = V(0, 3, -20), aim = V(6, 10, 0), out = V();
  steer(pos, vel, aim, 1.5, 6, 12, 1 / 60, out);
  assert.ok(Math.abs(out.distanceTo(vel) - 12 / 60) < 1e-9, 'changed by exactly accel · dt when far off');
  const want = launchVelocity(pos, aim, 1.5, 6, V());
  steer(pos, want.clone(), aim, 1.5, 6, 12, 1 / 60, out);
  assert.ok(out.distanceTo(want) < 1e-9, 'already on course: unchanged');
  const v2 = vel.clone(); for (let i = 0; i < 600; i++) steer(pos, v2, aim, 1.5, 6, 12, 1 / 60, v2);
  assert.ok(v2.distanceTo(want) < 1e-6, 'converges on the wanted velocity');
});
test('tracking: ends in the let-go window (time or distance) and once the pumpkin has passed the player', () => {
  assert.equal(tracking(1.0, 20, false, K), true);
  assert.equal(tracking(K.letGo, 20, false, K), false, 'let-go time');
  assert.equal(tracking(1.0, K.letGoDist, false, K), false, 'let-go distance');
  assert.equal(tracking(1.0, 20, true, K), false, 'passed');
  assert.equal(passedPlayer(V(0, 5, 10), V(0, 0, -10), V(0, 5, 0)), false, 'flying toward the player');
  assert.equal(passedPlayer(V(0, 5, -1), V(0, 0, -10), V(0, 5, 0)), true, 'gone by');
});
test('samplePath: n points of the remaining ballistic flight, first = here, last = the arrival', () => {
  const pos = V(1, 20, 40), aim = V(0, 10, 0), T = 1.8, g = 6, vel = launchVelocity(pos, aim, T, g, V()), out = new Float32Array(24 * 3);
  samplePath(pos, vel, g, T, 24, out);
  assert.ok(V(out[0], out[1], out[2]).distanceTo(pos) < 1e-5);
  assert.ok(V(out[69], out[70], out[71]).distanceTo(aim) < 1e-4, 'ends at the aim point');
});

// ------------------------------------------------------------------------------------------------ ChaseBombs in a fake app
function fakeApp() {
  const scene = new THREE.Scene();
  const app = { scene, cityWorld: null, flashes: 0, flashDamage() { this.flashes++; }, hub: { haptic() {} }, fx: { boom() {}, web() {}, net() {} } };
  return app;
}
function mkBombs(app = fakeApp()) { const b = new ChaseBombs(app, CFG); b.world = null; return b; }

test('constraint 2.7: tracking and path off → every pumpkin flies exactly as in v1.0.0 (same positions, same seed)', () => {
  settings.bombTracking = false; settings.bombPath = false;
  try {
    const R = mulberry32(2027);
    for (let trial = 0; trial < 40; trial++) {
      const B = mkBombs(), chest = V(0, 12 + R() * 8, 0), vel = V((R() - 0.5) * 8, (R() - 0.5) * 4, 15 + R() * 10);
      const from = V((R() - 0.5) * 6, chest.y + R() * 4, 14 + R() * 46);
      const it = B._get(); it.pos.copy(from); const T = 1.5 + R(); B._launch(it, chest, vel, { T });
      // v1.0.0 flight, written out here: aim once, then the same semi-implicit Euler steps as ChaseBombs.update
      const p = from.clone(), v = launchVelocity(from, bombAimPoint(chest, vel, T, CFG, V()), T, CFG.gravity, V());
      for (let f = 0; f < 400 && it.active; f++) {
        chest.addScaledVector(vel, 1 / 60); vel.x += (R() - 0.5) * 4; // the player keeps moving (tracking would follow)
        v.y -= CFG.gravity / 60; p.addScaledVector(v, 1 / 60);
        B.update(1 / 60, { allow: false, boss: null, chest, playerVel: vel });
        if (it.active) assert.ok(it.pos.x === p.x && it.pos.y === p.y && it.pos.z === p.z, `trial ${trial} frame ${f}: identical position`);
      }
      assert.equal(B.paths.count, 0, 'no path drawn');
    }
  } finally { settings.bombTracking = true; settings.bombPath = true; }
});

test('preview: a held pumpkin with a plan and a flying pumpkin each draw one path, never within fadeNear of the head; gone when recycled', () => {
  const app = fakeApp(), B = mkBombs(app), fx = BombPathFx.for(app), chest = V(0, 10, 0), vel = V(0, 0, 0);
  const held = B._get(); held.phase = 'held'; held.pos.set(0, 14, 30); B.planHeld(held, 1.8, null, CFG.gravity, 0.5);
  B.update(1 / 60, { allow: false, boss: null, chest, playerVel: vel });
  assert.equal(fx.count, 1, 'the held pumpkin\'s path'); assert.ok(fx.mesh.visible);
  const P = BOMB_PATH.preview, rec = B.paths.recs[0];
  assert.ok(Math.abs(rec.alpha - P.opacity.held * 0.5) < 1e-9, 'fades in over the telegraph');
  const last = V().fromArray(rec.pts, (rec.n - 1) * 3); assert.ok(last.distanceTo(chest) < 0.01, 'held path ends at the aim point (the chest of a standing player)');
  const before = V().fromArray(rec.pts, 6);
  B._launch(held, chest, vel, { T: 1.8 }); B.update(1 / 60, { allow: false, boss: null, chest, playerVel: vel });
  assert.equal(fx.count, 1, 'held → flying: still one path');
  assert.ok(V().fromArray(rec.pts, 6).distanceTo(before) < 0.6, 'no jump at the release');
  for (let i = 0; i < 400 && held.active; i++) {
    B.update(1 / 60, { allow: false, boss: null, chest, playerVel: vel });
    if (fx.count) assert.ok(fx.stats.minDist >= P.fadeNear - 1e-6, `nothing within fadeNear (${fx.stats.minDist.toFixed(2)} m)`);
  }
  assert.equal(held.active, false); assert.equal(fx.count, 0, 'the path is gone with the pumpkin'); assert.equal(fx.mesh.visible, false, 'no draw call when nothing shows');
  const it = B._get(); it.pos.set(0, 14, 30); B._launch(it, chest, vel, { T: 1.8 }); B.update(1 / 60, { allow: false, boss: null, chest, playerVel: vel });
  assert.equal(fx.count, 1);
  B.shootDown(it, V(0, 10, 0), 'web'); assert.equal(fx.count, 0, 'shot down: gone at once (between frames)');
  const h2 = B._get(); h2.phase = 'held'; h2.pos.set(0, 14, 30); B.planHeld(h2, 1.8, null, CFG.gravity, 1); B.update(1 / 60, { allow: false, boss: null, chest, playerVel: vel });
  assert.equal(fx.count, 1); B._free(h2); assert.equal(fx.count, 0, 'a cancelled telegraph removes it at once');
});

test('tracking: the arrival time stays T (±0.15 s), a tracked pumpkin keeps its spread offset, the aim never moves more than maxShift', () => {
  const B = mkBombs(), chest = V(0, 12, 0), vel = V(0, 0, 18);
  const lat = V(1, 0, 0), its = [0, 1, 2].map((i) => { const it = B._get(); it.pos.set(0, 15, 40); B._launch(it, chest, vel, { T: FIGHT.spread.flight + 0.08 * Math.abs(i - 1), offset: lat.clone().multiplyScalar((i - 1) * FIGHT.spread.lateral) }); return it; });
  const aim0 = its.map((it) => it.aim0.clone()); let maxShift = 0, t = 0;
  const closest = its.map(() => ({ d: Infinity, t: 0 }));
  for (let f = 0; f < 240 && its.some((it) => it.active); f++) {
    chest.addScaledVector(vel, 1 / 60); t += 1 / 60;
    if (t > 0.5) vel.set(0, -6, 10); // the swing fails half a second in: he falls
    B.update(1 / 60, { allow: false, boss: null, chest, playerVel: vel });
    its.forEach((it, i) => { if (!it.active) return; maxShift = Math.max(maxShift, it.target.distanceTo(aim0[i])); const d = it.pos.distanceTo(it.target); if (d < closest[i].d) closest[i] = { d, t }; });
    if (f === 30) { const d01 = its[0].target.distanceTo(its[1].target), d12 = its[1].target.distanceTo(its[2].target); assert.ok(Math.abs(d01 - FIGHT.spread.lateral) < 0.5 && Math.abs(d12 - FIGHT.spread.lateral) < 0.5, `spread stays ${FIGHT.spread.lateral} m apart (${d01.toFixed(2)}, ${d12.toFixed(2)})`); }
  }
  assert.ok(maxShift <= K.maxShift + 1e-9, `aim moved at most ${maxShift.toFixed(2)} m`);
  its.forEach((it, i) => assert.ok(Math.abs(closest[i].t - it.T) <= 0.15 || closest[i].d > 1, `pumpkin ${i}: arrives at ${closest[i].t.toFixed(2)} s for T ${it.T.toFixed(2)} s`));
});

// ------------------------------------------------------------------------------------------------ the seeded simulation (Goal 3.3)
const CASES = ['steady', 'failed', 'stall', 'slow', 'dodge'];
/**
 * One volley thrown from `dist` m ahead of a scripted player; returns [hits, pumpkins]. The player swings along +z.
 *   steady: 15–25 m/s along the route (a gentle swing bob), no shooting
 *   failed: steady up to the release, then lets go: falls (gravity, the thrusters cap the fall at 11 m/s), lands, stands
 *   slow:   under 4 m/s, any direction, on a roof
 *   dodge:  steady, then 10 m/s sideways for the last 0.45 s before arrival
 */
function volley(kind, mode, R, over = null) {
  const B = mkBombs(); if (over) Object.assign(B.trackCfg, over); let hits = 0; B.onPlayerHit = () => { hits++; };
  const h = mode === 'failed' || mode === 'stall' ? 4 + R() * 16 : 6 + R() * 20, dist = 14 + R() * 46;
  const chest = V(0, h, 0), vel = V(), side = R() < 0.5 ? -1 : 1;
  const speed = mode === 'slow' ? R() * 4 : mode === 'stall' ? R() * 8 : 15 + R() * 10, ang = R() * Math.PI * 2, bob = R() * Math.PI * 2;
  if (mode === 'slow') vel.set(Math.cos(ang) * speed, 0, Math.sin(ang) * speed); else vel.set(0, 1.5 * 3.9 * Math.cos(bob), speed);
  const from = V((R() - 0.5) * 6, h + (R() - 0.3) * 6, dist);
  const n = kind === 'spread' ? 3 : 1, its = [];
  const d = V(chest.x - from.x, 0, chest.z - from.z).normalize(), lat = V(-d.z, 0, d.x);
  for (let i = 0; i < n; i++) {
    const it = B._get(); it.pos.copy(from);
    if (kind === 'spread') B._launch(it, chest, vel, { T: FIGHT.spread.flight + 0.08 * Math.abs(i - 1), offset: lat.clone().multiplyScalar((i - 1) * FIGHT.spread.lateral) });
    else B._launch(it, chest, vel, { T: THREE.MathUtils.clamp(flightTimeFor(from.distanceTo(chest), CFG), FIGHT.single.flight[0], FIGHT.single.flight[1]) });
    its.push(it);
  }
  const T = Math.max(...its.map((it) => it.T));
  let t = 0, falling = mode === 'failed' || mode === 'stall', dodged = false;
  for (let f = 0; f < 60 * 6 && its.some((it) => it.active); f++) {
    const dt = 1 / 60; t += dt;
    if (mode === 'steady' || mode === 'dodge') vel.y = 1.5 * 3.9 * Math.cos(bob + 3.9 * t);
    if (mode === 'dodge' && !dodged && t >= T - 0.45) { dodged = true; vel.x += side * 10; }
    if (falling) { vel.y = Math.max(-11, vel.y - 9.8 * dt); vel.x *= 1 - 0.05 * dt; vel.z *= 1 - 0.05 * dt; }
    chest.addScaledVector(vel, dt);
    if (falling && chest.y <= 1.3) { chest.y = 1.3; vel.set(0, 0, 0); falling = false; } // lands and stands
    B.update(dt, { allow: false, boss: null, chest, playerVel: vel });
  }
  return [hits > 0 ? 1 : 0, hits, n]; // a volley hits when any of its pumpkins hits (a spread's outer two are meant to miss a player who stays put)
}
export function simulate(throws = 240, seed = 0x11, over = null, modes = CASES) {
  const rows = [];
  for (const kind of ['single', 'spread']) for (const mode of modes) {
    const out = { kind, mode };
    for (const trk of [false, true]) {
      settings.bombTracking = trk; const R = mulberry32(seed + CASES.indexOf(mode) * 101 + (kind === 'spread' ? 7 : 0));
      let v = 0, h = 0, n = 0; for (let k = 0; k < throws; k++) { const [a, b, c] = volley(kind, mode, R, over); v += a; h += b; n += c; }
      out[trk ? 'v11' : 'v10'] = (100 * v) / throws; out[trk ? 'p11' : 'p10'] = (100 * h) / n; out.n = throws; out.np = n;
    }
    rows.push(out);
  }
  settings.bombTracking = true;
  return rows;
}
const WANT = { steady: 'within ±10 points', failed: '≥ 60 %', stall: '(extra case)', slow: '≥ 85 %', dodge: '≤ 15 %' };
export function printTable(rows) {
  const lines = ['attack  case     volleys  v1.0.0 volley / pumpkin   v1.1.0 volley / pumpkin   target   (v1.0.0 = tracking off, v1.1.0 = tracking on)'];
  for (const r of rows) lines.push(`${r.kind.padEnd(7)} ${r.mode.padEnd(8)} ${String(r.n).padStart(7)}  ${r.v10.toFixed(1).padStart(8)} % / ${r.p10.toFixed(1).padStart(5)} %     ${r.v11.toFixed(1).padStart(8)} % / ${r.p11.toFixed(1).padStart(5)} %    ${WANT[r.mode]}`);
  return lines.join('\n');
}
/** Which targets of Goal 3.3 hold (a spread is judged per pumpkin for the late dodge: its outer two cover the dodge on purpose). */
export function verdicts(rows) {
  return rows.filter((r) => r.mode !== 'stall').map((r) => {
    const ok = r.mode === 'steady' ? Math.abs(r.v11 - r.v10) <= 10 : r.mode === 'failed' ? r.v11 >= 60 : r.mode === 'slow' ? r.v11 >= 85 : (r.kind === 'spread' ? r.p11 : r.v11) <= 15;
    return { kind: r.kind, mode: r.mode, ok };
  });
}

test('simulation (Goal 3.3): ≥ 200 throws per case, 14–60 m, single and spread (v1.0.0 beside v1.1.0)', () => {
  const rows = simulate(240), v = verdicts(rows);
  console.log(printTable(rows));
  console.log(v.map((x) => `${x.ok ? 'MET    ' : 'NOT MET'} ${x.kind} ${x.mode}`).join('\n'));
  for (const x of v) if (x.mode !== 'failed') assert.ok(x.ok, `${x.kind} ${x.mode}`);
  // the failed swing cannot reach 60 % inside the fixed limits of constraint 2.4 (the next test shows why): it must not
  // get worse than v1.0.0, and the slow fall (a stalled swing) must clearly improve. Reported, and listed to tune.
  for (const r of rows) if (r.mode === 'failed' || r.mode === 'stall') assert.ok(r.v11 >= r.v10, `${r.kind} ${r.mode}: ${r.v10.toFixed(1)} → ${r.v11.toFixed(1)}`);
  for (const r of rows) if (r.mode === 'stall') assert.ok(r.v11 >= r.v10 + 15, `${r.kind} stall improves`);
});

test('failed swing (Goal 3.3): 60 % needs limits beyond constraint 2.4, so the fixed limits are kept and the gap is reported', () => {
  // The same seeded failed-swing volleys, re-run with the hard limits relaxed (test only; the game keeps BOMB_PATH).
  // Shows which limit holds the hit rate down: a player who lets go at 15–25 m/s keeps most of that speed (air drag
  // 0.05/s) and lands 20–40 m from where he was at the release, while the aim may move at most maxShift = 8 m.
  const variants = [
    ['shipped: maxShift 8 m, letGo 0.45 s / 6 m', {}],
    ['maxShift 16 m', { maxShift: 16 }],
    ['maxShift 24 m', { maxShift: 24 }],
    ['maxShift 32 m', { maxShift: 32 }],
    ['maxShift unlimited', { maxShift: 1e9 }],
    ['maxShift unlimited, accel ×3', { maxShift: 1e9, accel: { normal: 36, giant: 18 } }],
    ['maxShift unlimited, accel ×3, letGo 0.2 s / 3 m', { maxShift: 1e9, accel: { normal: 36, giant: 18 }, letGo: 0.2, letGoDist: 3 }],
    ['all of the above + full lead (not the 3.2 aim)', { maxShift: 1e9, accel: { normal: 36, giant: 18 }, letGo: 0.2, letGoDist: 3, leadFactor: 1, maxLead: 1e9 }],
  ];
  const lines = ['failed swing, 240 volleys each      single   spread (volley)   (tracking off: v1.0.0)'];
  const got = variants.map(([name, over]) => {
    const rows = simulate(240, 0x11, over, ['failed']);
    const s = rows.find((r) => r.kind === 'single'), p = rows.find((r) => r.kind === 'spread');
    lines.push(`${name.padEnd(48)} ${s.v11.toFixed(1).padStart(5)} %  ${p.v11.toFixed(1).padStart(5)} %   (${s.v10.toFixed(1)} % / ${p.v10.toFixed(1)} %)`);
    return { name, single: s.v11, spread: p.v11 };
  });
  console.log(lines.join('\n'));
  const shipped = got[0];
  assert.ok(shipped.single < 60 && shipped.spread < 60, 'inside the limits the target is not reached (reported as NOT MET)');
  assert.ok(got.some((g, i) => i > 0 && g.single > shipped.single + 10), 'relaxing maxShift, a hard limit, is what raises the hit rate');
});
