/**
 * Keeps the engine's default hand and controller models out of the picture.
 *
 * The game draws its own armored hands, so main.js turns the engine's visuals off once at start
 * (`toggleVisual(false)`). The input manager of IWSDK 1.0.1 still sets `visual.model.visible`
 * to "is this the primary input" on every frame, which brings back a white-outlined hand for
 * every tracked hand (and the stock controller model for controllers).
 *
 * Fix: hide every mesh *inside* each default model the first time it exists. The input manager
 * only touches the model root, so the meshes stay hidden. The visuals are cached by the engine and
 * reused on reconnect, so each one is handled once; the check costs a few property reads per frame.
 * Input itself (joints, pinch, pointers) does not depend on these meshes and keeps working.
 */
const HANDS = ['left', 'right'];
const KINDS = ['hand', 'controller'];
const DONE = Symbol('mobiusHidden');

/** Hides the meshes of one default visual. Returns true if it hid something this call. */
export function hideVisualMeshes(visual) {
  const model = visual?.model;
  if (!model || visual[DONE]) return false;
  let n = 0;
  model.traverse((o) => { if (o.isMesh || o.isSkinnedMesh || o.isLine || o.isPoints) { o.visible = false; n++; } });
  visual[DONE] = true;
  return n > 0;
}

/**
 * Call once per frame with `world.input` (the IWSDK input manager).
 * Returns the number of visuals hidden this call (0 on almost every frame).
 */
export function hideDefaultInputVisuals(input) {
  const adapters = input?.visualAdapters;
  if (!adapters) return 0;
  let hidden = 0;
  for (const kind of KINDS) {
    const byHand = adapters[kind];
    if (!byHand) continue;
    for (const h of HANDS) if (hideVisualMeshes(byHand[h]?.visual)) hidden++;
  }
  return hidden;
}

/** True if no mesh of any default hand / controller visual would be drawn (for tests and the dev console). */
export function defaultInputVisualsHidden(input) {
  const adapters = input?.visualAdapters;
  if (!adapters) return true;
  for (const kind of KINDS) for (const h of HANDS) {
    const model = adapters[kind]?.[h]?.visual?.model;
    if (!model) continue;
    let drawn = false;
    model.traverse((o) => { if ((o.isMesh || o.isSkinnedMesh || o.isLine || o.isPoints) && o.visible) drawn = true; });
    if (drawn) return false;
  }
  return true;
}
