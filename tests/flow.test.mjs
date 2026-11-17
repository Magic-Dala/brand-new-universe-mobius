// v0.45 Flow meter: points, levels, style, decay, hurt (pure — no scene).
import test from 'node:test';
import assert from 'node:assert/strict';
import { Flow } from '../src/game/flow.js';

const DT = 1 / 60;
/** Step the meter for `sec` seconds (whole frames); returns all events. */
function run(f, sec) { const out = []; for (let i = 0, n = Math.round(sec / DT); i < n; i++) out.push(...f.update(DT)); return out; }

test('levels at 4, 10 and 18 points', () => { const f = new Flow(); for (let i = 0; i < 3; i++) f.gain('pumpkin'); assert.equal(f.level, 0); f.gain('pumpkin'); assert.equal(f.level, 1); for (let i = 0; i < 2; i++) f.gain('counter'); assert.equal(f.level, 2); for (let i = 0; i < 4; i++) f.gain('fan'); assert.equal(f.level, 3); });
test('points are capped at 24', () => { const f = new Flow(); for (let i = 0; i < 40; i++) f.gain('counter'); assert.equal(f.points, 24); });
test('style: 100 × (1 + level before the gain) per event', () => { const f = new Flow(); assert.equal(f.gain('pumpkin'), 100); for (let i = 0; i < 3; i++) f.gain('pumpkin'); assert.equal(f.gain('pumpkin'), 200); assert.equal(f.style, 600); });
test('no decay for 4 s after a gain, then 1 point per second', () => { const f = new Flow(); for (let i = 0; i < 6; i++) f.gain('pumpkin'); run(f, 3.9); assert.equal(f.points, 6); run(f, 2.1); assert.ok(Math.abs(f.points - 4) < 0.05); });
test('hurt drops one level to its threshold minus one', () => { const f = new Flow(); for (let i = 0; i < 12; i++) f.gain('pumpkin'); f.hurt(); assert.equal(f.level, 1); assert.equal(f.points, 9); f.hurt(); assert.equal(f.points, 3); f.hurt(); assert.equal(f.points, 0); });
test('level changes come back from update, once', () => { const f = new Flow(); for (let i = 0; i < 4; i++) f.gain('pumpkin'); assert.deepEqual(f.update(DT), [{ type: 'levelUp', level: 1 }]); assert.deepEqual(f.update(DT), []); f.hurt(); assert.deepEqual(f.update(DT), [{ type: 'levelDown', level: 0 }]); });
test('peak survives a drop; reset clears everything', () => { const f = new Flow(); for (let i = 0; i < 10; i++) f.gain('pumpkin'); f.hurt(); assert.equal(f.peak, 2); f.reset(); assert.deepEqual([f.level, f.points, f.peak, f.style], [0, 0, 0, 0]); });
test('unknown kind: no points, no style', () => { const f = new Flow(); assert.equal(f.gain('nope'), 0); assert.equal(f.points, 0); });
test('bonus adds style only', () => { const f = new Flow(); f.bonus(1500); assert.equal(f.style, 1500); assert.equal(f.points, 0); });
test('level 3 is reachable without pull and fan (controllers)', () => { const f = new Flow(); for (let i = 0; i < 18; i++) { f.gain(i % 2 ? 'pumpkin' : 'bossHit'); f.update(0.5); } assert.equal(f.level, 3); });
