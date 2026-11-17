// Shared fast geometry sinks for the procedural city / factory (no per-piece BufferGeometry).
import * as THREE from 'three';

const _v = new THREE.Vector3(), _n = new THREE.Vector3(), _m4 = new THREE.Matrix4(), _m3 = new THREE.Matrix3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _c = new THREE.Color();
export class Arr { constructor(n = 4096) { this.a = new Float32Array(n); this.n = 0; } push3(x, y, z) { if (this.n + 3 > this.a.length) { const b = new Float32Array(this.a.length * 2); b.set(this.a); this.a = b; } this.a[this.n++] = x; this.a[this.n++] = y; this.a[this.n++] = z; } push2(x, y) { if (this.n + 2 > this.a.length) { const b = new Float32Array(this.a.length * 2); b.set(this.a); this.a = b; } this.a[this.n++] = x; this.a[this.n++] = y; } view() { return this.a.subarray(0, this.n); } }
export const TEMPLATES = new Map();
export function template(key, make) {
  let t = TEMPLATES.get(key);
  if (!t) { let g = make(); if (g.index) g = g.toNonIndexed(); g.computeVertexNormals(); t = { p: g.attributes.position.array.slice(), n: g.attributes.normal.array.slice() }; g.dispose(); TEMPLATES.set(key, t); }
  return t;
}
export const UNIT_BOX = () => template('box', () => new THREE.BoxGeometry(1, 1, 1));
/** Vertex-coloured triangles; transform templates by a matrix. */
export class Bucket {
  constructor() { this.p = new Arr(); this.nn = new Arr(); this.c = new Arr(); }
  addT(t, W, color) {
    _m3.getNormalMatrix(W); _c.set(color);
    const e = W.elements, P = t.p, N = t.n;
    for (let i = 0; i < P.length; i += 3) {
      const x = P[i], y = P[i + 1], z = P[i + 2];
      this.p.push3(e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]);
      _n.set(N[i], N[i + 1], N[i + 2]).applyMatrix3(_m3).normalize();
      this.nn.push3(_n.x, _n.y, _n.z); this.c.push3(_c.r, _c.g, _c.b);
    }
  }
  /** Box of size (w,h,d) centred at local p (with yaw ry) inside frame M. */
  box(M, w, h, d, color, px, py, pz, ry = 0, rx = 0, rz = 0) {
    _e.set(rx, ry, rz); _q.setFromEuler(_e); _m4.compose(_v.set(px, py, pz), _q, _s.set(w, h, d));
    this.addT(UNIT_BOX(), _m4.premultiply(M), color);
  }
  geo(M, key, make, color, px, py, pz, rx = 0, ry = 0, rz = 0, sc = 1) {
    _e.set(rx, ry, rz); _q.setFromEuler(_e); _m4.compose(_v.set(px, py, pz), _q, _s.set(sc, sc, sc));
    this.addT(template(key, make), _m4.premultiply(M), color);
  }
  get empty() { return this.p.n === 0; }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.p.view(), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nn.view(), 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.c.view(), 3));
    g.computeBoundingSphere();
    return g;
  }
}

// rooftop decoration templates (key, factory)
export const CYL = (rt, rb, h, seg = 10, open = false) => [`cyl${rt},${rb},${h},${seg},${open}`, () => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open)];
export const CONE = (r, h, seg = 10) => [`cone${r},${h},${seg}`, () => new THREE.ConeGeometry(r, h, seg)];
export const OCTA = (r) => [`oct${r}`, () => new THREE.OctahedronGeometry(r)];
