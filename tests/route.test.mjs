// Story chase route in the modular city: geometry, open corridor, anchor coverage and a physics
// swing-bot run from the window to the factory roof C (with streaming).
import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.performance = globalThis.performance || { now: () => Date.now() };
const THREE = await import('three');
const { routeProgress, routePoint, routeHeight } = await import('../src/game/chase.js');
const L = await import('../src/data/layout.js');
const { inFootprint } = await import('../src/data/box.js');
const { CityWorld } = await import('../src/data/cityWorld.js');
const { Locomotion } = await import('../src/game/locomotion.js');
const { ROUTE, KEY_BUILDINGS, STORY, CHECKPOINTS, FACTORY_TILE } = L;
const C = KEY_BUILDINGS[1];

/** A story world with every block along the route built (as after the loading screen). */
function storyWorld() {
  const w = new CityWorld({ autoReady: true }); w.reset({ mode: 'story' });
  for (let s = 0; s <= ROUTE.length; s += 24) { const p = routePoint(s); w.update(p, { x: 0, y: 0, z: 0 }, 1 / 60, { force: true }); }
  w.update(routePoint(0), { x: 0, y: 0, z: 0 }, 1 / 60, { force: true });
  return w;
}

test('route: window → 5 blocks north → right turn → 1 block east → factory roof circle', () => {
  const a = ROUTE.pts[0], t = ROUTE.turn, e = ROUTE.pts.at(-1);
  assert.ok(Math.abs(a[0] - 6) < 1e-6 && a[2] < -10, 'starts at the home window (north facade)');
  assert.ok(Math.abs(t[0]) < 1e-6 && t[1] < -400, 'first leg straight north along x = 0');
  assert.ok(Math.abs(ROUTE.sTurn - (5 * 72 + 78)) < 6, `≈5 blocks + start block before the turn (${ROUTE.sTurn.toFixed(1)} m)`);
  assert.ok(e[0] - t[0] > 60 && e[0] - t[0] < 110 && Math.abs(e[2] - t[1]) < 6, 'right turn = east, ~1 block');
  const c = STORY.circle.pos;
  assert.ok(inFootprint(C, c[0], c[2], -6), 'circle on C, ≥ 6 m from edges');
  assert.ok(Math.hypot(e[0] - c[0], e[2] - c[2]) < 6, 'route ends at the circle');
  assert.ok(Math.abs(routeHeight(ROUTE.length) - C.h) < 12, 'last block descends to the low factory roof');
});

test('route: the flight corridor is open – no building intersects the path', () => {
  const w = storyWorld();
  for (let s = 8; s <= ROUTE.length - 14; s += 2) {
    const p = routePoint(s); p.y = routeHeight(s);
    const hit = w.collidersNear(p.x, p.z, 4).find((c) => c.id !== 'C' && c.y1 > p.y - 6 && inFootprint(c, p.x, p.z, 3));
    assert.equal(hit, undefined, `blocked at s=${s} by ${hit?.id}`);
  }
});

test('routeProgress: along-route distance, turn ambiguity resolved by continuity', () => {
  const p100 = routePoint(100);
  assert.ok(Math.abs(routeProgress(p100.x, p100.z).s - 100) < 1e-6);
  const p = routePoint(ROUTE.sTurn + 34);
  assert.ok(Math.abs(routeProgress(p.x, p.z, ROUTE.sTurn + 30).s - (ROUTE.sTurn + 34)) < 1e-6);
  const a = routePoint(16), b = routePoint(186);
  assert.ok(routeProgress(a.x, a.z).s < routeProgress(b.x, b.z).s);
  assert.ok(CHECKPOINTS.every((c, i) => i === 0 || c.s > CHECKPOINTS[i - 1].s));
});

test('anchors: every route point has a reachable, visible anchor ahead (continuous swinging)', () => {
  const w = storyWorld();
  for (let s = 0; s <= ROUTE.length - 24; s += 6) {
    const p = routePoint(s); p.y = routeHeight(s);
    const ok = w.anchorsNear(p.x, p.z, 60).some((a) => {
      const d = a.p.distanceTo(p);
      if (d > 58 || d < 6) return false;
      if (routeProgress(a.p.x, a.p.z, s).s < s + 4) return false;
      return !w.segmentBlocked(p.x, p.y, p.z, a.p.x, a.p.y, a.p.z, a.building);
    });
    assert.ok(ok, `no anchor ahead at s=${s}`);
  }
  assert.ok(w.tileCell(FACTORY_TILE).anchors.some((a) => a.id === 'C-STACK'), 'factory smoke-stack anchor');
});

