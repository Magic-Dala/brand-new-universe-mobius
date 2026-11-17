// Forest Quest 3 performance correction (v0.45): per-renderer quality resolution (immersive XR → 'quest' before any
// cell streams, desktop unchanged, diagnostic override, no global leak), the Quest profile's submitted-triangle
// reduction with leaves / trunks / all four Tripo heroes retained, and the conservative view selection: both eyes
// (three's XR union camera), pitch / roll, crowns partly on screen, camera inside large objects, head turns without
// movement, motion between re-selections + one frame of lag, missing / invalid cameras, rebases with queued builds and
// 4 km streaming with bounded pools. Real WorldRenderer + ChaseWorld in Node; the REAL kit / hero GLB geometry (parsed
// here, so bounds and triangle counts are the shipped ones), textures stubbed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.performance = globalThis.performance || { now: () => Date.now() };
const THREE = await import('three');
const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
const { mapById } = await import('../src/worlds/maps.js');
const { ChaseWorld } = await import('../src/worlds/chaseWorld.js');
const { WorldRenderer } = await import('../src/worlds/worldRenderer.js');
const art = await import('../src/worlds/art/forestArt.js');

const FOREST = mapById('forest'), SEED = 20261103 + 7919;
const DIR = new URL('../public/models/forest/', import.meta.url);
const MANIFEST = JSON.parse(fs.readFileSync(new URL('forest_kit.json', DIR)));
async function parse(file, convert) {
  const buf = fs.readFileSync(new URL(file, DIR));
  const gltf = await new GLTFLoader().parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
  const out = new Map();
  gltf.scene.traverse((o) => { const m = o.isMesh && /^(.*)_LOD([01])$/.exec(o.name); if (!m) return; if (!out.has(m[1])) out.set(m[1], [null, null]); out.get(m[1])[+m[2]] = convert(o.geometry); });
  return out;
}
const REAL = new Map([...await parse('forest_kit.glb', art.kitGeometry), ...await parse('forest_heroes.glb', art.heroGeometry)]);
function realAssets() {
  art.setForestLoader(async () => ({
    geo: new Map([...REAL].map(([n, [a, b]]) => [n, [a.clone(), b.clone()]])),
    tex: new Map([...art.FOREST_ART.heroes, 'leaf'].map((h) => [h, new THREE.Texture()])), manifest: MANIFEST,
  }));
}
/** The production app as WorldRenderer sees it (main.js: xrActive set on sessionstart; three's xr.isPresenting). */
const xrApp = (on) => ({ xrActive: on, renderer: { xr: { isPresenting: on } } });
function make(app = null, seed = SEED) { const w = new ChaseWorld(FOREST, { seed }); return { w, r: new WorldRenderer(app, FOREST, w) }; }
const stream = (w, r, s) => { w.update(w.pointAt(s), { x: 0, y: 0, z: 0 }, 1 / 60, { force: true }); r.pump(1e9); };

/** Desktop preview camera on the route at s (+ yaw / pitch / roll relative to the route heading). */
function routeCam(w, s, { yaw = 0, pitch = 0.02, roll = 0, dy = 0, fov = 62, aspect = 16 / 9 } = {}) {
  const p = w.pointAt(s), a = w.pointAt(s + 30), cam = new THREE.PerspectiveCamera(fov, aspect, 0.1, 1300);
  cam.position.set(p.x, p.y + dy, p.z);
  cam.rotation.set(pitch, Math.atan2(-(a.x - p.x), -(a.z - p.z)) + yaw, roll, 'YXZ');
  cam.updateMatrixWorld(true); return cam;
}
/** Quest-3-like eyes (asymmetric per-eye frusta, 64 mm IPD) at a head pose + three's union camera (same algorithm as
 * WebXRManager.setProjectionFromUnion / updateUserCamera — what app.camera holds in a session). */
