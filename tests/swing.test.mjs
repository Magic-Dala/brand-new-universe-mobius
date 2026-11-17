// Swing / anchor tests on the modular city (fake app: no DOM, no renderer).
import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.performance = globalThis.performance || { now: () => Date.now() };
const THREE = await import('three');
const { Locomotion } = await import('../src/game/locomotion.js');
const { settings } = await import('../src/core/settings.js');
const { CityWorld } = await import('../src/data/cityWorld.js');

const W = new CityWorld({ autoReady: true }); W.reset({ mode: 'story' });
W.update({ x: 0, y: 70, z: -100 }, undefined, 1 / 60, { force: true });

function fakeApp() {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(), player = new THREE.Group();
  player.add(camera); scene.add(player); camera.position.set(0, 1.6, 0);
  const hub = { grip: { left: { valid: false, closed: false, pos: new THREE.Vector3() }, right: { valid: false, closed: false, pos: new THREE.Vector3() } }, haptic() {}, aim: { left: { valid: false }, right: { valid: true, origin: new THREE.Vector3(), dir: new THREE.Vector3() } }, mode: { left: 'none', right: 'controller' }, machines: {}, webHeld: { left: false, right: true }, trackingLost: { left: false, right: false }, ctx: {}, events: [], teleport: { hand: 'right' }, pointers: { left: { valid: false }, right: { valid: false } }, aimOriginNow: (h, o) => o.copy(hub.aim[h].origin) };
  const app = { scene, camera, world: { player }, city: {}, cityWorld: W, hub, fx: { web: () => ({}), releaseBeam() {} } };
  return { app, loco: new Locomotion(app) };
}
// a roof-edge anchor on the west face (normal −x) of a single-tier tower east of the avenue in block 1
const tile1 = W.tileCell(1);
const ANCHOR = tile1.anchors.find((a) => a.kind === 'roof' && a.normal[0] < -0.9 && W.building(a.building).tiers.length === 1 && W.building(a.building).h > 50) || tile1.anchors.find((a) => a.kind === 'roof' && a.normal[0] < -0.9);
const B = W.building(ANCHOR.building), BC = W.colliderOf(B.id);
const westFace = () => BC.x - (Math.abs(BC.cos) * BC.hw + Math.abs(BC.sin) * BC.hd);

test('anchor data: stable id, world position, module, valid flag', () => {
  assert.match(ANCHOR.id, /^t1\./); assert.equal(ANCHOR.cell, tile1); assert.equal(ANCHOR.valid, true);
  assert.equal(ANCHOR.p.x, ANCHOR.pos[0]); assert.ok(Math.abs(ANCHOR.p.y - B.h) < 3, 'roof-edge anchor at roof height');
  assert.ok(W.anchorById('A-N-ROOF-E') && W.anchorById('A-N-ROOF-W'), 'home tower roof anchors next to the window');
});

test('sticky lock: hint seen <0.35 s ago is used even if the firing aim drifted', () => {
  const { app, loco } = fakeApp();
  const origin = ANCHOR.p.clone().add(new THREE.Vector3(-20, -20, 10));
  app.world.player.position.copy(origin).y -= 1.3; app.world.player.updateMatrixWorld(true); // the body is where the hand is
  loco.lastHint = { right: { anchor: ANCHOR, t: performance.now() / 1000 }, left: null };
  const away = new THREE.Vector3(0, 0, 1); // aim drifted far off
  assert.equal(loco.tryAttach({ hand: 'right', origin, dir: away })?.id, ANCHOR.id);
  loco.detach(true);
  loco.lastHint.right.t -= 1; // stale hint → no lock
  assert.equal(loco.tryAttach({ hand: 'right', origin, dir: away }), null);
});

test('grazing aim along the anchor facade is not treated as occluded; through the building is', () => {
  const { loco } = fakeApp();
  const origin = ANCHOR.p.clone().add(new THREE.Vector3(-25 * Math.tan(8 * Math.PI / 180), 0, 25)); // along the facade, ~8°
  assert.equal(loco.occluded(origin, ANCHOR.p, B.id), false);
  assert.equal(loco.occluded(ANCHOR.p.clone().add(new THREE.Vector3(BC.hw * 2 + 10, -8, 0)), ANCHOR.p, B.id), true);
});

