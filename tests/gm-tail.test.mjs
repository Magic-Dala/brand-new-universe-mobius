// v0.46 Green Maniac tail during hit reactions: the real GLB through the real loader, state machine and TailSpring (node,
// textures dropped in memory). From steady riding, a head / body hit must not pin any tail segment at the spring's
// maxAngle for more than 3 consecutive 60 fps frames (the tail stays natural; a 0.08 s fade-in pinned the tip ≈ 0.14 s).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.window = globalThis.window || { addEventListener() {} };
globalThis.self = globalThis;
globalThis.ProgressEvent = globalThis.ProgressEvent || class ProgressEvent { constructor(type, init) { Object.assign(this, init); this.type = type; } }; // (three's FileLoader reports progress with it)
globalThis.document = globalThis.document || { baseURI: 'http://localhost/' };

/** the GLB with images / textures removed from its JSON chunk (geometry, skin and clips untouched) */
function glbWithoutTextures(file) {
  const buf = readFileSync(file), jsonLen = buf.readUInt32LE(12);
  const J = JSON.parse(buf.subarray(20, 20 + jsonLen).toString());
  delete J.images; delete J.textures; delete J.samplers;
  for (const m of J.materials || []) {
    const p = m.pbrMetallicRoughness; if (p) { delete p.baseColorTexture; delete p.metallicRoughnessTexture; }
    delete m.normalTexture; delete m.emissiveTexture; delete m.occlusionTexture;
  }
  let js = Buffer.from(JSON.stringify(J)); if (js.length % 4) js = Buffer.concat([js, Buffer.alloc(4 - (js.length % 4), 0x20)]);
  const bin = buf.subarray(20 + jsonLen), hdr = Buffer.alloc(20);
  hdr.write('glTF', 0); hdr.writeUInt32LE(2, 4); hdr.writeUInt32LE(20 + js.length + bin.length, 8); hdr.writeUInt32LE(js.length, 12); hdr.write('JSON', 16);
  return Buffer.concat([hdr, js, bin]);
}
const glb = glbWithoutTextures(new URL('../public/models/green_maniac_mixamo_tail.glb', import.meta.url));
globalThis.fetch = async () => new Response(glb);

const THREE = await import('three');
const { loadGreenManiacAnimated, createGreenManiacAnimated } = await import('../src/art/greenManiacAnimated.js');
const { TAIL_SPRING_DEFAULTS } = await import('../src/art/TailSpring.js');
const model = await loadGreenManiacAnimated();
const Y = new THREE.Vector3(0, 1, 0), pw = new THREE.Quaternion(), rw = new THREE.Quaternion(), bw = new THREE.Quaternion(), a = new THREE.Vector3(), b = new THREE.Vector3();

/** longest run of consecutive 60 fps frames with any tail segment at (≥ 98 % of) maxAngle, over 2 s after `go` */
function pinnedRun(go) {
  const m = createGreenManiacAnimated(model), segs = m.tailSpring.segs, dt = 1 / 60, lim = TAIL_SPRING_DEFAULTS.maxAngle * 0.98;
  let t = 0; for (let k = 0; k < 120; k++) { t += dt; m.update(dt, t); } // steady riding (setState('stand') at creation → ride below)
  m.setState('ride'); for (let k = 0; k < 120; k++) { t += dt; m.update(dt, t); }
  assert.equal(go(m), true);
  let run = 0, worst = 0, peak = 0;
  for (let k = 0; k < 120; k++) {
    t += dt; m.update(dt, t);
    let pinned = false;
    for (const s of segs) {
      s.bone.parent.getWorldQuaternion(pw); rw.copy(pw).multiply(s.restQ); s.bone.getWorldQuaternion(bw);
      const ang = Math.acos(THREE.MathUtils.clamp(a.copy(Y).applyQuaternion(rw).dot(b.copy(Y).applyQuaternion(bw)), -1, 1));
      peak = Math.max(peak, ang); if (ang >= lim) pinned = true;
    }
    run = pinned ? run + 1 : 0; worst = Math.max(worst, run);
  }
  return { worst, peak };
}

test('model has the tail chain and the hit clips', () => {
  const m = createGreenManiacAnimated(model);
  assert.ok(m.tailSpring && m.tailSpring.segs.length >= 4); assert.ok(model.clips.headHit && model.clips.bodyHit);
});
for (const variant of ['head', 'body']) {
  test(`${variant} hit from riding: no tail segment pinned at maxAngle for more than 3 frames`, () => {
    const r = pinnedRun((m) => m.setState('hit', variant));
    assert.ok(r.worst <= 3, `pinned ${r.worst} consecutive frames (peak ${r.peak.toFixed(2)} rad)`);
  });
}
