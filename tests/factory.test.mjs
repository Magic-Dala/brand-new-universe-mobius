// Factory C (exterior roof event) + the separate factory interior: layout & rules.
import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.localStorage = { getItem: () => null, setItem() {} };
const THREE = await import('three');
const L = await import('../src/data/layout.js');
const { INTERIOR, interiorSurface, clearance } = await import('../src/data/factory.js');
const { worldToBox, inFootprint } = await import('../src/data/box.js');
const { CityWorld } = await import('../src/data/cityWorld.js');
const { FLOW_STATES, rigInside } = await import('../src/game/factoryFlow.js');
const { Locomotion } = await import('../src/game/locomotion.js');
const { fakeApp } = await import('./route.test.mjs');
const { KEY_BUILDINGS, FACTORY_EXT, STORY, FACTORY_TILE, EXIT_TILE } = L;
const C = KEY_BUILDINGS[1];
const CITY = new CityWorld({ autoReady: true }); CITY.reset({ mode: 'story' });
CITY.update({ x: STORY.circle.pos[0], y: 30, z: STORY.circle.pos[2] }, undefined, 1 / 60, { force: true });
const inRect = (q, x, z, pad = 0) => x > q.x0 - pad && x < q.x1 + pad && z > q.z0 - pad && z < q.z1 + pad;