function questEyes(head) {
  const n = 0.1, f = 1300, mk = (l, r, t, b, x) => {
    const c = new THREE.PerspectiveCamera(); c.projectionMatrix.makePerspective(-l * n, r * n, t * n, -b * n, n, f); c.projectionMatrixInverse.copy(c.projectionMatrix).invert();
    c.matrixWorld.copy(head.matrixWorld).multiply(new THREE.Matrix4().makeTranslation(x, 0, 0)); c.matrixWorldInverse.copy(c.matrixWorld).invert(); return c;
  };
  const L = mk(1.376, 0.839, 0.966, 1.192, -0.032), R = mk(0.839, 1.376, 0.966, 1.192, 0.032);
  const pl = L.projectionMatrix.elements, pr = R.projectionMatrix.elements, ipd = 0.064;
  const near = pl[14] / (pl[10] - 1), far = pl[14] / (pl[10] + 1), top = (pl[9] + 1) / pl[5], bottom = (pl[9] - 1) / pl[5];
  const lf = (pl[8] - 1) / pl[0], rf = (pr[8] + 1) / pr[0], zO = ipd / (-lf + rf), xO = zO * -lf;
  const U = new THREE.PerspectiveCamera(); L.matrixWorld.decompose(U.position, U.quaternion, U.scale); U.translateX(xO); U.translateZ(zO); U.updateMatrixWorld(true);
  const n2 = near + zO, f2 = far + zO;
  U.projectionMatrix.makePerspective(near * lf - xO, near * rf + (ipd - xO), top * far / f2 * n2, bottom * far / f2 * n2, n2, f2); U.projectionMatrixInverse.copy(U.projectionMatrix).invert();
  U.fov = THREE.MathUtils.RAD2DEG * 2 * Math.atan(1 / U.projectionMatrix.elements[5]);
  return { L, R, U };
}
/** Move a camera to the centre of its 8 m selection grid cell (moves < step/2 per axis then never cross the grid). */
function gridCentre(w, c) { const st = art.FOREST_ART.step; c.position.set(Math.round((c.position.x - w.off[0]) / st) * st + w.off[0], Math.round(c.position.y / st) * st, Math.round((c.position.z - w.off[1]) / st) * st + w.off[1]); c.updateMatrixWorld(true); return c; }
const frustumOf = (c) => new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse || new THREE.Matrix4().copy(c.matrixWorld).invert()));
/** Selected set: piece record → Set(index). */
function selection(d) { const s = new Map(); d.forEachSelected((name, lod, P, i) => { if (!s.has(P)) s.set(P, new Map()); s.get(P).set(i, lod); }); return s; }
/** Distance-only selection of the same profile from the same eye (the reference the view test may only cut from).
 * eye: a position or a camera (the selection's eye is the rendering camera's own world position). */
function distanceOnly(r, eye) { const d = r.extras; d.update(eye.isObject3D ? eye.getWorldPosition(new THREE.Vector3()) : eye, null); return selection(d); }
/** Sample points of a geometry: every vertex + every triangle centroid (cached). */
const SAMPLES = new WeakMap();
function samplesOf(g) {
  let S = SAMPLES.get(g); if (S) return S;
  const p = g.attributes.position, idx = g.index, n = idx ? idx.count / 3 : p.count / 3, out = new Float32Array((p.count + n) * 3);
  for (let i = 0; i < p.count; i++) out.set([p.getX(i), p.getY(i), p.getZ(i)], i * 3);
  for (let t = 0; t < n; t++) { const k = (p.count + t) * 3; for (let c = 0; c < 3; c++) { const v = idx ? idx.getX(t * 3 + c) : t * 3 + c; out[k] += p.getX(v) / 3; out[k + 1] += p.getY(v) / 3; out[k + 2] += p.getZ(v) / 3; } }
  SAMPLES.set(g, out); return out;
}
/** Placements of `ref` (distance-only) that the view selection `sel` dropped although their actual selected-LOD mesh
 * reaches into any of `cams`' exact frusta (any vertex or triangle centroid inside — no margins, no pads). */
