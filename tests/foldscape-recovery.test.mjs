import test from 'node:test';
import assert from 'node:assert/strict';
import { MAPS } from '../src/worlds/maps.js';
import { RouteGen, ROUTE_CFG, pathY } from '../src/worlds/route.js';

test('Foldscape street recovery mounts move to mid-wall but remain reachable from street and upper anchors', () => {
  let count = 0, aboveOldBand = 0, linked = 0;
  for (const seed of [1, 42, 20269022]) {
    const r = new RouteGen(MAPS[0], seed); r.ensure(50);
    for (const m of r.modules) for (const a of m.anchors.filter(a => a.low && a.side)) {
      const s = m.structures.find(s => s.id === a.sid);
      assert.ok(a.y >= 24 && a.y <= 36);
      assert.ok(a.y <= s.h - 3 + 1e-6);
      assert.ok(Math.hypot(a.v, a.y - 1.6) < ROUTE_CFG.anchorReach, 'reachable from street eye height');
      if (a.y > 21) aboveOldBand++;
      // Recovery rung can connect to a primary rung from its own position.
      if (m.anchors.some(b => !b.low && b.y > a.y + 4 && b.y >= pathY(m, b.u) + 6 && Math.hypot(b.u-a.u,b.v-a.v,b.y-a.y) < ROUTE_CFG.anchorReach)) linked++;
      count++;
    }
  }
  assert.ok(count > 250);
  assert.equal(aboveOldBand, count);
  assert.ok(linked / count > .95, `${linked}/${count} connect onward`);
});

test('other maps keep their previous street recovery height band', () => {
  for (const map of MAPS.slice(1)) {
    const r = new RouteGen(map, 42); r.ensure(15);
    for (const m of r.modules) for (const a of m.anchors.filter(a => a.low && a.side)) assert.ok(a.y >= 15 && a.y <= 21);
  }
});