test('anchor limits: beyond the web length / below the elevation limit → no attach; the other hand never takes the same anchor', () => {
  const { loco } = fakeApp(); loco.setCityMode([]);
  const far = ANCHOR.p.clone().add(new THREE.Vector3(-settings.webMaxLength - 8, -10, 0));
  assert.equal(loco.anchorCandidates(far).some((c) => c.anchor === ANCHOR), false, 'too far');
  const above = ANCHOR.p.clone().add(new THREE.Vector3(-10, 40, 0));
  assert.equal(loco.anchorCandidates(above).some((c) => c.anchor === ANCHOR), false, 'far below the hand');
  assert.equal(loco.anchorCandidates(ANCHOR.p.clone().add(new THREE.Vector3(-20, -15, 0)), ANCHOR).some((c) => c.anchor === ANCHOR), false, 'excluded');
});

test('safe release: the attached anchor becoming invalid detaches without a crash', () => {
  const { app, loco } = fakeApp(); loco.setCityMode([]); loco.grounded = false;
  app.world.player.position.set(ANCHOR.p.x - 12, ANCHOR.p.y - 25, ANCHOR.p.z); app.world.player.updateMatrixWorld(true);
  const body = app.world.player.position.clone().add(new THREE.Vector3(0, 1.3, 0));
  assert.ok(loco.tryAttach({ hand: 'right', origin: body, dir: ANCHOR.p.clone().sub(body).normalize() }));
  assert.equal(W.attached, ANCHOR, 'world knows which anchor is in use');
  let lost = 0; loco.onAnchorLost = () => lost++;
  ANCHOR.valid = false;
  try { loco._updateSwing(1 / 60, 0, app.hub); } finally { ANCHOR.valid = true; }
  assert.equal(loco.attach, null); assert.equal(lost, 1); assert.equal(W.attached, null);
});

test('rope reels in at swingReelSpeed down to swingMinRope; speed stays under the comfort limit', () => {
  const { app, loco } = fakeApp();
  loco.setCityMode([]); loco.grounded = false;
  app.world.player.position.set(ANCHOR.p.x - 10, ANCHOR.p.y - 30, ANCHOR.p.z); app.world.player.updateMatrixWorld(true);
  const o = app.world.player.position.clone().add(new THREE.Vector3(0, 1.3, 0));
  assert.ok(loco.tryAttach({ hand: 'right', origin: o, dir: ANCHOR.p.clone().sub(o).normalize() }));
  const len0 = loco.attach.len;
  for (let i = 0; i < 60; i++) loco._updateSwing(1 / 60, i / 60, app.hub);
  assert.ok(loco.attach, 'still attached');
  assert.ok(Math.abs(len0 - loco.attach.len - settings.swingReelSpeed) < 0.2, `reeled ${(len0 - loco.attach.len).toFixed(2)} m in 1 s`);
  for (let i = 0; i < 600 && loco.attach; i++) { loco._updateSwing(1 / 60, 1 + i / 60, app.hub); assert.ok(loco.vel.length() <= settings.swingSpeedLimit + 1e-6); }
  if (loco.attach) assert.ok(loco.attach.len >= settings.swingMinRope - 1e-6);
});

function clingOn(app, loco, y) {
  loco.setCityMode([]); loco.grounded = false;
  app.world.player.position.set(westFace() - 1.0, y, B.z); app.world.player.rotation.set(0, -Math.PI / 2, 0); app.world.player.updateMatrixWorld(true); // facing east = the wall
  loco.vel.set(8, 0, 0);
  for (let i = 0; i < 30 && !loco.cling; i++) loco._updateSwing(1 / 60, i / 60, app.hub);
  assert.ok(loco.cling, 'clung to the wall');
}
function strokes(app, loco, n) {
  const g = app.hub.grip.right, rig = app.world.player;
  const fwd = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), rig.rotation.y);
  for (let s = 0; s < n; s++) {
    for (let k = 0; k <= 20; k++) { // hand goes from 1.7 m to 1.0 m (relative to rig) while closed
      g.valid = true; g.closed = true; g.pos.copy(rig.position).addScaledVector(fwd, 0.35); g.pos.y += 1.7 - k * 0.035;
      loco._updateSwing(1 / 60, 0, app.hub);
      if (!loco.cling) return;
    }
    g.closed = false; loco._updateSwing(1 / 60, 0, app.hub);
  }
}

test('wall cling: hitting a facade sticks (no gravity); firing a web pulls off again', () => {
  const { app, loco } = fakeApp();
  clingOn(app, loco, 40);
  assert.equal(loco.cling.building, B.id);
  const y0 = app.world.player.position.y;
  for (let i = 0; i < 120; i++) loco._updateSwing(1 / 60, 1 + i / 60, app.hub);
  assert.ok(Math.abs(app.world.player.position.y - y0) < 1e-6, 'no sliding while clinging');
  const a = W.tileCell(1).anchors.find((x) => x.building !== B.id && x.p.distanceTo(app.world.player.position) < 45 && !loco.occluded(app.world.player.position.clone().add(new THREE.Vector3(0, 1.3, 0)), x.p, x.building));
  assert.ok(a, 'an anchor across the avenue');
  const o = app.world.player.position.clone().add(new THREE.Vector3(0, 1.3, 0));
  assert.ok(loco.tryAttach({ hand: 'right', origin: o, dir: a.p.clone().sub(o).normalize() }));
  assert.equal(loco.cling, null);
});