function missed(r, ref, sel, cams) {
  const d = r.extras, F = cams.map(frustumOf), M = new THREE.Matrix4(), T = new THREE.Matrix4().makeTranslation(d.group.position.x, 0, d.group.position.z), v = new THREE.Vector3(), out = [];
  const nameOf = new Map(); for (const e of d.cells.values()) for (const [name, P] of e.pieces) nameOf.set(P, name);
  for (const [P, idx] of ref) for (const [i, lod] of idx) {
    if (sel.get(P)?.has(i)) continue;
    const name = nameOf.get(P), S = samplesOf(d.assets.geo.get(name)[lod]);
    M.fromArray(P.m, i * 16).premultiply(T);
    for (let k = 0; k < S.length; k += 3) { v.set(S[k], S[k + 1], S[k + 2]).applyMatrix4(M); if (F.some((f) => f.containsPoint(v))) { out.push(`${name}#${i}`); break; } }
  }
  return out;
}
const count = (sel) => { let n = 0; for (const s of sel.values()) n += s.size; return n; };
function subset(a, b) { for (const [P, idx] of a) for (const i of idx.keys()) if (!b.get(P)?.has(i)) return false; return true; }

test('profile: XR resolves quest per renderer before streaming; desktop stays high; override wins; nothing global changes', async () => {
  const R = art.resolveForestQuality;
  assert.deepEqual(R({ xr: false, override: null, base: 'high' }), { requested: 'high', resolved: 'high', reason: 'default' });
  assert.deepEqual(R({ xr: true, override: null, base: 'high' }), { requested: 'high', resolved: 'quest', reason: 'xr' });
  assert.deepEqual(R({ xr: true, override: 'high', base: 'high' }), { requested: 'high', resolved: 'high', reason: 'override' });
  assert.deepEqual(R({ xr: false, override: 'quest', base: 'high' }), { requested: 'quest', resolved: 'quest', reason: 'override' });
  assert.equal(R({ xr: true, override: null, base: 'off' }).resolved, 'off', 'legacy only when explicitly requested');
  assert.equal(R({ xr: true, override: 'bogus', base: 'high' }).resolved, 'quest', 'an invalid override is ignored');
  for (const q of ['high', 'low', 'quest']) assert.ok(art.FOREST_ART.lod[q], q);
  realAssets();
  const before = JSON.stringify({ q: art.FOREST_ART.quality, o: art.FOREST_ART.override });
  const xr = make(xrApp(true)), desk = make(null), deskApp = make(xrApp(false));
  // resolved at construction — before the assets arrive and before any cell is streamed / placed
  assert.equal(xr.r.extras.stats.quality, 'quest'); assert.equal(xr.r.extras.stats.reason, 'xr'); assert.equal(xr.r.extras.stats.requested, 'high');
  assert.equal(xr.w.live.size, 0); assert.equal(xr.r.extras.cells.size, 0);
  assert.equal(desk.r.extras.stats.quality, 'high'); assert.equal(deskApp.r.extras.stats.quality, 'high');
  assert.equal(xr.r.extras.beginCell({}, { mat: new THREE.Matrix4() }, 0, 0).quality, 'quest', 'kit sink sees the per-renderer quality');
  assert.equal(JSON.stringify({ q: art.FOREST_ART.quality, o: art.FOREST_ART.override }), before, 'no global quality mutation');
  await xr.r.extras.whenReady(); stream(xr.w, xr.r, 14); xr.r.update(0, xr.w.pointAt(14), routeCam(xr.w, 14));
  assert.equal(xr.r.extras.stats.cull, 'view');
  for (const x of [xr, desk, deskApp]) x.r.dispose();
  { const later = make(null); assert.equal(later.r.extras.stats.quality, 'high', 'a later desktop renderer is unaffected'); later.r.dispose(); }
  art.FOREST_ART.override = 'high';
  try { const o = make(xrApp(true)); assert.equal(o.r.extras.stats.quality, 'high'); assert.equal(o.r.extras.stats.reason, 'override'); o.r.dispose(); }
  finally { art.FOREST_ART.override = null; }
});

