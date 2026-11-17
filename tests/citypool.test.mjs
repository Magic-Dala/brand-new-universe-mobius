// v0.26 packed detail pools: only used instances are drawn; release keeps every live handle pointing at its data.
import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.performance = globalThis.performance || { now: () => Date.now() };
const THREE = await import('three');
const { SlotPool } = await import('../src/art/city.js');

test('packed pool: count = used, release swaps the last live instance in, handles follow, attributes move along', () => {
  const g = new THREE.PlaneGeometry(1, 1); g.setAttribute('aSize', new THREE.InstancedBufferAttribute(new Float32Array(10 * 2), 2));
  const m = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial(), 10); m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(30), 3);
  const P = new SlotPool(m, 10), M = new THREE.Matrix4(), hs = [];
  assert.equal(m.count, 0);
  for (let k = 0; k < 10; k++) { const h = P.alloc(); P.set(h, M.makeTranslation(k, 0, 0)); g.attributes.aSize.setXY(h.i, k, -k); m.setColorAt(h.i, new THREE.Color(k / 10, 0, 0)); hs.push([h, k]); }
  assert.equal(P.alloc(), null, 'full → null (pool miss)');
  assert.equal(m.count, 10);
  let rnd = 7; const R = () => (rnd = (rnd * 16807) % 2147483647) / 2147483647;
  for (let n = 0; n < 6; n++) { const j = Math.floor(R() * hs.length); P.release(hs[j][0]); hs.splice(j, 1); }
  assert.equal(m.count, 4); assert.equal(P.used, 4);
  const e = new THREE.Matrix4(), c = new THREE.Color();
  for (const [h, k] of hs) {
    assert.ok(h.i >= 0 && h.i < 4);
    m.getMatrixAt(h.i, e); assert.equal(e.elements[12], k, 'matrix follows its handle');
    assert.equal(g.attributes.aSize.getX(h.i), k); assert.equal(g.attributes.aSize.getY(h.i), -k);
    m.getColorAt(h.i, c); assert.ok(Math.abs(c.r - k / 10) < 1e-6);
  }
  P.release(hs[0][0]); P.release(hs[0][0]); // double release is ignored
  assert.equal(P.used, 3);
});
