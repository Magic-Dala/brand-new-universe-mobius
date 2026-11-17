// Generic helpers for the user-provided (static, unrigged) Tripo GLB characters:
// bake a GLB mesh into float geometry (rotate / scale / recentre), and auto-skin it to a
// simple bone chain from capsule distances (blends only between bones ≤ 2 links apart).
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const _v = new THREE.Vector3(), _w = new THREE.Vector3();

/** Load a GLB and bake its first mesh: `pre` matrix applied in model units, then scaled to `size`. */
export async function loadBakedGLB(path, { rotate = null, height = null, width = null, center = 'xz' } = {}) {
  const base = (import.meta.env && import.meta.env.BASE_URL) || './'; // '/' in dev, './' in the build
  const href = new URL(path.startsWith('/') ? path : base + path, document.baseURI).href;
  const gltf = await new GLTFLoader().loadAsync(href);
  let src = null; gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => { if (o.isMesh && !src) src = o; });
  if (!src) throw new Error(`${path}: no mesh`);
  const g0 = src.geometry, n = g0.attributes.position.count;
  const M = new THREE.Matrix4(); if (rotate) M.copy(rotate); M.multiply(src.matrixWorld);
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  const N = new THREE.Matrix3().getNormalMatrix(M);
  const box = new THREE.Box3();
  for (let i = 0; i < n; i++) { _v.fromBufferAttribute(g0.attributes.position, i).applyMatrix4(M); box.expandByPoint(_v); pos.set([_v.x, _v.y, _v.z], i * 3); }
  const size = box.getSize(new THREE.Vector3());
  const k = height ? height / size.y : width ? width / size.x : 1;
  const c = box.getCenter(new THREE.Vector3());
  const off = new THREE.Vector3(center.includes('x') ? -c.x : 0, center.includes('y') ? -c.y : -box.min.y, center.includes('z') ? -c.z : 0);
  for (let i = 0; i < n; i++) { pos[i * 3] = (pos[i * 3] + off.x) * k; pos[i * 3 + 1] = (pos[i * 3 + 1] + off.y) * k; pos[i * 3 + 2] = (pos[i * 3 + 2] + off.z) * k; }
  for (let i = 0; i < n; i++) { _v.fromBufferAttribute(g0.attributes.normal, i).applyMatrix3(N).normalize(); nrm.set([_v.x, _v.y, _v.z], i * 3); uv[i * 2] = g0.attributes.uv.getX(i); uv[i * 2 + 1] = g0.attributes.uv.getY(i); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(g0.index.clone());
  geo.computeBoundingBox(); geo.computeBoundingSphere();
  // rigged source (e.g. the Tripo auto-rig): keep its skin weights + bind-pose joint positions in the SAME
  // space as the baked vertices (via the inverse bind matrices, so quantised / rescaled files still line up)
  let joints = null;
  if (src.isSkinnedMesh && g0.attributes.skinIndex) {
    const si = g0.attributes.skinIndex, sw = g0.attributes.skinWeight, ji = new Uint16Array(n * 4), jw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) for (let c = 0; c < 4; c++) { ji[i * 4 + c] = si.getComponent(i, c); jw[i * 4 + c] = sw.getComponent(i, c); }
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(ji, 4)); geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(jw, 4));
    const inv = new THREE.Matrix4();
    joints = src.skeleton.bones.map((b, j) => {
      const p = new THREE.Vector3().setFromMatrixPosition(inv.copy(src.skeleton.boneInverses[j]).invert()).applyMatrix4(src.bindMatrixInverse).applyMatrix4(M);
      return { name: b.name, pos: p.add(off).multiplyScalar(k) };
    });
  }
  return { geometry: geo, material: src.material, scale: k, joints };
}

function distToSeg(p, a, b) {
  const ab = _w.subVectors(b, a), t = THREE.MathUtils.clamp(_v.subVectors(p, a).dot(ab) / Math.max(1e-9, ab.lengthSq()), 0, 1);
  return _v.copy(a).addScaledVector(ab, t).distanceTo(p);
}

/**
 * Auto-skin. bones: [{ name, parent, a:[x,y,z], b:[x,y,z], r, side }] in metres (bone sits at `a`).
 * side: +1 / −1 restricts the bone to vertices with that sign of x (0 = any).
 * force(p) → bone name to hard-assign a vertex (e.g. tail → hips), or null.
 * Returns { mesh: SkinnedMesh (bind pose = identity rotations), bones: {name: Bone}, segs }.
 */