test('profile: entering / leaving XR under a live renderer switches only the selection (no override), both ways', async () => {
  realAssets();
  const app = xrApp(false), { w, r } = make(app), d = r.extras; await d.whenReady(); stream(w, r, 120);
  const cam = routeCam(w, 120); r.update(0, cam.position, cam);
  const high = d.stats.tris, placed = d.placements; assert.equal(d.stats.quality, 'high'); assert.equal(d.stats.cull, 'off');
  app.xrActive = true; app.renderer.xr.isPresenting = true; r.update(0, cam.position, cam);
  assert.equal(d.stats.quality, 'quest'); assert.equal(d.stats.reason, 'xr'); assert.equal(d.stats.cull, 'view'); assert.ok(d.stats.tris < high * 0.6, `${d.stats.tris} vs ${high}`);
  assert.equal(d.placements, placed, 'no cell rebuilt'); assert.ok(d.on);
  app.xrActive = false; app.renderer.xr.isPresenting = false; r.update(0, cam.position, cam);
  assert.equal(d.stats.quality, 'high'); assert.equal(d.stats.tris, high); assert.equal(d.stats.profileSwitches, 2);
  r.dispose();
});

test('quest: ≥ 50 % fewer submitted triangles than high on route views; leaves, trunks, crowns and all four Tripo heroes retained', async () => {
  realAssets();
  // the coordinator's five baseline views (start / street / landmark / rear / side) must at least halve; the extra
  // downward bridge view looks straight down the corridor (nothing to cull) at two Tripo statues 50–150 m away whose
  // LOD1 = LOD0 (8k: lighter collapses smear its UV seams, forest-art-upgrade D3) and leafed limb tips — all kept
  // drawn, so that view is held to ≤ 56 %.
  const views = [[14, {}], [120, {}], [290, { pitch: 0.22 }], [640, { yaw: Math.PI }], [640, { pitch: 0.3, yaw: Math.PI / 2 }], [200, { pitch: -0.12, max: 0.56 }]];
  const hi = make(null), qu = make(xrApp(true));
  await hi.r.extras.whenReady(); await qu.r.extras.whenReady();
  const rows = [], fails = [];
  try {
    for (const [s, o] of views) {
      stream(hi.w, hi.r, s); stream(qu.w, qu.r, s);
      const ch = routeCam(hi.w, s, o), cq = routeCam(qu.w, s, o), { U } = questEyes(cq), max = o.max ?? 0.5;
      hi.r.update(0, ch.position, ch); qu.r.update(0, cq.position, cq);
      const H = hi.r.extras.stats, Q = { ...qu.r.extras.stats, byPool: { ...qu.r.extras.stats.byPool }, heroes: { ...qu.r.extras.stats.heroes } };
      qu.r.update(0, U.position, U); const QU = qu.r.extras.stats.tris;
      rows.push({ s, o, high: H.tris, quest: Q.tris, questXR: QU, ratio: +(Q.tris / H.tris).toFixed(3), ratioXR: +(QU / H.tris).toFixed(3), culled: Q.culled, thinned: Q.thinned, byPool: process.env.FQ_POOLS ? Q.byPool : undefined });
      if (!(Q.tris <= H.tris * max)) fails.push(`view s=${s} ${JSON.stringify(o)}: quest ${Q.tris} vs high ${H.tris}`);
      if (!(QU <= H.tris * (max + 0.15))) fails.push(`Quest union view s=${s}: ${QU} vs ${H.tris}`);
      const has = (p) => Object.keys(Q.byPool).some((k) => k.startsWith(p));
      for (const p of ['cn_canopy_', 'tr_trunk_', 'tr_crown_']) assert.ok(has(p), `${p} drawn at s=${s} ${JSON.stringify(o)}`);
      if (s === 14) for (const h of art.FOREST_ART.heroes) assert.ok(Q.heroes[h] > 0, `${h} in the start view`);
    }
    console.log('[quest tris]', JSON.stringify(rows, null, process.env.FQ_POOLS ? 1 : 0));
    assert.deepEqual(fails, []);
  } finally { hi.r.dispose(); qu.r.dispose(); }
});

