// v0.25 stage 0 — gameplay-data regression for the city art upgrade.
// The art upgrade must never change what the player collides with, swings from or collects. This test hashes, for a
// fixed seed: the route tiles, every module's colliders (layered boxes), anchors (pos + normal + kind) and the
// building data the coins / checkpoints use — for the whole story route AND a long endless run with several origin
// rebases (positions are made absolute with world.rebaseOffset, so the hash is rebase-independent).
// GOLDEN was recorded on the v0.24 code BEFORE any art change. If it changes, gameplay data changed: find out why.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.performance = globalThis.performance || { now: () => Date.now() };
const { CityWorld } = await import('../src/data/cityWorld.js');

const GOLDEN = { story: '4d0452c0', endless: 'd2848f68' }; // recorded on v0.24 (2026-10-26) before the art upgrade

function fnv(str) { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); }
const r3 = (x) => (Math.round(x * 1000) / 1000).toFixed(3);

function run(mode, metres) {
  const w = new CityWorld({ autoReady: true }); w.reset({ mode: 'story' });
  const seen = new Map();
  const pos = { x: 0, y: 0, z: 0 }, vel = { x: 0, y: 0, z: 0 };
  const grab = () => {
    const [ox, oz] = w.rebaseOffset; // world = absolute + offset
    for (const c of w.cells.values()) {
      const key = `${c.i - 0},${c.j - 0}`; // cell indices are absolute already
      if (seen.has(key)) continue;
      const cols = c.colliders.map((k) => [k.id, r3(k.x - ox), r3(k.z - oz), r3(k.yaw), r3(k.hw), r3(k.hd), r3(k.y0), r3(k.y1)].join(':')).sort();
      const anch = c.anchors.map((a) => [a.id, a.kind, r3(a.pos[0] - ox), r3(a.pos[1]), r3(a.pos[2] - oz), r3(a.normal[0]), r3(a.normal[2])].join(':')).sort();
      const blds = c.buildings.map((b) => [b.id, b.style, b.family, r3(b.h), b.shops ? 1 : 0, (b.faces || []).map((f) => f.f + '/' + r3(f.w)).join('|')].join(':')).sort();
      const cp = c.checkpoint ? [c.checkpoint.kind, ...c.checkpoint.pos.map((v, i) => r3(v - (i === 0 ? ox : i === 2 ? oz : 0)))].join(':') : '';
      seen.set(key, `${key}#${c.kind}#${cols.join(',')}#${anch.join(',')}#${blds.join(',')}#${cp}`);
    }
  };
  w.update(pos, vel, 1 / 60, { force: true }); grab();
  let s = 0, f = 0;
  w.on({ rebased: () => {} });
  while (s < metres) {
    s += 0.3; f++;
    if (mode === 'endless' && s > 700 && w.mode !== 'endless') w.mode = 'endless';
    const pd = w.route.pending; if (pd && w.curTile >= pd.idx - 1) { const ex = pd.allowed || pd.exits; w.choose(ex[f % ex.length]); }
    const p = w.pointAt(s); pos.x = p.x; pos.y = p.y; pos.z = p.z; vel.x = 18;
    w.update(pos, vel, 1 / 60); if (f % 20 === 0) grab();
  }
  grab();
  const tiles = w.route.tiles.map((t) => `${t.kind}@${t.cell}/${t.heading}`).join(';');
  const cells = [...seen.values()].sort().join('\n');
  return { hash: fnv(tiles + '\n' + cells), cells: seen.size, rebases: w.stats.rebases, tiles: w.route.tiles.length };
}

test('gameplay data golden: story route (colliders, anchors, buildings, checkpoints) unchanged by the art upgrade', () => {
  const r = run('story', 640);
  assert.ok(r.cells > 20, 'cells ' + r.cells);
  if (GOLDEN.story === 'PENDING') console.log('GOLDEN story', r); else assert.equal(r.hash, GOLDEN.story, JSON.stringify(r));
});
test('gameplay data golden: endless run with origin rebases unchanged by the art upgrade', () => {
  const r = run('endless', 7000);
  assert.ok(r.rebases >= 2, 'rebases ' + r.rebases);
  if (GOLDEN.endless === 'PENDING') console.log('GOLDEN endless', r); else assert.equal(r.hash, GOLDEN.endless, JSON.stringify(r));
});
test('separation: src/data never imports the art / renderer code (decoration randomness cannot reach gameplay data)', () => {
  for (const f of readdirSync(new URL('../src/data/', import.meta.url))) {
    if (!f.endsWith('.js')) continue;
    const src = readFileSync(new URL('../src/data/' + f, import.meta.url), 'utf8');
    assert.ok(!/from ['"]\.\.\/art\//.test(src) && !/cityQuality/.test(src), `${f} imports art code`);
  }
});
