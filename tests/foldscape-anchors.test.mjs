// v0.42 Foldscape roof-edge anchors (gen.roofAnchors, route.js roofEdge / corridorSetback): most wall anchors sit just
// under the top of the tier that carries them (roof or corridor-side setback terrace) — higher than the old mid-wall
// anchors, so swings go higher — while every anchor stays reachable / visible and the other seven maps are untouched.
import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.performance = globalThis.performance || { now: () => Date.now() };
const { MAPS, mapById } = await import('../src/worlds/maps.js');
const { RouteGen, validateModule, pathY, toWorld, ROUTE_CFG } = await import('../src/worlds/route.js');
const { ChaseWorld } = await import('../src/worlds/chaseWorld.js');

const FOLD = mapById('foldscape'), RA = FOLD.gen.roofAnchors;
const SEEDS = [1, 7, 42, 20261103 + 7919];
const tierOf = (s, y) => { const side = Math.sign(s.v) || 1; let best = null, bf = Infinity; for (const t of s.tiers) if (y >= t.y0 - 0.01 && y <= t.y1 + 0.01) { const f = Math.abs(s.v) + side * t.dv - t.d / 2; if (f < bf) { bf = f; best = t; } } return best; };
/** Wall anchors (not bridge undersides, not the low street-escape anchors) with their structure / tier / height above the route. */
function wallAnchors(map, seed, n = 60) {
  const g = new RouteGen(map, seed); g.ensure(n); const out = [];
  for (const m of g.modules.slice(0, n)) for (const a of m.anchors) {
    if (a.side === 0 || a.low) continue;
    const s = m.structures.find((x) => x.id === a.sid);
    out.push({ m, a, s, t: tierOf(s, a.y), dy: a.y - pathY(m, a.u) });
  }
  return out;
}
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

test('roof preference: most foldscape wall anchors sit 2.5–3 m under a roof / setback edge, typically 18+ m above the route', () => {
  for (const seed of SEEDS) {
    const A = wallAnchors(FOLD, seed);
    const roof = A.filter((x) => x.a.roof);
    assert.ok(A.length > 300, `seed ${seed}: ${A.length} anchors`);
    for (const x of roof) { // a roof anchor really is just under the top of the tier that carries it
      assert.ok(x.t, `${x.a.id} has a tier`);
      const gap = x.t.y1 - x.a.y;
      assert.ok(gap >= RA.below[0] - 1e-6 && gap <= RA.below[1] + 1e-6, `${x.a.id}: ${gap.toFixed(2)} m under its tier top`);
    }
    const share = roof.length / A.length;
    assert.ok(share >= 0.7, `seed ${seed}: only ${(share * 100).toFixed(0)} % of the wall anchors are roof-edge anchors`);
    const md = median(A.map((x) => x.dy));
    assert.ok(md >= 18 && md <= 26, `seed ${seed}: median anchor height ${md.toFixed(1)} m above the route (old: ~13)`);
    // never blindly at the top of a tall tower: inside the band (bridges / branch ceilings may only lower it)
    for (const x of A) assert.ok(x.dy <= RA.band[1] + 1e-6 && x.dy >= ROUTE_CFG.anchorMinAbove - 1e-6 || x.m.type === 'branch', `${x.a.id} at ${x.dy.toFixed(1)} m (${x.m.type})`);
  }
});