test('every profile keeps leaves on every limb: canopy clumps never thinned, canopy ranges ≥ crown ranges', () => {
  for (const [q, L] of Object.entries(art.FOREST_ART.lod)) {
    assert.ok(L.canopy[1] >= L.crown[1], `${q}: canopy ${L.canopy} vs crown ${L.crown} (crowns drawn without their leaves)`); // (both canopy LODs leaf every tip)
    const thin = art.FOREST_ART.profile[q]?.thin || {};
    for (const name of Object.keys(thin)) assert.ok(!name.startsWith('cn_') && !name.startsWith('tr_') && !name.startsWith('hero_'), `${q} thins ${name}`);
  }
  for (const [q, P] of Object.entries(art.FOREST_ART.profile)) {
    assert.ok(art.FOREST_ART.lod[q], `${q} profile without ranges`);
    for (const [name, R] of Object.entries(P.piece || {})) assert.ok(name.startsWith('hero_') && R[1] >= 150, `${q} ${name} range ${R}: only landmarks without a lighter LOD, still drawn well past the corridor`);
  }
  assert.ok(!['off', 'legacy'].includes(art.FOREST_ART.xrQuality) && art.FOREST_ART.lod[art.FOREST_ART.xrQuality], 'XR keeps the leaf-spray kit');
});

test('quest thinning: only cosmetic pieces, only beyond their distance, stable across re-selections', async () => {
  realAssets();
  const { w, r } = make(xrApp(true)), d = r.extras; await d.whenReady(); stream(w, r, 120);
  const pos = w.pointAt(120), all = distanceOnly(r, pos), T = art.FOREST_ART.profile.quest.thin;
  for (const name of ['cn_canopy_a', 'cn_canopy_b', 'cn_canopy_c', 'tr_crown_a', 'tr_trunk_a', 'tr_mount', 'hero_roots', 'hero_statue', 'rn_niche']) assert.ok(!(name in T), `${name} never thinned`);
  // every placement within its thin distance (in range) is selected; beyond, the kept share is the hashed fraction
  const q = d.camQ.map((v) => v * art.FOREST_ART.step); let near = 0, far = 0, farKept = 0;
  for (const e of d.cells.values()) for (const [name, P] of e.pieces) {
    const k = d.kinds.get(name), R = d.pieceRanges?.[name] || d.ranges[k.cls]; if (!R) continue;
    for (let i = 0; i < P.n; i++) {
      const dd = Math.hypot(P.m[i * 16 + 12] - q[0], P.m[i * 16 + 13] - q[1], P.m[i * 16 + 14] - q[2]); if (dd >= R[1]) continue;
      const kept = !!all.get(P)?.has(i);
      if (!T[name] || dd < T[name][0]) { near++; assert.ok(kept, `${name} at ${dd.toFixed(1)} m thinned`); } else { far++; if (kept) farKept++; }
    }
  }
  assert.ok(near > 200 && far > 30, `${near} near, ${far} far`); assert.ok(farKept / far > 0.3 && farKept / far < 0.75, `${farKept}/${far} kept`);
  const again = distanceOnly(r, pos); assert.ok(subset(all, again) && subset(again, all), 'same selection on re-select');
  r.dispose();
});

