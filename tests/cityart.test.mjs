// v0.27 near-art layers: the decoration hash is deterministic, uniform enough, and independent of the data RNG.
import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.localStorage = { getItem: () => null, setItem() {} };
const { artHash } = await import('../src/art/cityArt.js');

test('artHash: deterministic, in [0, 1), roughly uniform, sensitive to every argument', () => {
  assert.equal(artHash(3, -7, 12345, 9), artHash(3, -7, 12345, 9));
  const N = 20000, bins = new Array(10).fill(0);
  for (let k = 0; k < N; k++) { const v = artHash(k % 97 - 48, Math.floor(k / 97) - 100, 777, k); assert.ok(v >= 0 && v < 1); bins[Math.floor(v * 10)]++; }
  for (const b of bins) assert.ok(Math.abs(b - N / 10) < N / 10 * 0.12, `bin ${b}`);
  const base = artHash(1, 2, 3, 4);
  for (const v of [artHash(2, 2, 3, 4), artHash(1, 3, 3, 4), artHash(1, 2, 4, 4), artHash(1, 2, 3, 5)]) assert.notEqual(v, base);
});