test('roof anchors are mounted on the visible corridor face, below the cornice band, with a clear line from the route', () => {
  for (const seed of SEEDS.slice(0, 2)) {
    const w = new ChaseWorld(FOLD, { autoReady: true, seed }); w.route.ensure(42);
    for (let i = 0; i <= 41; i++) w._create(i);
    let n = 0;
    for (let i = 0; i < 40; i++) for (const a of w.live.get(i).anchors) {
      const r = a.src; if (!r.roof) continue;
      const m = w.route.modules[i], s = m.structures.find((x) => x.id === r.sid), t = tierOf(s, r.y);
      // the device (disc ≤ 1.0 m above its point, arms ≤ 1.93 m below) is fully on this tier's wall, under the 1.4 m cornice
      assert.ok(r.y + 1.0 <= t.y1 - 1.4 + 1e-6 && r.y - 1.93 >= t.y0 - 1e-6, `${r.id} device leaves its wall / reaches the cornice`);
      // corridor-side tier (not hidden behind a lower terrace), 0.35 m in front of that face
      const face = Math.abs(s.v) + Math.sign(s.v) * t.dv - t.d / 2;
      assert.ok(Math.abs(Math.abs(r.v) - (face - ROUTE_CFG.anchorOut)) < 1e-6, `${r.id} not on its tier face`);
      // reach + sight: from the centre line beside it the anchor is within the real reach and no collider (own building
      // included) cuts the line before the mount
      const [x, z] = toWorld(m, r.u, 0), y = pathY(m, r.u), o = w.off;
      const d = Math.hypot(a.p.x - (x + o[0]), a.p.y - y, a.p.z - (z + o[1]));
      assert.ok(d <= ROUTE_CFG.anchorReach, `${r.id} ${d.toFixed(1)} m from the route`);
      assert.ok(!w.segmentBlocked(x + o[0], y, z + o[1], a.p.x, a.p.y, a.p.z, null, null, 1.2), `${r.id}: line of sight blocked`);
      n++;
    }
    assert.ok(n > 150, `checked ${n}`);
    // the whole route still validates with the real limits (corridor clear, reachable anchor ahead everywhere)
    for (let i = 0; i < 40; i++) { const v = validateModule(w.route.modules[i], w); assert.ok(v.ok, `#${i} ${w.route.modules[i].type}: ${v.problems.slice(0, 2).join('; ')}`); }
  }
});

test('corridor setbacks only widen the corridor above a reachable terrace; bridges, branch ceilings and escape anchors kept', () => {
  let setbacks = 0, under = 0, escape = 0;
  for (const seed of SEEDS) {
    const g = new RouteGen(FOLD, seed); g.ensure(60);
    for (const m of g.modules) {
      for (const s of m.structures) if (s.setback) {
        setbacks++;
        const [lo, hi] = s.tiers, side = Math.sign(s.v);
        assert.equal(lo.y1, hi.y0);
        assert.ok(Math.abs(s.v) + side * hi.dv - hi.d / 2 > Math.abs(s.v) + side * lo.dv - lo.d / 2 + 2.9, 'upper tier steps back from the corridor');
        assert.ok(Math.abs(Math.abs(s.v) + side * hi.dv + hi.d / 2 - (Math.abs(s.v) + side * lo.dv + lo.d / 2)) < 1e-6, 'far faces stay flush');
        const dy = lo.y1 - pathY(m, s.u); assert.ok(dy >= RA.setback.at[0] - 1e-6 && dy <= RA.setback.at[1] + 1e-6, `terrace ${dy.toFixed(1)} m above the route`);
      }
      for (const a of m.anchors) { if (a.kind === 'under') under++; if (a.low && a.side) escape++; }
      // high bridges: wall anchors near the span stay under it
      for (const s of m.structures) if (s.kind === 'bridgeHigh') for (const a of m.anchors) if (a.side && Math.abs(a.u - s.u) < 16) assert.ok(a.y <= s.y0 - ROUTE_CFG.bridgeClear + 1e-6, `${a.id} above the bridge underside`);
    }
  }
  assert.ok(setbacks > 100 && under > 40 && escape > 100, `setbacks ${setbacks}, under ${under}, escape ${escape}`);
});

test('other maps: no roof-anchor config, anchors keep the old mid-wall rule (≤ anchorDy above the route), no setbacks', () => {
  for (const map of MAPS) {
    if (map.id === 'foldscape') continue;
    assert.equal(map.gen.roofAnchors, undefined, map.id);
    for (const x of wallAnchors(map, 7, 30)) {
      assert.equal(x.a.roof, undefined); assert.equal(x.s.setback, undefined);
      if (x.m.type !== 'branch') assert.ok(x.dy <= map.gen.anchorDy[1] + 1e-6, `${map.id} ${x.a.id} ${x.dy.toFixed(1)}`);
    }
  }
});