test('view selection is conservative: desktop + both Quest eyes, pitch / roll, partly on-screen crowns, inside objects', async () => {
  realAssets();
  const { w, r } = make(xrApp(true)), d = r.extras; await d.whenReady();
  let checked = 0, cut = 0;
  for (const s of [14, 120, 290, 640]) {
    stream(w, r, s);
    for (const o of [{}, { yaw: Math.PI }, { yaw: 1.2, pitch: 0.5 }, { yaw: -2, pitch: -0.9, roll: 0.6 }, { pitch: 1.45 }, { yaw: 0.4, roll: 1.4, dy: 6 }]) {
      const head = routeCam(w, s, o), { L, R, U } = questEyes(head);
      for (const [view, cams] of [[head, [head]], [U, [L, R]]]) {
        const ref = distanceOnly(r, view);
        r.update(0, head.position, view); assert.equal(d.stats.cull, 'view');
        const sel = selection(d), miss = missed(r, ref, sel, cams);
        assert.deepEqual(miss.slice(0, 5), [], `s=${s} ${JSON.stringify(o)} ${view === U ? 'XR eyes' : 'desktop'}: ${miss.length} visible placements dropped`);
        assert.ok(subset(sel, ref), 'view selection only removes'); checked += count(ref); cut += count(ref) - count(sel);
      }
    }
  }
  assert.ok(cut > checked * 0.2, `view test removes something (${cut}/${checked})`);
  // camera inside a big trunk (tall, nonuniformly scaled), looking straight away from its centre: still drawn
  stream(w, r, 120);
  let big = null; for (const e of d.cells.values()) for (const [name, P] of e.pieces) if (name.startsWith('tr_trunk') && !big) big = { P, name };
  const kb = d.kinds.get(big.name); d._bounds(big.P, kb);
  const c = new THREE.Vector3(big.P.b[0] + w.off[0], big.P.b[1], big.P.b[2] + w.off[1]), inside = new THREE.PerspectiveCamera(62, 16 / 9, 0.1, 1300);
  inside.position.copy(c).add(new THREE.Vector3(0.3, 0.5, 0)); inside.lookAt(c.clone().add(new THREE.Vector3(30, 0.5, 0))); inside.updateMatrixWorld(true);
  const refIn = distanceOnly(r, inside.position);
  r.update(0, inside.position, inside); assert.equal(d.stats.cull, 'view');
  if (refIn.get(big.P)?.has(0)) assert.ok(selection(d).get(big.P)?.has(0), 'camera inside the trunk box keeps the trunk');
  // a point just beyond a widened side plane is cut only when it is farther from the plane than the pad; a long box
  // whose centre is outside but whose extent reaches back across the plane is kept
  const v = d._sel, k0 = { hx: 0, hy: 0, hz: 0 }, I = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  assert.ok(v.np >= 2, 'side planes tested');
  const nx = v.n[0], ny = v.n[1], nz = v.n[2], at = (dist) => new Float32Array([v.ex - nx * dist, v.ey - ny * dist, v.ez - nz * dist]); // (along the plane normal, outward)
  const fwd = [-v.zx, -v.zy, -v.zz], f = 300; // a point well in front, then pushed outside the plane along its normal
  const pt = (dist) => new Float32Array([v.ex + fwd[0] * f - nx * (dist + (fwd[0] * nx + fwd[1] * ny + fwd[2] * nz) * f), v.ey + fwd[1] * f - ny * (dist + (fwd[0] * nx + fwd[1] * ny + fwd[2] * nz) * f), v.ez + fwd[2] * f - nz * (dist + (fwd[0] * nx + fwd[1] * ny + fwd[2] * nz) * f)]);
  assert.equal(art.ForestDetail.sees(v, k0, I, 0, pt(v.pad - 0.2), 0), true, 'within the pad → kept');
  assert.equal(art.ForestDetail.sees(v, k0, I, 0, pt(v.pad + 0.2), 0), false, 'beyond the pad → cut');
  const long = { hx: 20, hy: 20, hz: 20 }; assert.equal(art.ForestDetail.sees(v, long, I, 0, pt(v.pad + 10), 0), true, 'a box reaching across the plane → kept');
  assert.equal(art.ForestDetail.sees(v, k0, I, 0, at(-1), 0), true, 'eye side');
  r.dispose();
});

