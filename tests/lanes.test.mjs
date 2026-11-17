// Arcade v0.16: three floating rhythm lanes — layout, lane assignment, arrival on the beat.
import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.localStorage = { getItem: () => null, setItem() {} };
const THREE = await import('three');
const { LaneGuides, assignTracks, laneOf } = await import('../src/game/lanes.js');
const { settings } = await import('../src/core/settings.js');
const { resolveNotes } = await import('../src/core/chart.js');
const fs = await import('node:fs');
const chart = JSON.parse(fs.readFileSync(new URL('../public/songs/mobius-boss-01/chart.json', import.meta.url)));

const origin = new THREE.Vector3(0, -500, 2.5), fwd = new THREE.Vector3(0, 0, -1);
const boss = origin.clone().addScaledVector(fwd, settings.arcadeBossDistance); boss.y = origin.y + settings.arcadeBossHeight;

test('arena: Green Maniac 15–18 m away, rendered smaller than before', () => {
  const d = boss.clone().sub(origin).setY(0).length();
  assert.ok(d >= 15 && d <= 18, `${d}`);
  assert.ok(settings.arcadeBossScale < 1);
});
test('lanes: three rings in front of the player at waist–chest height, comfortably spaced', () => {
  const L = new LaneGuides(new THREE.Scene()); L.layout(origin, fwd, boss, 1.6);
  for (let i = 0; i < 3; i++) {
    const s = L.strike[i], h = s.y - origin.y;
    assert.ok(h > 0.9 && h < 1.45, `lane ${i} height ${h}`);
    assert.ok(Math.abs(origin.z - s.z - settings.arcadeStrikeDistance) < 1e-6, 'ring at the strike distance');
    const ang = Math.atan2(Math.abs(s.x - origin.x), settings.arcadeStrikeDistance) * 180 / Math.PI;
    assert.ok(ang < 20, // was 16 until 2026-11-16: the designer asked for the lanes further apart (1.4 m, 18.4°) and chose to relax this rule
      `lane ${i} is ${ang.toFixed(1)}° off centre (no turning)`);
    assert.ok(L.point(i, 1).distanceTo(s) < 1e-6, 'u = 1 is the judgement ring');
    assert.ok(L.start[i].z < s.z - 8, 'lanes start far away, near Green Maniac');
    assert.ok(L.start[i].y > s.y, 'lanes come down from the boss toward the player');
  }
  assert.ok(L.strike[0].x < L.strike[1].x && L.strike[1].x < L.strike[2].x, 'left / centre / right');
});
test('notes: every note gets a lane; simultaneous notes never share a lane; clusters fan out', () => {
  for (const diff of ['easy', 'normal', 'hard']) {
    const { notes } = resolveNotes(chart, diff); assignTracks(notes);
    const byT = new Map();
    for (const n of notes) {
      assert.ok([0, 1, 2].includes(n.track));
      const k = Math.round(n.time * 20); const set = byT.get(k) || new Set();
      assert.ok(!set.has(n.track), `${diff}: two notes on lane ${n.track} at ${n.time.toFixed(2)} s`); set.add(n.track); byT.set(k, set);
    }
    const used = new Set(notes.map((n) => n.track)); assert.equal(used.size, 3, `${diff} uses all three lanes`);
  }
  assert.equal(laneOf({ track: 2, lane: { x: -1 } }), 2, 'explicit chart track wins');
});
test('timing: the bomb reaches the ring exactly at its beat (pure function of song time)', () => {
  const L = new LaneGuides(new THREE.Scene()); L.layout(origin, fwd, boss, 1.6);
  const travel = 2.05, T = 12.34;
  const at = (now) => L.point(1, (now - (T - travel)) / travel);
  assert.ok(at(T).distanceTo(L.strike[1]) < 1e-9);
  assert.ok(at(T - travel).distanceTo(L.start[1]) < 1e-9);
  // speed of the flowing guide markers == bomb speed (the shader uses len / travel)
  const v = L.len[1] / travel, p0 = at(T - 1), p1 = at(T - 0.5);
  assert.ok(Math.abs(p0.distanceTo(p1) / 0.5 - v) < 1e-6);
});