export function fakeApp(world) {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(), player = new THREE.Group();
  player.add(camera); scene.add(player); camera.position.set(0, 1.6, 0);
  const hub = { grip: { left: { valid: false }, right: { valid: false } }, haptic() {}, aim: { left: { valid: false }, right: { valid: false } }, mode: { left: 'none', right: 'none' }, machines: {}, webHeld: { left: false, right: false }, trackingLost: { left: false, right: false }, ctx: {}, events: [], teleport: { hand: 'right' }, pointers: { left: { valid: false }, right: { valid: false } }, aimOriginNow: (h, o) => o.copy(player.position).add(new THREE.Vector3(0, 1.3, 0)) };
  return { scene, camera, world: { player }, city: {}, cityWorld: world, hub, fx: { web: () => ({}), releaseBeam() {} } };
}

test('swing bot: real swing physics + streaming can follow the whole route and land on C', () => {
  const w = new CityWorld({ autoReady: true }); w.reset({ mode: 'story' });
  const app = fakeApp(w), loco = new Locomotion(app), hub = app.hub;
  loco.setCityMode([]);
  loco.placeAt(new THREE.Vector3(6, 76, -16)); loco.grounded = false; // just outside the window
  w.update(loco.feet(), loco.vel, 1 / 72, { force: true });
  let t = 0, s = 0, attachedAt = 0, maxS = 0, attaches = 0, landedOnC = false, blocked = 0, falls = 0;
  loco.onWebBlocked = () => { blocked++; };
  loco.onFall = () => { falls++; }; loco.onStreet = () => { falls++; };
  const hand = () => (attaches % 2 ? 'left' : 'right');
  const overC = (f, pad) => inFootprint(C, f.x, f.z, -pad);
  for (let i = 0; i < 72 * 150 && !landedOnC; i++) {
    t += 1 / 72;
    const feet = loco.feet(new THREE.Vector3());
    w.update(feet, loco.vel, 1 / 72);
    s = routeProgress(feet.x, feet.z, s).s; maxS = Math.max(maxS, s);
    const body = feet.clone().add(new THREE.Vector3(0, 1.3, 0));
    if (loco.attach) {
      const as = routeProgress(loco.attach.anchor.p.x, loco.attach.anchor.p.z, s).s;
      if ((s > as + 2 && loco.vel.y > 3) || s > as + 16 || t - attachedAt > 4 || overC(feet, 3)) { hub.webHeld[loco.attach.hand] = false; }
    }
    if (!loco.attach) {
      let best = null;
      for (const a of w.anchorsNear(body.x, body.z, 56)) {
        const pr = routeProgress(a.p.x, a.p.z, s), d = a.p.distanceTo(body);
        if (pr.s < s + 8 || d > 55 || d < 6 || pr.dist > 40 || loco.occluded(body, a.p, a.building)) continue;
        const nearEnd = s > ROUTE.length - 40;
        const score = (nearEnd ? -Math.abs(pr.s - ROUTE.length) : pr.s - s - Math.abs(d - 30) * 0.5) + Math.min(30, a.p.y - body.y) * 0.8; // keep altitude like a player would
        if (!best || score > best.score) best = { a, score };
      }
      if (best && !overC(feet, 2) && (t - attachedAt > 0.35)) {
        const h = hand(); hub.webHeld[h] = true;
        if (loco.tryAttach({ hand: h, origin: body, dir: best.a.p.clone().sub(body).normalize() })) { attaches++; attachedAt = t; }
      }
    }
    { const ahead = routePoint(Math.min(ROUTE.length, s + 25)); app.camera.rotation.set(0, Math.atan2(-(ahead.x - feet.x), -(ahead.z - feet.z)), 0); app.camera.updateMatrixWorld(true); }
    loco.update(1 / 72, t);
    if (process.env.TRACE && i % 36 === 0) console.log(t.toFixed(1), s.toFixed(0), loco.feet().toArray().map((v) => v.toFixed(1)).join(','), loco.attach?.anchor.id || (loco.cling ? 'CLING ' + loco.cling.building : loco.grounded ? 'GROUND' : 'air'), loco.vel.length().toFixed(1));
    const f = loco.feet();
    if (loco.grounded && Math.abs(f.y - C.h) < 0.3 && inFootprint(C, f.x, f.z)) landedOnC = true;
  }
  assert.ok(maxS > ROUTE.sTurn + 20, `made the right turn (maxS=${maxS.toFixed(0)})`);
  assert.ok(landedOnC, `landed on C (maxS=${maxS.toFixed(0)}, attaches=${attaches}, blocked=${blocked}, falls=${falls}, feet=${loco.feet().toArray().map((v) => v.toFixed(1))})`);
  assert.ok(loco.stats.maxSpeed <= 18 * 1.6 + 1, `top speed ${loco.stats.maxSpeed.toFixed(1)} m/s within the comfort limit`);
});