test('head turns without movement re-select; motion within the margins + one frame of lag stays covered; bounded CPU', async () => {
  realAssets();
  const { w, r } = make(xrApp(true)), d = r.extras; await d.whenReady(); stream(w, r, 290);
  const head = routeCam(w, 290), { U } = questEyes(head); r.update(0, head.position, U);
  const r0 = d.stats.rebuilds; r.update(0, head.position, U); assert.equal(d.stats.rebuilds, r0, 'same pose: no re-selection');
  const before = selection(d);
  // heading-only change (no movement): re-selects and draws what is behind
  const back = routeCam(w, 290, { yaw: Math.PI }), { U: Ub, L: Lb, R: Rb } = questEyes(back); r.update(0, back.position, Ub);
  assert.ok(d.stats.rebuilds > r0, 'turning around re-selects'); const after = selection(d);
  assert.ok(!subset(after, before), 'the rear forest is now drawn');
  assert.deepEqual(missed(r, distanceOnly(r, Ub), (r.update(0, back.position, Ub), selection(d)), [Lb, Rb]), []);
  // between re-selections: rotations under the turn threshold and moves under `move` do not re-select, and the frustum
  // rendered one fast frame later (+12°, +0.6 m) is still covered by the frozen selection
  const V = art.FOREST_ART.profile.quest.view;
  for (const [axis, sgn] of [['yaw', 1], ['yaw', -1], ['pitch', 1], ['pitch', -1], ['roll', 1]]) {
    for (const trans of [[0, 0, 0], [V.move * 0.95, 0, 0], [0, V.move * 0.6, -V.move * 0.7]]) {
      const base = gridCentre(w, routeCam(w, 290, { yaw: 0.7 })), bu = questEyes(base).U; r.update(0, base.position, bu);
      const n0 = d.stats.rebuilds, ref = distanceOnly(r, bu); r.update(0, base.position, bu); const sel = selection(d);
      const o = { yaw: 0.7 }; o[axis] = (o[axis] || (axis === 'pitch' ? 0.02 : 0)) + sgn * (V.turn - 0.5) * Math.PI / 180;
      const step = routeCam(w, 290, o); step.position.copy(base.position).add(new THREE.Vector3(...trans)); step.updateMatrixWorld(true);
      const su = questEyes(step).U, n1 = d.stats.rebuilds; r.update(0, step.position, su);
      assert.equal(d.stats.rebuilds, n1, `${axis} ${sgn} ${trans}: stays within the margins`);
      const o2 = { ...o }; o2[axis] += sgn * 12 * Math.PI / 180;
      const lag = routeCam(w, 290, o2); lag.position.copy(base.position).add(new THREE.Vector3(...trans)).add(new THREE.Vector3(0.35, 0.2, 0.4)); lag.updateMatrixWorld(true);
      const { L: ll, R: lr } = questEyes(lag);
      assert.deepEqual(missed(r, ref, sel, [ll, lr]).slice(0, 5), [], `${axis} ${sgn} ${trans}: lagged frame covered`);
      assert.ok(n0 > 0);
    }
  }
  // a slow full turn on the spot (2° per frame): ~360 / turn re-selections, pools / instance buffers not reallocated
  const meshes = new Map([...d.pools].map(([k, p]) => [k, p.mesh])), n0 = d.stats.rebuilds, t0 = performance.now();
  for (let a = 0; a <= 360; a += 2) { const c = routeCam(w, 290, { yaw: a * Math.PI / 180 }); r.update(0, c.position, questEyes(c).U); }
  const turns = d.stats.rebuilds - n0, ms = performance.now() - t0;
  assert.ok(turns >= Math.floor(360 / (V.turn + 2)) - 2 && turns <= 360 / V.turn * 1.6 + 2, `${turns} re-selections`);
  let realloc = 0; for (const [k, m] of meshes) if (d.pools.get(k)?.mesh !== m) realloc++;
  assert.ok(realloc <= 4, `${realloc} pools reallocated during the turn`);
  console.log('[quest turn]', JSON.stringify({ turns, msTotal: +ms.toFixed(1), maxRebuildMs: d.stats.maxRebuildMs, instances: d.stats.instances, placements: d.placements }));
  r.dispose();
});

test('missing / invalid / orthographic camera → conservative distance-only selection', async () => {
  realAssets();
  const { w, r } = make(xrApp(true)), d = r.extras; await d.whenReady(); stream(w, r, 120);
  const pos = w.pointAt(120), ref = distanceOnly(r, pos); assert.equal(d.stats.cull, 'fallback');
  const bad = routeCam(w, 120); bad.matrixWorld.elements[0] = NaN; bad.updateWorldMatrix = () => {};
  const flat = new THREE.PerspectiveCamera(62, 1, 0.1, 100); flat.position.copy(pos); flat.updateMatrixWorld(true); flat.projectionMatrix.elements[0] = NaN;
  const ortho = new THREE.OrthographicCamera(-50, 50, 50, -50, 0.1, 1000); ortho.position.copy(pos); ortho.updateMatrixWorld(true);
  for (const v of [undefined, null, {}, bad, flat, ortho]) {
    const good = routeCam(w, 120, { yaw: Math.PI }); r.update(0, pos, good); assert.equal(d.stats.cull, 'view');
    r.update(0, pos, v); assert.equal(d.stats.cull, 'fallback');
    const s = selection(d); assert.ok(subset(ref, s) && subset(s, ref), `fallback equals distance-only for ${v?.type || v}`);
  }
  r.dispose();
});