test('exterior: C is a low factory in the factory block (end of the story route), taller city around it, no upper city', () => {
  assert.equal(C.style, 'industrial');
  assert.ok(C.h > 15 && C.h < 30, `roof ${C.h} m`);
  const cell = CITY.tileCell(FACTORY_TILE);
  const wc = cell.buildings.find((b) => b.id === 'C');
  assert.ok(wc && Math.abs(wc.x - C.x) < 1e-6 && Math.abs(wc.z - C.z) < 1e-6 && Math.abs(wc.h - C.h) < 1e-6, 'layout C = generated C');
  const near = [...CITY.cells.values()].flatMap((c) => c.buildings).filter((b) => b.id !== 'C' && Math.hypot(b.x - C.x, b.z - C.z) < 90);
  assert.ok(near.filter((b) => b.h > 50).length >= 3, 'tall buildings around');
  assert.ok(near.every((b) => b.y0 === 0), 'all buildings stand on the ground (no inverted city)');
  assert.ok(CITY.route.tiles[EXIT_TILE].kind === 'factoryExit', 'exit connector after the factory');
  const ex = STORY.exitSpawn.pos, [, bz] = worldToBox(C, ex[0], ex[2]);
  assert.ok(!inFootprint(C, ex[0], ex[2]) && bz < -C.hd, 'exit spawn outside the roll-up door (box −Z side)');
});
test('roof circle: flat safe area (≥ 6 m from edges, clear of equipment), directly above the breakable section', () => {
  const c = STORY.circle.pos, [bx, bz] = worldToBox(C, c[0], c[2]);
  assert.ok(Math.abs(c[1] - C.h) < 1e-6, 'on the roof surface');
  assert.ok(C.hw - Math.abs(bx) >= 6 && C.hd - Math.abs(bz) >= 6, 'away from the edges');
  const r = STORY.circle.radius;
  for (const q of FACTORY_EXT.equipment) assert.ok(!inRect(q, bx, bz, r + 1.5), `equipment ${JSON.stringify(q)} too close`);
  const s = FACTORY_EXT.stack; assert.ok(Math.hypot(bx - s.local[0], bz - s.local[1]) > 8, 'stack far from the circle');
  const B = FACTORY_EXT.breach;
  assert.ok(Math.abs(bx - B.local[0]) + r <= B.hw && Math.abs(bz - B.local[1]) + r <= B.hd, 'circle sits on the breakable section');
  assert.ok(C.hw - Math.abs(B.local[0]) - B.hw >= 2 && C.hd - Math.abs(B.local[1]) - B.hd >= 2, 'section away from the roof edges');
});
test('interior: 22 × 36 × 14 m hall, PLAYER START on the centre line, Green Maniac in front of the north door 15–18 m away', () => {
  assert.deepEqual(INTERIOR.size, { w: 22, d: 36, h: 14 });
  const a = INTERIOR.arenaCircle.pos, hv = INTERIOR.bossHover;
  assert.ok(Math.abs(a[0]) < 1 && a[2] > 0, 'arena circle on the centre line, south half');
  assert.ok(hv[2] < -12 && hv[2] > -17 && hv[1] < INTERIOR.size.h - 3, 'boss hover in front of the roll-up door, under the roof');
  const d = Math.hypot(a[0] - hv[0], a[2] - hv[2]); assert.ok(d >= 15 && d <= 18, `circle → boss ${d.toFixed(1)} m`);
  const cf = INTERIOR.combatFloor; assert.ok(cf.z1 - cf.z0 >= 18, 'combat floor ≥ 18 m long');
  for (const b of INTERIOR.blockers) assert.ok(b.x1 <= cf.x0 || b.x0 >= cf.x1 || b.z1 <= cf.z0 || b.z0 >= cf.z1, `blocker ${b.kind} inside the combat floor`);
  assert.ok(clearance(a[0], a[2]) > INTERIOR.arenaCircle.radius + 0.5, 'circle clear of props');
});
test('interior spawn: under the breach, near but clear of the SW debris and the machines', () => {
  const sp = INTERIOR.spawn.pos, B = INTERIOR.breach;
  assert.ok(Math.abs(sp[0] - B.x) < B.hw && Math.abs(sp[2] - B.z) < B.hd, 'under the breach');
  assert.ok(clearance(sp[0], sp[2]) >= 1.0, `clearance ${clearance(sp[0], sp[2]).toFixed(2)} m`);
  const deb = INTERIOR.blockers.find((b) => b.kind === 'debris');
  assert.ok(deb.x0 < -6 && deb.z1 > 15, 'debris in the SW corner');
  const dd = Math.hypot(Math.max(deb.x0 - sp[0], 0, sp[0] - deb.x1), Math.max(deb.z0 - sp[2], 0, sp[2] - deb.z1)); assert.ok(dd < 6, 'spawn near the debris');
  const a = INTERIOR.arenaCircle.pos; assert.ok(Math.hypot(sp[0] - a[0], sp[2] - a[2]) > INTERIOR.arenaCircle.radius + 1, 'spawn is not already inside the arena circle');
  const e = INTERIOR.bossEntry[0]; assert.ok(Math.abs(e[0] - B.x) < B.hw && Math.abs(e[2] - B.z) < B.hd && e[1] > INTERIOR.size.h, 'boss enters through the breach from above');
  const S = interiorSurface(); assert.ok(!S.blockers.some((q) => inRect(q, sp[0], sp[2])) && !S.blockers.some((q) => inRect(q, a[0], a[2])), 'spawn + circle are valid teleport spots');
});
test('state machine: the explicit order of the factory flow', () => {
  assert.deepEqual(FLOW_STATES, ['Chase', 'JetTether', 'TetherCounter', 'FactoryRoofApproach', 'RoofStandoff', 'RoofWebDash', 'KickAndLand', 'BossBombThrow', 'RoofExplosion', 'ShortFall', 'FadeToBlack', 'LoadingInterior', 'InteriorArrival', 'AwaitArenaCircle', 'BossEncounter', 'BossEscape', 'FollowToDoor', 'ExitTransition', 'EndlessChase', 'EndlessSwing']);
});
test('circle rule: the rig ORIGIN must be inside (head-only entry does not count)', () => {
  const c = STORY.circle.pos;
  assert.equal(rigInside({ x: c[0] + 0.5, z: c[2] }, c, 1.5), true);
  assert.equal(rigInside({ x: c[0] + 2.0, z: c[2] }, c, 1.5), false); // head leaned in, feet outside
});
test('roof collision: intact roof holds the player; the blown section has no collision; equipment blocks teleport', () => {
  const app = fakeApp(CITY), loco = new Locomotion(app);
    const c = STORY.circle.pos, B = FACTORY_EXT.breach;
  const drop = () => { loco.setCityMode([]); loco.placeAt(new THREE.Vector3(c[0], C.h + 1.5, c[2])); loco.grounded = false; loco.vel.set(0, 0, 0); for (let i = 0; i < 120; i++) { loco.update(1 / 72, i / 72); } return loco.feet().y; };
  assert.ok(Math.abs(drop() - C.h) < 0.05, 'lands on the intact roof');
  loco.setRoofHole('C', { x0: B.local[0] - B.hw, x1: B.local[0] + B.hw, z0: B.local[1] - B.hd, z1: B.local[1] + B.hd });
  { const y = drop(); assert.ok(y < C.h - 1, `falls through the hole (y=${y.toFixed(2)})`); }
  loco.setRoofHole('C', null);
  loco.setRoofBlockers('C', FACTORY_EXT.equipment);
  loco._landRoof(CITY.colliderOf('C'));
  const q = FACTORY_EXT.equipment[0];
  const w = new THREE.Vector3(); { const bx = (q.x0 + q.x1) / 2, bz = (q.z0 + q.z1) / 2; w.set(C.x + bx * C.cos + bz * C.sin, C.h, C.z - bx * C.sin + bz * C.cos); }
  assert.equal(loco._validLanding(w), false, 'teleport onto the roof equipment is refused');
  assert.equal(loco._validLanding(new THREE.Vector3(c[0], C.h, c[2])), true, 'the circle is a valid teleport target');
});
