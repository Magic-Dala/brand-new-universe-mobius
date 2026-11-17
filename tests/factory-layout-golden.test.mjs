// v0.31 stage 0 — gameplay-layout regression for the factory interior art rebuild.
// The art rebuild must never move what the player stands on, teleports around, aims at or reads as a lane:
// spawn, PLAYER START arena circle, teleport blockers / colliders, roof breach, door, boss hover / entry path,
// arcade lane + boss settings, story-combat tuning. This test hashes every one of those values AND the three
// generated / data files byte for byte.
// GOLDEN was recorded on v0.30 (2026-11-02) BEFORE any v0.31 change. Never edit it: if it fails, the layout changed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
globalThis.localStorage = { getItem: () => null, setItem() {} };
const { INTERIOR, interiorSurface, clearance } = await import('../src/data/factory.js');
const { FACTORY_LAYOUT } = await import('../src/data/factoryLayout.gen.js');
const { STORY_COMBAT } = await import('../src/data/storyCombat.js');
const { ARCADE } = await import('../src/data/layout.js');
const { FAN_ROW } = await import('../src/game/arcade.js');
const { DEFAULTS } = await import('../src/core/settings.js');

const GOLDEN = {
  interior: '5625ce5b', surface: '2465894b', layout: '04e0c37b', arcade: '482ac080', clearance: '02507088', lanes: '38365ddd',
  files: {
    'art/factory/factory_layout.json': '5ff217212dee0aff729d1a9e9e51d79b684f52bfb8310c3284d96407e441293f',
    'src/data/factoryLayout.gen.js': '8b977d83b6f999202d4c4028e60bc9145e32c3e0d717c2f3cbce42ef7bc1579d',
    'src/data/factory.js': 'f0c686a3b35c10ffe8a3b9434cea3ff7ad2ea99d306de9f5795f69ca7b41b285',
  },
};

function fnv(str) { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); }
const canon = (v) => JSON.stringify(v, (k, x) => (typeof x === 'number' ? Math.round(x * 1000) / 1000 : x));
const sha = (p) => createHash('sha256').update(readFileSync(new URL('../' + p, import.meta.url))).digest('hex');

export function current() {
  const grid = [];
  for (let x = -11; x <= 11; x += 0.5) for (let z = -18; z <= 18; z += 0.5) grid.push(Math.round(Math.min(clearance(x, z), 99) * 1000));
  return {
    interior: fnv(canon(INTERIOR)),
    surface: fnv(canon(interiorSurface()) + canon(interiorSurface(0))),
    layout: fnv(canon({ size: FACTORY_LAYOUT.size, breach: FACTORY_LAYOUT.breach, spawn: FACTORY_LAYOUT.spawn, arena: FACTORY_LAYOUT.arenaCircle, boss: FACTORY_LAYOUT.bossHover, blockers: FACTORY_LAYOUT.blockers })),
    arcade: fnv(canon({ ARCADE, FAN_ROW, STORY_COMBAT })),
    clearance: fnv(grid.join(',')),
    lanes: fnv(canon(Object.fromEntries(Object.entries(DEFAULTS).filter(([k]) => /^arcade/.test(k)).sort()))), // lane / boss distance / scale settings
    files: Object.fromEntries(Object.keys(GOLDEN.files).map((p) => [p, sha(p)])),
  };
}

test('factory gameplay layout is unchanged (spawn, arena, blockers, breach, door, boss, lanes)', () => {
  const c = current();
  if (process.env.PRINT_GOLDEN) console.log(JSON.stringify(c, null, 1));
  for (const k of ['interior', 'surface', 'layout', 'arcade', 'clearance', 'lanes']) assert.equal(c[k], GOLDEN[k], `${k} changed`);
  for (const [p, h] of Object.entries(GOLDEN.files)) assert.equal(c.files[p], h, `${p} changed`);
});