export function autoSkin(geometry, material, bones, { force = null } = {}) {
  const geo = geometry.clone();
  const segs = bones.map((b, i) => ({ ...b, i, A: new THREE.Vector3(...b.a), B: new THREE.Vector3(...b.b) }));
  const byName = Object.fromEntries(segs.map((s) => [s.name, s]));
  const chain = (s) => { const r = []; let c = s; while (c) { r.push(c.name); c = c.parent ? byName[c.parent] : null; } return r; };
  const hops = segs.map((x) => segs.map((y) => { const ax = chain(x), ay = chain(y); for (let i = 0; i < ax.length; i++) { const j = ay.indexOf(ax[i]); if (j >= 0) return i + j; } return 99; }));
  const P = geo.attributes.position, n = P.count, p = new THREE.Vector3();
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4), ds = new Float32Array(segs.length);
  for (let i = 0; i < n; i++) {
    p.fromBufferAttribute(P, i);
    const f = force?.(p);
    if (f && byName[f]) { si[i * 4] = byName[f].i; sw[i * 4] = 1; continue; }
    let best = -1;
    for (const sg of segs) {
      if (sg.side && Math.sign(p.x) !== sg.side && Math.abs(p.x) > 0.03) { ds[sg.i] = 1e9; continue; }
      ds[sg.i] = Math.max(0.006, distToSeg(p, sg.A, sg.B) - sg.r);
      if (best < 0 || ds[sg.i] < ds[best]) best = sg.i;
    }
    const cand = [];
    for (const sg of segs) if (hops[best][sg.i] <= 2 && ds[sg.i] < ds[best] * 2.5 + 0.025) cand.push(sg.i);
    cand.sort((x, y) => ds[x] - ds[y]); cand.length = Math.min(3, cand.length);
    let tot = 0; const w = cand.map((c) => { const v = 1 / (ds[c] + 0.015) ** 2; tot += v; return v; });
    cand.forEach((c, k) => { si[i * 4 + k] = c; sw[i * 4 + k] = w[k] / tot; });
  }
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  return buildSkeleton(geo, material, segs, byName);
}

/**
 * Re-skin a mesh that already has (many) skin joints onto our small bone set, keeping the source weights:
 * each source joint maps to one of `bones` (mapJoint(name) → bone name), weights are summed per bone.
 * blend(p) → [boneName, t] optionally blends a vertex toward a bone (e.g. a tail the source rig lacks).
 * The result has the same shape as autoSkin() → the existing pose code drives it unchanged.
 */
export function remapSkin(geometry, material, bones, jointNames, mapJoint, { blend = null } = {}) {
  const geo = geometry.clone();
  const segs = bones.map((b, i) => ({ ...b, i, A: new THREE.Vector3(...b.a), B: new THREE.Vector3(...b.b) }));
  const byName = Object.fromEntries(segs.map((s) => [s.name, s]));
  const jm = jointNames.map((nm) => byName[mapJoint(nm)]?.i ?? 0);
  const SI = geometry.attributes.skinIndex, SW = geometry.attributes.skinWeight, P = geometry.attributes.position, n = P.count;
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4), acc = new Float32Array(segs.length), p = new THREE.Vector3();
  const order = [...segs.keys()];
  for (let i = 0; i < n; i++) {
    acc.fill(0);
    for (let c = 0; c < 4; c++) acc[jm[SI.getComponent(i, c)]] += SW.getComponent(i, c);
    if (blend) { p.fromBufferAttribute(P, i); const r = blend(p); if (r && byName[r[0]] && r[1] > 0) { for (let b = 0; b < acc.length; b++) acc[b] *= 1 - r[1]; acc[byName[r[0]].i] += r[1]; } }
    order.sort((x, y) => acc[y] - acc[x]);
    let tot = 0; for (let c = 0; c < 4; c++) tot += acc[order[c]];
    for (let c = 0; c < 4; c++) { si[i * 4 + c] = order[c]; sw[i * 4 + c] = tot > 0 ? acc[order[c]] / tot : c === 0 ? 1 : 0; }
  }
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  return buildSkeleton(geo, material, segs, byName);
}

function buildSkeleton(geo, material, segs, byName) {
  const B = {}, list = [];
  for (const sg of segs) {
    const b = new THREE.Bone(); b.name = sg.name;
    const pos = sg.A.clone();
    if (sg.parent) { pos.sub(byName[sg.parent].A); B[sg.parent].add(b); }
    b.position.copy(pos); B[sg.name] = b; list.push(b);
  }
  const mesh = new THREE.SkinnedMesh(geo, material);
  mesh.frustumCulled = false;
  mesh.add(B[segs[0].name]);
  mesh.bind(new THREE.Skeleton(list));
  for (const b of list) b.userData.rest = b.position.clone();
  return { mesh, bones: B, segs };
}
