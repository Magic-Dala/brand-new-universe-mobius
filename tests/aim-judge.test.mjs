import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.localStorage = { getItem: () => null, setItem() {} };
const THREE = await import('three');
const { pickTarget, angularZoneSize } = await import('../src/game/aim.js');
const { judgeTiming, ScoreKeeper } = await import('../src/game/judge.js');
const { buildChart, resolveNotes, makeBeatClock, validateChart } = await import('../src/core/chart.js');
const V = (x, y, z) => new THREE.Vector3(x, y, z);

test('10% margin: zone is 120% of target size, edges reproducible', () => {
  const o = V(0, 0, 0), d = V(0, 0, -1);
  const tgt = { pos: V(0, 0, -5), w: 0.4, h: 0.4 };
  // half width 0.2 → expanded 0.24
  for (const [x, hit] of [[0.239, true], [0.241, false], [-0.239, true], [0.2, true]]) {
    const r = pickTarget(o, d, [{ ...tgt, pos: V(x, 0, -5) }], { margin: 0.1 });
    assert.equal(!!r, hit, `offset ${x}`);
  }
  // margin 0 → exact size
  assert.equal(!!pickTarget(o, d, [{ ...tgt, pos: V(0.21, 0, -5) }], { margin: 0 }), false);
});
test('picks target closest to reticle, ignores behind and occluded', () => {
  const o = V(0, 0, 0), d = V(0, 0, -1);
  const a = { id: 'a', pos: V(0.15, 0, -4), w: 0.4, h: 0.4 }, b = { id: 'b', pos: V(0.05, 0, -6), w: 0.4, h: 0.4 }, c = { id: 'c', pos: V(0, 0, 3), w: 1, h: 1 };
  assert.equal(pickTarget(o, d, [a, b, c]).target.id, 'b');
  assert.equal(pickTarget(o, d, [a, b], { occluded: (_, p) => p.z < -5 }).target.id, 'a');
  assert.equal(pickTarget(o, d, [c]), null);
});
test('timing windows independent from aim', () => {
  assert.equal(judgeTiming(0.05, 0.075, 0.16), 'perfect');
  assert.equal(judgeTiming(-0.1, 0.075, 0.16), 'good');
  assert.equal(judgeTiming(0.2, 0.075, 0.16), null);
});
test('each note scored once; overheat after spam', () => {
  const s = new ScoreKeeper(10);
  assert.equal(s.record('n1', 'perfect'), true);
  assert.equal(s.record('n1', 'perfect'), false);
  assert.equal(s.combo, 1);
  s.record('n2', 'miss'); assert.equal(s.combo, 0);
  let oh = false; for (let i = 0; i < 5; i++) oh = s.invalidShot(1 + i * 0.1) || oh;
  assert.equal(oh, true); assert.equal(s.overheated(1.5), true);
});
test('chart: beat clock uses offset + tempo map; song-1 chart valid', async () => {
  const c = makeBeatClock({ bpm: 125, offsetSec: 0.31 });
  assert.ok(Math.abs(c.beatToSec(0) - 0.31) < 1e-9);
  assert.ok(Math.abs(c.beatToSec(4) - 2.23) < 1e-9);
  const tm = makeBeatClock({ bpm: 120, offsetSec: 1, tempoMap: [{ beat: 0, bpm: 120 }, { beat: 8, bpm: 60 }] });
  assert.ok(Math.abs(tm.beatToSec(10) - (1 + 4 + 2)) < 1e-9);
  assert.ok(Math.abs(tm.secToBeat(7) - 10) < 1e-9);
  const fs = await import('node:fs');
  const chart = validateChart(JSON.parse(fs.readFileSync(new URL('../public/songs/mobius-boss-01/chart.json', import.meta.url))));
  for (const d of ['easy', 'normal', 'hard']) {
    const { notes } = resolveNotes(chart, d);
    assert.ok(notes.length > 40);
    assert.ok(notes[0].time >= 4 && notes.at(-1).time < 56.89 - 1, 'notes inside the song');
    // per-hand web spacing >= 0.2 s
    for (const h of ['L', 'R']) {
      const ts = notes.filter((n) => n.hand === h).map((n) => n.time);
      for (let i = 1; i < ts.length; i++) assert.ok(ts[i] - ts[i - 1] >= 0.2 - 1e-6, `${d} ${h} spacing at ${ts[i]}`);
    }
    // bomb-type events spaced >= cooldown
    const bombs = [...new Set(notes.filter((n) => n.type !== 'pumpkin' && !n.row).map((n) => n.time))];
    for (let i = 1; i < bombs.length; i++) assert.ok(bombs[i] - bombs[i - 1] >= 2.5, `${d} bomb spacing`);
    // v0.22 Fan Web rows: three members, one per lane, same time; the first is practice; nothing else within ±1 beat
    const rows = [...new Set(notes.filter((n) => n.row).map((n) => n.row))];
    assert.ok(rows.length >= 3 && rows.length <= 6, `${d} rows ${rows.length}`);
    rows.forEach((id, k) => {
      const m = notes.filter((n) => n.row === id);
      assert.equal(m.length, 3); assert.deepEqual(m.map((n) => n.track).sort(), [0, 1, 2]);
      assert.ok(m.every((n) => n.time === m[0].time && n.type === 'fanRow' && n.hand === 'both'));
      assert.equal(!!m[0].practice, k === 0, 'first row = practice');
      const near = notes.filter((n) => !n.row && Math.abs(n.time - m[0].time) < 0.48 * 1.0 + 1e-6);
      assert.equal(near.length, 0, `${d} ${id}: other bombs within one beat`);
    });
  }
});

test('swing anchors: angular tolerance (±10°) at any distance', () => {
  const o = V(0, 0, 0), d = V(0, 0, -1);
  for (const dist of [8, 25, 60]) {
    const at = (deg) => V(Math.tan(deg * Math.PI / 180) * dist, 0, -dist);
    const cand = (deg) => [{ pos: at(deg), w: angularZoneSize(dist, 10, 0.1, 0), h: angularZoneSize(dist, 10, 0.1, 0) }];
    assert.ok(pickTarget(o, d, cand(8), { margin: 0.1, maxDist: 80 }), `8° at ${dist} m locks`);
    assert.ok(pickTarget(o, d, cand(9.9), { margin: 0.1, maxDist: 80 }), `9.9° at ${dist} m locks`);
    assert.equal(pickTarget(o, d, cand(10.5), { margin: 0.1, maxDist: 80 }), null, `10.5° at ${dist} m rejected`);
  }
  // near anchors keep a minimum 1.2 m half-size
  assert.ok(angularZoneSize(3, 10, 0.1) * 1.2 / 2 >= 1.2 - 1e-9);
});
