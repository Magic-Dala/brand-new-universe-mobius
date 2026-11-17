// Coordinator regression: the Redrock shader samples route-space rock grain using uOff.
// After an origin rebase, a fixed route point must retain its shader coordinates in
// the main canyon and camera-following distant material, including shared hero uniforms.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { RedrockDetail, REDROCK_ART, setRedrockLoader, redrockCacheState } from '../src/worlds/art/redrockArt.js';

test('redrock: origin rebases keep rock shader coordinates stable for main, hero and distant canyon materials', async () => {
  setRedrockLoader(async () => ({ geo: new Map(), tex: new Map(REDROCK_ART.heroes.map(h => [h, new THREE.Texture()])), manifest: { pieces: [] } }));
  const material = () => new THREE.ShaderMaterial({ uniforms: { uOff: { value: new THREE.Vector2() } } });
  const world = { off: [0, 0] }, wr = { world, root: new THREE.Group(), mat: material(), backMat: material(), floorMat: material() };
  const d = new RedrockDetail(wr);
  try {
    await d.whenReady();
    const routePoint = new THREE.Vector2(37, -71), shaderPoint = m => routePoint.clone().add(new THREE.Vector2(...world.off)).sub(m.uniforms.uOff.value);
    d.update(new THREE.Vector3(0, 72, 0));
    world.off[0] = -1500; world.off[1] = 1800;
    d.rebased(); d.update(new THREE.Vector3(-1500, 72, 1800));
    for (const m of [wr.mat, wr.backMat, ...d.heroMats.values()]) {
      assert.deepEqual(m.uniforms.uOff.value.toArray(), world.off, 'shader receives the current origin offset');
      assert.ok(shaderPoint(m).distanceTo(routePoint) < 1e-6, 'a fixed rock point keeps its grain coordinates after rebasing');
    }
  } finally {
    d.dispose(); wr.mat.dispose(); wr.backMat.dispose(); wr.floorMat.dispose(); setRedrockLoader(null);
  }
  assert.equal(redrockCacheState().refs, 0);
});