test('climb: facing the wall, fist-and-pull moves up; not facing → only clings; roof edge → mantle', () => {
  { const { app, loco } = fakeApp();
    clingOn(app, loco, 40);
    const y0 = app.world.player.position.y; strokes(app, loco, 3);
    const climbed = app.world.player.position.y - y0;
    assert.ok(climbed > 1.8 && climbed < 2.3, `climbed ${climbed.toFixed(2)} m in 3 strokes`);
    app.world.player.rotation.y = Math.PI / 2; app.world.player.updateMatrixWorld(true);
    const y1 = app.world.player.position.y; strokes(app, loco, 2);
    assert.ok(Math.abs(app.world.player.position.y - y1) < 1e-6, 'clings without climbing when not facing'); assert.ok(loco.cling); }
  { const { app, loco } = fakeApp();
    clingOn(app, loco, BC.y1 - 2.5); strokes(app, loco, 4);
    assert.equal(loco.cling, null); assert.ok(loco.grounded);
    assert.ok(Math.abs(app.world.player.position.y - BC.y1) < 1e-6, 'standing on the roof'); }
});

test('look steering: on a web, horizontal motion turns toward where the headset looks (head never rotated)', () => {
  const { app, loco } = fakeApp();
  loco.setCityMode([]); loco.grounded = false;
  app.world.player.position.set(0, ANCHOR.p.y - 20, ANCHOR.p.z + 8); app.world.player.rotation.set(0, 0, 0); app.world.player.updateMatrixWorld(true);
  const body = app.world.player.position.clone().add(new THREE.Vector3(0, 1.3, 0));
  assert.ok(loco.tryAttach({ hand: 'right', origin: body, dir: ANCHOR.p.clone().sub(body).normalize() }));
  loco.vel.set(0, 0, -10); // moving north
  app.camera.rotation.set(0, -Math.PI / 2, 0); app.camera.updateMatrixWorld(true); // looking EAST
  for (let i = 0; i < 60 && loco.attach; i++) loco._updateSwing(1 / 60, i / 60, app.hub);
  const heading = Math.atan2(loco.vel.x, -loco.vel.z) * 180 / Math.PI;
  assert.ok(heading > 45, `turned toward the look direction (heading ${heading.toFixed(0)}°)`);
  assert.ok(Math.abs(app.camera.rotation.y + Math.PI / 2) < 1e-9);
});

test('v0.22c falls: no penalty for landing on the street; only 10 s of continuous fall with no anchor returns to the checkpoint', () => {
  const { app, loco } = fakeApp();
  let falls = 0, street = 0; loco.onFall = () => { falls++; return true; }; loco.onStreet = () => { street++; };
  loco.setCityMode([]); loco.grounded = false;
  // high above the avenue (no building below), thrusters cap the fall speed: 9 s airborne → nothing yet
  app.world.player.position.set(0, 170, -100); app.world.player.updateMatrixWorld(true); loco.vel.set(0, 0, 0);
  const fly = (sec) => { for (let i = 0; i < sec * 60; i++) { loco._updateSwing(1 / 60, i / 60, app.hub); if (loco.grounded) break; } };
  const prev = settings.thrusterMaxFall; settings.thrusterMaxFall = 3; // slow fall so it stays airborne > 10 s
  try {
    fly(9); assert.equal(falls, 0, 'not yet at 9 s');
    fly(1.5); assert.equal(falls, 1, 'recovered after 10 s without an anchor');
    // grabbing an anchor resets the timer
    loco.grounded = false; app.world.player.position.set(0, 170, -100); app.world.player.updateMatrixWorld(true); loco.vel.set(0, 0, 0);
    fly(8); loco._airT = loco._airT; const t8 = loco._airT; loco.cling = { building: 'X', normal: new THREE.Vector3(1, 0, 0) }; loco._updateSwing(1 / 60, 0, app.hub); loco.cling = null;
    assert.ok(t8 > 7.9 && loco._airT === 0, 'touching a wall / anchor resets the fall timer');
  } finally { settings.thrusterMaxFall = prev; }
  // landing on the street: no recovery, just the hint callback; standing there never triggers the fall recovery
  falls = 0; loco.grounded = false; app.world.player.position.set(0, 6, -100); app.world.player.updateMatrixWorld(true); loco.vel.set(0, -5, 0);
  fly(3); assert.ok(loco.grounded && street === 1, `landed on the street (street ${street})`);
  for (let i = 0; i < 60 * 15; i++) loco._updateSwing(1 / 60, i / 60, app.hub);
  assert.equal(falls, 0, 'standing on the street is never a fall');
});

