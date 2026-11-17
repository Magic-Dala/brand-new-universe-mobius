import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import * as art from '../src/worlds/art/forestArt.js';
import { createWorldMaterial } from '../src/worlds/art/shaders.js';
import { mapById } from '../src/worlds/maps.js';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise(r => setTimeout(r, 0));
function observedTexture() { const t = new THREE.Texture(); let disposed = 0; t.addEventListener('dispose', () => disposed++); return { t, count: () => disposed }; }
function observedGltf() {
  const scene = new THREE.Group(), g = new THREE.BoxGeometry(), m = new THREE.MeshBasicMaterial();
  let disposed = 0; g.addEventListener('dispose', () => disposed++); m.addEventListener('dispose', () => disposed++);
  scene.add(new THREE.Mesh(g, m)); return { gltf: { scene }, count: () => disposed };
}

test('forest failed bundle disposes successful and late resources', async () => {
  const early = observedTexture(), late = observedTexture(), gltf = observedGltf(), gate = deferred();
  await assert.rejects(art.loadForestAssets([
    Promise.reject(new Error('manifest unavailable')), Promise.resolve(gltf.gltf), gate.promise,
    Promise.resolve(early.t), Promise.resolve(new THREE.Texture()), Promise.resolve(new THREE.Texture()), Promise.resolve(new THREE.Texture()),
  ]), /manifest unavailable/);
  assert.equal(early.count(), 1); assert.equal(gltf.count(), 2);
  gate.resolve({ scene: new THREE.Group().add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial({ map: late.t }))) });
  await tick(); assert.equal(late.count(), 1);
});

test('forest timeout builds fallback and never attaches a late asset result', async () => {
  const gate = deferred(), timeout = art.FOREST_ART.loadTimeoutMs;
  art.FOREST_ART.loadTimeoutMs = 10;
  art.setForestLoader(() => gate.promise);
  const wr = { mat: createWorldMaterial(mapById('forest').look), root: new THREE.Group(), world: { off: [0, 0] } };
  const detail = new art.ForestDetail(wr);
  try {
    await Promise.race([detail.whenReady(), new Promise((_, reject) => setTimeout(() => reject(new Error('no bounded fallback')), 200))]);
    assert.equal(detail.loading, false); assert.equal(detail.usable, false); assert.equal(detail.stats.assets, 'failed');
    assert.equal(detail.beginCell({}, {}, 0, 0).on, false, 'kit selects legacy geometry before streaming');
    assert.equal(art.forestCacheState().refs, 0);
    const t = observedTexture(), g = new THREE.BoxGeometry(); let n = 0; g.addEventListener('dispose', () => n++);
    gate.resolve({ geo: new Map([['late', [g]]]), tex: new Map([['late', t.t]]), manifest: { pieces: [] } });
    await tick(); assert.equal(detail.assets, null); assert.equal(n, 1); assert.equal(t.count(), 1);
  } finally { detail.dispose(); wr.mat.dispose(); art.setForestLoader(null); art.FOREST_ART.loadTimeoutMs = timeout; }
});

test('forest bundle deadline releases partial results while another request hangs', async () => {
  const timeout = art.FOREST_ART.loadTimeoutMs, gate = deferred(), gltf = observedGltf(), t = observedTexture();
  art.FOREST_ART.loadTimeoutMs = 10;
  try {
    await assert.rejects(art.loadForestAssets([
      Promise.resolve({ pieces: [] }), Promise.resolve(gltf.gltf), gate.promise,
      Promise.resolve(t.t), Promise.resolve(new THREE.Texture()), Promise.resolve(new THREE.Texture()), Promise.resolve(new THREE.Texture()),
    ]), /timed out/);
    assert.equal(gltf.count(), 2); assert.equal(t.count(), 1);
    const late = observedGltf(); gate.resolve(late.gltf); await tick(); assert.equal(late.count(), 2);
  } finally { art.FOREST_ART.loadTimeoutMs = timeout; }
});