test('desktop high is unchanged by the view hook: same selection with / without a camera, no turn re-selections', async () => {
  realAssets();
  const { w, r } = make(null), d = r.extras; await d.whenReady(); stream(w, r, 290);
  const pos = w.pointAt(290), ref = distanceOnly(r, pos), n0 = d.stats.rebuilds;
  for (let a = 0; a < 360; a += 30) { const c = routeCam(w, 290, { yaw: a * Math.PI / 180 }); c.position.copy(pos); c.updateMatrixWorld(true); r.update(0, pos, c); }
  assert.equal(d.stats.rebuilds, n0); assert.equal(d.stats.cull, 'off'); assert.equal(d.stats.culled, 0); assert.equal(d.stats.thinned, 0);
  const s = selection(d); assert.ok(subset(ref, s) && subset(s, ref));
  assert.deepEqual(d.ranges, art.FOREST_ART.lod.high);
  r.dispose();
});

test('rebase with queued builds under the quest view selection: same physical pose → same selection, still covered', async () => {
  realAssets();
  const { w, r } = make(xrApp(true)), d = r.extras; await d.whenReady();
  w.update(w.pointAt(10), { x: 0, y: 0, z: 0 }, 1 / 60, { force: true }); // cells created, builds queued
  w.rebase(-777, 1234); r.pump(1e9);
  const c = routeCam(w, 14), { L, R, U } = questEyes(c); r.update(0, c.position, U);
  const ref = distanceOnly(r, U); r.update(0, c.position, U); const sel = selection(d);
  assert.deepEqual(missed(r, ref, sel, [L, R]), []);
  const n0 = d.stats.rebuilds;
  w.rebase(500, -300); const c2 = routeCam(w, 14); r.update(0, c2.position, questEyes(c2).U); // the camera moves with the origin
  assert.equal(d.stats.rebuilds, n0, 'a rebase alone does not re-select (route-space eye + grid)');
  const sel2 = selection(d); assert.ok(subset(sel, sel2) && subset(sel2, sel));
  assert.ok(Math.abs(d.group.position.x - w.off[0]) < 1e-9 && Math.abs(d.group.position.z - w.off[1]) < 1e-9);
  r.dispose();
});

test('quest streaming over 4 km with a turning head: live cells only, bounded pools / instances, selection CPU budget', async () => {
  realAssets();
  const refs0 = art.forestCacheState().refs, { w, r } = make(xrApp(true)), d = r.extras; await d.whenReady();
  let maxPools = 0, maxInst = 0, maxMs = 0, rebases0 = w.stats.rebases, k = 0; const ms = [];
  for (let s = 10; s < 4100; s += 25, k++) {
    stream(w, r, s);
    const c = routeCam(w, s, { yaw: Math.sin(k * 0.7) * 1.6, pitch: Math.sin(k * 0.3) * 0.4 }); r.update(0, c.position, questEyes(c).U);
    assert.ok(d.cells.size <= w.live.size); for (const cell of d.cells.keys()) assert.ok(w.live.get(cell.idx) === cell);
    maxPools = Math.max(maxPools, d.pools.size); maxInst = Math.max(maxInst, d.stats.instances); ms.push(d.stats.rebuildMs);
  }
  ms.sort((a, b) => a - b); maxMs = ms[ms.length - 1];
  assert.ok(w.stats.rebases > rebases0, 'crossed a floating-origin rebase');
  assert.ok(maxPools <= REAL.size * 2, `${maxPools} pools`);
  let cap = 0; for (const p of d.pools.values()) cap += p.cap; assert.ok(cap < 8 * Math.max(64, maxInst) + 16 * d.pools.size, `${cap} instance slots for ≤ ${maxInst} instances`);
  console.log('[quest 4km]', JSON.stringify({ maxPools, maxInst, p90Ms: ms[Math.floor(ms.length * 0.9)], maxMs, rebases: w.stats.rebases - rebases0 }));
  r.dispose(); assert.equal(art.forestCacheState().refs, refs0);
});