test('v0.22c endless city: no "too far from the route" — outside the built city a soft pull back, no teleport', () => {
  const { app, loco } = fakeApp();
  app.story = { stage: 'endless' }; let out = 0; loco.onOutOfBounds = () => { out++; return true; };
  loco.setCityMode([]); loco.grounded = false;
  // inside a built block but far off the route centre line (the chase corridor would have fired)
  const side = W.tileCell(1); const bx = side.T.cx + 200; // beyond the filler ring: nothing built here
  app.world.player.position.set(side.T.cx - 60, 80, side.T.cz); app.world.player.updateMatrixWorld(true);
  for (let i = 0; i < 60; i++) { loco.vel.set(0, 0, 0); loco._bounds(1 / 60); }
  assert.equal(out, 0, 'off the route line inside the city: fine');
  app.world.player.position.set(bx, 80, side.T.cz); app.world.player.updateMatrixWorld(true); loco.vel.set(12, 0, 0);
  for (let i = 0; i < 60; i++) loco._bounds(1 / 60);
  assert.equal(out, 0, 'no teleport at the edge'); assert.ok(loco.vel.x < 4, `outward speed bled off (vx ${loco.vel.x.toFixed(2)})`);
  for (let i = 0; i < 60 * 9; i++) loco._bounds(1 / 60);
  assert.equal(out, 1, 'safety net only after 8 s lost outside the city');
});

test('v0.24 two webs at once: each hand holds its own anchor; releasing one keeps the other; both ropes constrain', () => {
  const { app, loco } = fakeApp(); loco.setCityMode([]); loco.grounded = false;
  const hub = app.hub; hub.webHeld.left = true; hub.trackingLost.left = false;
  app.world.player.position.set(ANCHOR.p.x - 12, ANCHOR.p.y - 25, ANCHOR.p.z); app.world.player.updateMatrixWorld(true);
  const body = app.world.player.position.clone().add(new THREE.Vector3(0, 1.3, 0));
  const second = W.anchorsNear(body.x, body.z, settings.anchorMaxDist, []).find((a) => a !== ANCHOR && a.valid && a.p.y > body.y + 8 && a.p.distanceTo(body) < 40 && !loco.occluded(body, a.p, a.building));
  assert.ok(second, 'a second anchor nearby');
  assert.equal(loco.tryAttach({ hand: 'right', origin: body, dir: ANCHOR.p.clone().sub(body).normalize() })?.id, ANCHOR.id);
  assert.equal(loco.attachTo(second, { hand: 'left', origin: body, dir: second.p.clone().sub(body).normalize() })?.id, second.id);
  assert.equal(loco.ropes.length, 2, 'both webs held');
  assert.deepEqual(W.attachedAll.map((a) => a.id).sort(), [ANCHOR.id, second.id].sort());
  for (let i = 0; i < 90; i++) {
    loco._updateSwing(1 / 60, i / 60, hub);
    const c = loco.feet().add(new THREE.Vector3(0, 1.3, 0));
    for (const r of loco.ropes) assert.ok(c.distanceTo(r.anchor.p) <= r.len + 0.1, `rope ${r.hand} stretched ${(c.distanceTo(r.anchor.p) - r.len).toFixed(2)}`);
  }
  assert.equal(loco.ropes.length, 2);
  hub.webHeld.left = false;
  for (let i = 0; i < 20; i++) loco._updateSwing(1 / 60, 1.5 + i / 60, hub);
  assert.equal(loco.ropes.length, 1); assert.equal(loco.attach.hand, 'right', 'the right web keeps holding');
  // re-firing the same hand replaces only that hand's web
  hub.webHeld.left = true;
  loco.attachTo(second, { hand: 'left', origin: body, dir: new THREE.Vector3(0, 1, 0) });
  loco.attachTo(ANCHOR, { hand: 'left', origin: body, dir: new THREE.Vector3(0, 1, 0) });
  assert.equal(loco.ropes.filter((r) => r.hand === 'left').length, 1);
  loco.detach(true); assert.equal(loco.ropes.length, 0); assert.equal(W.attached, null);
});
