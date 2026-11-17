import test from 'node:test';
import assert from 'node:assert/strict';
import { MAPS } from '../src/worlds/maps.js';
import { RouteGen, FOLD_STYLES, pathY } from '../src/worlds/route.js';

test('streamed folded districts have all six silhouettes and recur beyond landmarks', () => {
  for (const seed of [1, 42, 20269022]) {
    const r = new RouteGen(MAPS[0], seed); r.ensure(80);
    const seen = new Set(); let recurring = 0, total = 0, oldTotal = 0;
    for (const m of r.modules) {
      const blocks = m.structures.filter(s => s.kind === 'foldBlock');
      if (m.type === 'landmark') { assert.equal(blocks.length, 8); oldTotal += 3; }
      else if (blocks.length) { assert.equal(blocks.length, 3); recurring++; }
      for (const s of blocks) {
        seen.add(s.foldStyle); total++;
        assert.ok(s.y0 >= pathY(m, s.u) + 58 - 1e-6, 'leave headroom for higher swings and hanging props');
        for (const t of s.tiers) assert.ok(t.d > 0 && t.w > 0 && t.y1 > t.y0);
        assert.ok(m.anchors.every(a => a.sid !== s.id), 'overhead decoration does not replace reachable roof anchors');
      }
    }
    assert.deepEqual([...seen].sort(), [...FOLD_STYLES].sort());
    assert.ok(recurring >= 5, 'ordinary later sections include overhead groups');
    assert.ok(total >= oldTotal * 3, `${total} blocks versus old ${oldTotal}`);
    const again = new RouteGen(MAPS[0], seed); again.ensure(80);
    assert.deepEqual(again.modules, r.modules, 'same route seed yields the same scenery');
  }
});

test('other seven maps do not receive Foldscape aerial building variants', () => {
  for (const map of MAPS.slice(1)) {
    const r = new RouteGen(map, 42); r.ensure(35);
    assert.ok(r.modules.every(m => m.structures.every(s => !s.foldStyle && s.kind !== 'foldBlock')));
  }
});
