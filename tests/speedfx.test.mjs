// v0.45 speed FX pure helpers: rope load, tension level, near-miss pass detection (no scene, no audio).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ropeLoad, tensionLevel, nearMiss } from '../src/game/speedFx.js';
import { FEEL } from '../src/data/feel.js';

const v = (x, y, z) => new THREE.Vector3(x, y, z);
/** an axis-aligned collider in the shape of chaseWorld.collidersNear records (centre x/z, yaw cos/sin, half extents, y range) */
const box = (x0, y0, z0, x1, y1, z1) => ({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, cos: 1, sin: 0, hw: (x1 - x0) / 2, hd: (z1 - z0) / 2, y0, y1 });

test('ropeLoad: 12 m/s across a 12 m rope is 12 m/s²; along the rope is 0', () => { assert.ok(Math.abs(ropeLoad(v(12, 0, 0), v(0, 12, 0), 12) - 12) < 1e-6); assert.equal(ropeLoad(v(0, 12, 0), v(0, 12, 0), 12), 0); });
test('tensionLevel: 0 at 4 m/s², 1 at 30, clamped', () => { assert.equal(tensionLevel(4), 0); assert.equal(tensionLevel(30), 1); assert.equal(tensionLevel(99), 1); assert.equal(tensionLevel(0), 0); });
test('nearMiss: a wall 2 m to the right at 12 m/s', () => { const r = nearMiss(v(0, 10, 0), v(0, 0, -12), [box(2, 0, -5, 6, 40, 5)], FEEL.speed); assert.equal(r.side, 1); assert.ok(Math.abs(r.dist - 2) < 0.01); });
test('nearMiss: a wall to the left reports side -1', () => { const r = nearMiss(v(0, 10, 0), v(0, 0, -12), [box(-6, 0, -5, -2, 40, 5)], FEEL.speed); assert.equal(r.side, -1); });
test('nearMiss: nothing below 10 m/s, beyond 2.5 m, above the roof, or dead ahead', () => {
  const wall = [box(2, 0, -5, 6, 40, 5)];
  assert.equal(nearMiss(v(0, 10, 0), v(0, 0, -9), wall, FEEL.speed), null); // too slow
  assert.equal(nearMiss(v(0, 10, 0), v(0, 0, -12), [box(4, 0, -5, 8, 40, 5)], FEEL.speed), null); // 4 m away
  assert.equal(nearMiss(v(0, 45, 0), v(0, 0, -12), wall, FEEL.speed), null); // above the roof
  assert.equal(nearMiss(v(0, 10, 0), v(0, 0, -12), [box(-3, 0, -4, 3, 40, -2)], FEEL.speed), null); // wall dead ahead
});

import { SpeedFx } from '../src/game/speedFx.js';
import { audio } from '../src/core/audio.js';
import { settings } from '../src/core/settings.js';
const fakeApp = () => { const events = []; return { state: 'world', menus: null, worldChase: { running: true, paused: false, world: null }, camera: new THREE.PerspectiveCamera(), hub: { events }, fx: { vfx: { flashes: [], handFlash(p) { this.flashes.push(p); } } },
  locomotion: { vel: v(12, 0, 0), ropes: [{ anchor: { p: v(0, 12, 0) }, len: 12 }], feet: (o) => o.set(0, 0, 0) } }; };
test('SpeedFx: comfort passes k=0.5 to the tension voice (halved gain), normal passes 1', () => {
  const calls = [], sv = audio.startTension; audio.startTension = () => ({ set: (...a) => calls.push(a), stop() {} });
  const c0 = settings.comfortMode; try {
    for (const [comfort, k] of [[false, 1], [true, FEEL.speed.comfort]]) { settings.comfortMode = comfort; calls.length = 0; const s = new SpeedFx(fakeApp()); s.update(0.016); assert.equal(calls.at(-1)[2], k); s.stop(); }
    assert.equal(FEEL.speed.comfort, 0.5);
  } finally { settings.comfortMode = c0; audio.startTension = sv; }
});
test('SpeedFx: one flash per web event, no onAttachHand; stop() clears the listener it installed', () => {
  const app = fakeApp(); app.hub.events.push({ type: 'web', origin: v(1, 2, 3) }); const s = new SpeedFx(app);
  s.update(0.016); assert.equal(app.fx.vfx.flashes.length, 1); assert.equal(s.onAttachHand, undefined); assert.ok(audio._lpos);
  s.stop(); assert.equal(audio._lpos, null);
});
test('nearMiss allocates no new vectors in the steady state (shared result)', () => {
  const wall = [box(2, 0, -5, 6, 40, 5)], a = nearMiss(v(0, 10, 0), v(0, 0, -12), wall, FEEL.speed), p = a.point, b = nearMiss(v(0, 10, 0), v(0, 0, -12), wall, FEEL.speed);
  assert.equal(b, a); assert.equal(b.point, p);
});
