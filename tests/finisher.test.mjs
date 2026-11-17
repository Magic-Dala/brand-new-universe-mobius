// v0.45 finisher state machine: stall → tethered → yank → blast → done (pure — no scene).
import test from 'node:test';
import assert from 'node:assert/strict';
import { Finisher, FINISHER_STATES } from '../src/worlds/finisher.js';

const DT = 1 / 60;
/** Step the finisher for `sec` seconds (whole frames); returns all events. */
function run(f, sec) { const out = []; for (let i = 0, n = Math.round(sec / DT); i < n; i++) out.push(...f.update(DT).map((e) => ({ ...e }))); return out; }

test('states list', () => assert.deepEqual(FINISHER_STATES, ['idle', 'stall', 'tethered', 'yank', 'blast', 'done']));
test('start once; a second start is refused', () => { const f = new Finisher(); assert.ok(f.start()); assert.equal(f.state, 'stall'); assert.equal(f.start(), false); });
test('one hand is not enough; both hands tether', () => { const f = new Finisher(); f.start(); f.tether('left'); assert.equal(f.state, 'stall'); assert.equal(f.pull(), false); f.tether('right'); assert.equal(f.state, 'tethered'); });
test('losing a hand goes back to stall', () => { const f = new Finisher(); f.start(); f.tether('left'); f.tether('right'); f.untether('left'); assert.equal(f.state, 'stall'); });
test('player path: pull → yank 0.6 s → blast 0.8 s → done, byPlayer', () => {
  const f = new Finisher(); f.start(); f.tether('left'); f.tether('right'); assert.ok(f.pull()); assert.equal(f.state, 'yank');
  run(f, 0.61); assert.equal(f.state, 'blast'); const ev = run(f, 0.81); assert.equal(f.state, 'done'); assert.equal(f.byPlayer, true); assert.deepEqual(ev.at(-1), { type: 'done', byPlayer: true });
});
test('timeout: 4 s without a pull → blast, not byPlayer', () => { const f = new Finisher(); f.start(); f.tether('left'); run(f, 4.01); assert.equal(f.state, 'blast'); assert.equal(f.byPlayer, false); });
test('the timeout does not cut a yank short', () => { const f = new Finisher(); f.start(); f.tether('left'); f.tether('right'); run(f, 3.9); f.pull(); run(f, 0.3); assert.equal(f.state, 'yank'); assert.equal(f.byPlayer, true); });
test('update(0) never advances (paused)', () => { const f = new Finisher(); f.start(); for (let i = 0; i < 1000; i++) f.update(0); assert.equal(f.state, 'stall'); });
test('abort returns to idle and can start again', () => { const f = new Finisher(); f.start(); f.tether('left'); f.abort(); assert.equal(f.state, 'idle'); assert.deepEqual(f.hands, { left: false, right: false }); assert.ok(f.start()); });
test('tether / pull outside the finisher do nothing', () => { const f = new Finisher(); f.tether('left'); assert.equal(f.pull(), false); assert.equal(f.state, 'idle'); });
