// Regression for the actual WorldChase.update ordering: cam position is captured, world.update rebases and shifts
// the rig, then WorldRenderer receives the old cam vector plus the now-correct rendering camera. Quest distance
// selection must use the fresh view pose so an entire frame of visible trees is not rejected after a rebase.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import * as art from '../src/worlds/art/forestArt.js';
import { createWorldMaterial } from '../src/worlds/art/shaders.js';
import { mapById } from '../src/worlds/maps.js';

test('Quest culling uses fresh tracked view after the rig rebases, despite a pre-update camera position snapshot', async () => {
  const base = art.FOREST_ART.quality, override = art.FOREST_ART.override;
  art.FOREST_ART.quality = 'quest'; art.FOREST_ART.override = null;
  art.setForestLoader(async () => {
    const names = ['tr_trunk_a', ...art.FOREST_ART.heroes];
    return { geo: new Map(names.map(n => [n, [new THREE.BoxGeometry(4, 60, 4), new THREE.BoxGeometry(4, 60, 4)]])), tex: new Map([...art.FOREST_ART.heroes, 'leaf'].map(n => [n, new THREE.Texture()])), manifest: { pieces: [{ name: 'tr_trunk_a', cls: 'trunk' }] } };
  });
  const wr = { world: { off: [0, 0] }, root: new THREE.Group(), mat: createWorldMaterial(mapById('forest').look) };
  const detail = new art.ForestDetail(wr);
  try {
    await detail.whenReady();
    const cell = {}, sink = detail.beginCell(cell, { mat: new THREE.Matrix4() }, 0, 0);
    sink.add('tr_trunk_a', new THREE.Matrix4().makeTranslation(0, 30, -60)); detail.endCell(cell, sink);
    const view = new THREE.PerspectiveCamera(100, 1, 0.1, 1000); view.position.set(0, 40, 0); view.updateMatrixWorld(true);
    const before = view.position.clone(); detail.update(before, view);
    assert.equal(detail.stats.instances, 1);
    wr.world.off[1] += 1500; view.position.z += 1500; view.updateMatrixWorld(true); detail.rebased();
    detail.update(before, view); // exactly the production stale snapshot / fresh rig-camera combination
    assert.equal(detail.stats.instances, 1, 'the same visible tree survives the origin change on the first frame');
  } finally { detail.dispose(); wr.mat.dispose(); art.setForestLoader(null); art.FOREST_ART.quality = base; art.FOREST_ART.override = override; }
});
