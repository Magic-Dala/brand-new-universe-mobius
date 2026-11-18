// The engine's default hand / controller models stay hidden although IWSDK 1.0.1 sets the model root visible every frame.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { hideDefaultInputVisuals, hideVisualMeshes, defaultInputVisualsHidden } from '../src/input/hideDefaultHands.js';

// a default hand visual as IWSDK builds it: a model root holding the skinned hand and its white outline clone
function fakeHandVisual() {
  const model = new THREE.Group(); const arm = new THREE.Group(); model.add(arm);
  const skin = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()); arm.add(skin);
  const outline = skin.clone(); outline.renderOrder = 999; arm.add(outline);
  return { model, enabled: false };
}
function fakeInput() {
  return { visualAdapters: { hand: { left: {}, right: {} }, controller: { left: {}, right: {} } } };
}
// what XRInputManager.updateControllersAndHands does every frame in IWSDK 1.0.1
function engineFrame(input) {
  for (const kind of ['hand', 'controller']) for (const h of ['left', 'right']) {
    const v = input.visualAdapters[kind][h].visual; if (v) v.model.visible = true; // `visual.model.visible = isPrimary`
  }
}
const meshesShown = (v) => { let n = 0; v.model.traverse((o) => { if (o.isMesh && o.visible) n++; }); return n; };

test('without the fix the engine frame shows both hand meshes (the white outline included)', () => {
  const input = fakeInput(); const v = fakeHandVisual(); v.model.visible = false; input.visualAdapters.hand.left.visual = v;
  engineFrame(input);
  assert.equal(v.model.visible, true);
  assert.equal(meshesShown(v), 2);
  assert.equal(defaultInputVisualsHidden(input), false);
});

test('hands and controllers: nothing drawn after the fix, frame after frame', () => {
  const input = fakeInput();
  assert.equal(hideDefaultInputVisuals(input), 0, 'no visual yet (before any hand is tracked): nothing to do');
  assert.equal(defaultInputVisualsHidden(input), true);
  // the hands connect (the engine loads their models asynchronously)
  input.visualAdapters.hand.left.visual = fakeHandVisual(); input.visualAdapters.hand.right.visual = fakeHandVisual();
  engineFrame(input);
  assert.equal(hideDefaultInputVisuals(input), 2, 'both hands hidden the first frame they exist');
  for (let f = 0; f < 120; f++) { engineFrame(input); assert.equal(hideDefaultInputVisuals(input), 0, 'later frames: nothing more to do'); }
  assert.equal(defaultInputVisualsHidden(input), true);
  for (const h of ['left', 'right']) assert.equal(meshesShown(input.visualAdapters.hand[h].visual), 0);
  // a controller picked up later gets the same treatment
  input.visualAdapters.controller.right.visual = fakeHandVisual();
  engineFrame(input);
  assert.equal(hideDefaultInputVisuals(input), 1);
  engineFrame(input);
  assert.equal(defaultInputVisualsHidden(input), true);
});

test('a cached visual reused on reconnect stays hidden; a missing input manager is harmless', () => {
  const input = fakeInput(); const v = fakeHandVisual(); input.visualAdapters.hand.left.visual = v;
  hideDefaultInputVisuals(input);
  input.visualAdapters.hand.left.visual = undefined; engineFrame(input); // hand lost
  input.visualAdapters.hand.left.visual = v; engineFrame(input);          // same cached visual comes back
  assert.equal(hideDefaultInputVisuals(input), 0);
  assert.equal(meshesShown(v), 0);
  assert.equal(hideDefaultInputVisuals(undefined), 0);
  assert.equal(hideDefaultInputVisuals({}), 0);
  assert.equal(hideVisualMeshes(undefined), false);
  assert.equal(defaultInputVisualsHidden(null), true);
});
