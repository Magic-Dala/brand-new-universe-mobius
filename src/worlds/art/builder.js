// World Chase geometry builder (v0.40): appends transformed primitives into ONE set of typed arrays per module
// (one draw call per module and material class). Every vertex carries: position, normal, colour (albedo, baked
// shade), uv (metres on the face — the shaders draw windows / bricks / tiles / strata procedurally from it) and
// aMat = (surface kind, variation 0..1). See shaders.js for the surface kinds.
import * as THREE from 'three';

export const K = { // surface kinds (shaders.js)
  PLAIN: 0, FACADE: 1, EMIS: 2, ROCK: 3, BARK: 4, TILE: 5, ICE: 6, METAL: 7, STONE: 8, SHOJI: 9, GLASS: 10, LEAF: 11, LATTICE: 12, PLASTER: 13, SNOW: 14, LAVAGLOW: 15, WOOD: 16, ADOBE: 17, LEAF_CARD: 34, LAVA_FLOW: 35,
};
const _m = new THREE.Matrix4(), _n = new THREE.Matrix3(), _v = new THREE.Vector3(), _w = new THREE.Vector3(), _c = new THREE.Color();
/** Growable typed array (push without the JS-array → typed-array copy at build time: no streaming spikes). */
class Grow {
  constructor(T, n = 4096) { this.T = T; this.a = new T(n); this.length = 0; }
  _grow(k) { if (this.length + k <= this.a.length) return; let n = this.a.length * 2; while (n < this.length + k) n *= 2; const b = new this.T(n); b.set(this.a.subarray(0, this.length)); this.a = b; }
  push(...v) { this._grow(v.length); for (let i = 0; i < v.length; i++) this.a[this.length++] = v[i]; }
  push2(x, y) { this._grow(2); this.a[this.length++] = x; this.a[this.length++] = y; }
  push3(x, y, z) { this._grow(3); this.a[this.length++] = x; this.a[this.length++] = y; this.a[this.length++] = z; }
  out() { return this.a.slice(0, this.length); }
}

export class GeoBuilder {
  constructor() { this._alloc(); this.stack = []; this.mat = new THREE.Matrix4(); this.nrm = new THREE.Matrix3(); this.orient = null; }
  _alloc() { this.P = new Grow(Float32Array); this.N = new Grow(Float32Array); this.C = new Grow(Float32Array); this.U = new Grow(Float32Array); this.M = new Grow(Float32Array); this.I = new Grow(Uint32Array); this.vcount = 0; }
  /** Overwrite the uv of vertex i (floor ribbons: route arc length / metres across). */
  setUV(i, u, v) { this.U.a[i * 2] = u; this.U.a[i * 2 + 1] = v; }
  get triangles() { return this.I.length / 3; }
  // ---------------------------------------------------------------- transform stack
  push(m) { this.stack.push(this.mat.clone()); this.mat.multiply(m); this.nrm.getNormalMatrix(this.mat); return this; }
  pushTRS(x, y, z, yaw = 0, sx = 1, sy = 1, sz = 1, pitch = 0, roll = 0) {
    _m.compose(_v.set(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, roll, 'YXZ')), _w.set(sx, sy, sz));
    return this.push(_m);
  }
  pop() { this.mat.copy(this.stack.pop()); this.nrm.getNormalMatrix(this.mat); return this; }
  // ---------------------------------------------------------------- raw
  _vert(x, y, z, nx, ny, nz, col, u, v, kind, varr) {
    _v.set(x, y, z).applyMatrix4(this.mat); this.P.push3(_v.x, _v.y, _v.z);
    _w.set(nx, ny, nz).applyMatrix3(this.nrm).normalize(); this.N.push3(_w.x, _w.y, _w.z);
    this.C.push3(col.r, col.g, col.b); this.U.push2(u, v); this.M.push2(kind, varr);
    return this.vcount++;
  }
  /** Quad p0..p3 (counter-clockwise seen from the front), flat normal; uv in metres. */
  quad(p0, p1, p2, p3, col, kind = 0, varr = 0, uv = null) {
    let ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2], bx = p3[0] - p0[0], by = p3[1] - p0[1], bz = p3[2] - p0[2];
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const O = this.orient; // convex shapes: wind every face away from the centre
    if (O && nx * (p0[0] + p2[0] - 2 * O[0]) + ny * (p0[1] + p2[1] - 2 * O[1]) + nz * (p0[2] + p2[2] - 2 * O[2]) < 0) { const t = p1; p1 = p3; p3 = t; nx = -nx; ny = -ny; nz = -nz; ax = p1[0] - p0[0]; ay = p1[1] - p0[1]; az = p1[2] - p0[2]; bx = p3[0] - p0[0]; by = p3[1] - p0[1]; bz = p3[2] - p0[2]; }
    const wU = Math.hypot(ax, ay, az), wV = Math.hypot(bx, by, bz);
    const u0 = uv ? uv[0] : 0, v0 = uv ? uv[1] : 0, su = uv ? (uv[2] ?? wU) : wU, sv = uv ? (uv[3] ?? wV) : wV;
    const c = col.isColor ? col : _c.set(col);
    const i0 = this._vert(...p0, nx, ny, nz, c, u0, v0, kind, varr), i1 = this._vert(...p1, nx, ny, nz, c, u0 + su, v0, kind, varr);
    const i2 = this._vert(...p2, nx, ny, nz, c, u0 + su, v0 + sv, kind, varr), i3 = this._vert(...p3, nx, ny, nz, c, u0, v0 + sv, kind, varr);
    this.I.push3(i0, i1, i2); this.I.push3(i0, i2, i3);
  }
  tri(p0, p1, p2, col, kind = 0, varr = 0) {
    let ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2], bx = p2[0] - p0[0], by = p2[1] - p0[1], bz = p2[2] - p0[2];
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const O = this.orient;
    if (O && nx * (p0[0] + p1[0] + p2[0] - 3 * O[0]) + ny * (p0[1] + p1[1] + p2[1] - 3 * O[1]) + nz * (p0[2] + p1[2] + p2[2] - 3 * O[2]) < 0) { const t = p1; p1 = p2; p2 = t; nx = -nx; ny = -ny; nz = -nz; ax = p1[0] - p0[0]; ay = p1[1] - p0[1]; az = p1[2] - p0[2]; bx = p2[0] - p0[0]; by = p2[1] - p0[1]; bz = p2[2] - p0[2]; }
    const c = col.isColor ? col : _c.set(col);
    const i0 = this._vert(...p0, nx, ny, nz, c, 0, 0, kind, varr), i1 = this._vert(...p1, nx, ny, nz, c, Math.hypot(ax, ay, az), 0, kind, varr), i2 = this._vert(...p2, nx, ny, nz, c, 0, Math.hypot(bx, by, bz), kind, varr);
    this.I.push3(i0, i1, i2);
  }
  // ---------------------------------------------------------------- primitives (local frame: x right, y up, −z forward)
  /**
   * Box centred at (x, z), from y0 to y1, size sx × sz. opts: { col, kind, var, top: {col, kind}, sides: {col, kind},
   * faces: 'all' | mask string of +x −x +z −z top bottom e.g. 'xXzZt' (default: no bottom), uvY0 (v origin) }
   */
  box(x, y0, z, sx, sy, sz, o = {}) {
    const hx = sx / 2, hz = sz / 2, y1 = y0 + sy, col = o.col ?? 0x888888, kind = o.kind ?? 0, vr = o.var ?? 0, f = o.faces ?? 'xXzZt';
    const vy = o.uvY0 ?? y0, sc = o.sides?.col ?? col, sk = o.sides?.kind ?? kind;
    const X0 = x - hx, X1 = x + hx, Z0 = z - hz, Z1 = z + hz;
    if (f.includes('Z')) this.quad([X0, y0, Z1], [X1, y0, Z1], [X1, y1, Z1], [X0, y1, Z1], col, kind, vr, [o.u0 ?? X0, vy]); // +z (back, toward the viewer behind)
    if (f.includes('z')) this.quad([X1, y0, Z0], [X0, y0, Z0], [X0, y1, Z0], [X1, y1, Z0], col, kind, vr, [o.u0 ?? -X1, vy]); // −z (forward face)
    if (f.includes('X')) this.quad([X1, y0, Z1], [X1, y0, Z0], [X1, y1, Z0], [X1, y1, Z1], sc, sk, vr, [o.u0 ?? -Z1, vy]); // +x
    if (f.includes('x')) this.quad([X0, y0, Z0], [X0, y0, Z1], [X0, y1, Z1], [X0, y1, Z0], sc, sk, vr, [o.u0 ?? Z0, vy]); // −x
    if (f.includes('t')) this.quad([X0, y1, Z1], [X1, y1, Z1], [X1, y1, Z0], [X0, y1, Z0], o.top?.col ?? col, o.top?.kind ?? kind, vr, [X0, Z0]);
    if (f.includes('b')) this.quad([X0, y0, Z0], [X1, y0, Z0], [X1, y0, Z1], [X0, y0, Z1], o.bottom?.col ?? col, o.bottom?.kind ?? kind, vr, [X0, Z0]);
  }
  /** Tapered box (frustum): bottom sx × sz, top tx × tz (centred). */
  frustum(x, y0, z, sx, sz, h, tx, tz, o = {}) {
    const col = o.col ?? 0x888888, kind = o.kind ?? 0, vr = o.var ?? 0, y1 = y0 + h, f = o.faces ?? 'xXzZt';
    const b = [[x - sx / 2, z - sz / 2], [x + sx / 2, z - sz / 2], [x + sx / 2, z + sz / 2], [x - sx / 2, z + sz / 2]];
    const tp = [[x - tx / 2, z - tz / 2], [x + tx / 2, z - tz / 2], [x + tx / 2, z + tz / 2], [x - tx / 2, z + tz / 2]];
    const side = (i, j, key) => { if (!f.includes(key)) return; this.quad([b[i][0], y0, b[i][1]], [b[j][0], y0, b[j][1]], [tp[j][0], y1, tp[j][1]], [tp[i][0], y1, tp[i][1]], col, kind, vr, [0, o.uvY0 ?? y0, Math.hypot(b[j][0] - b[i][0], b[j][1] - b[i][1]), Math.hypot(h, (sx - tx) / 2)]); };
    side(1, 0, 'z'); side(3, 2, 'Z'); side(2, 1, 'X'); side(0, 3, 'x');
    if (f.includes('t') && tx > 0.01 && tz > 0.01) this.quad([tp[3][0], y1, tp[3][1]], [tp[2][0], y1, tp[2][1]], [tp[1][0], y1, tp[1][1]], [tp[0][0], y1, tp[0][1]], o.top?.col ?? col, o.top?.kind ?? kind, vr);
  }
  /** Cylinder / cone along +y. r0 bottom, r1 top. seg sides. caps: 'tb'. smooth normals. */
  cyl(x, y0, z, r0, r1, h, seg = 8, o = {}) {
    const col = _c.set(o.col ?? 0x888888).clone(), kind = o.kind ?? 0, vr = o.var ?? 0, caps = o.caps ?? 't', a0 = o.a0 ?? 0;
    const slope = (r0 - r1) / h, base = this.vcount;
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (i / seg) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a), nl = Math.hypot(1, slope);
      const u = (i / seg) * Math.PI * 2 * Math.max(r0, r1);
      this._vert(x + c * r0, y0, z + s * r0, c / nl, slope / nl, s / nl, col, u, o.uvY0 ?? y0, kind, vr);
      this._vert(x + c * r1, y0 + h, z + s * r1, c / nl, slope / nl, s / nl, col, u, (o.uvY0 ?? y0) + h, kind, vr);
    }
    for (let i = 0; i < seg; i++) { const a = base + i * 2; this.I.push3(a, a + 1, a + 3); this.I.push3(a, a + 3, a + 2); }
    if (caps.includes('t') && r1 > 0.01) this._disc(x, y0 + h, z, r1, seg, 1, o.top?.col ?? col, o.top?.kind ?? kind, vr, a0);
    if (caps.includes('b') && r0 > 0.01) this._disc(x, y0, z, r0, seg, -1, col, kind, vr, a0);
  }
  _disc(x, y, z, r, seg, ny, col, kind, vr, a0 = 0) {
    const c0 = col.isColor ? col : _c.set(col).clone(), ci = this._vert(x, y, z, 0, ny, 0, c0, x, z, kind, vr), first = this.vcount;
    for (let i = 0; i <= seg; i++) { const a = a0 + (i / seg) * Math.PI * 2; this._vert(x + Math.cos(a) * r, y, z + Math.sin(a) * r, 0, ny, 0, c0, x + Math.cos(a) * r, z + Math.sin(a) * r, kind, vr); }
    for (let i = 0; i < seg; i++) { if (ny > 0) this.I.push3(ci, first + i + 1, first + i); else this.I.push3(ci, first + i, first + i + 1); }
  }
  /** Horizontal cylinder (pipe / log / beam) from a to b ([x,y,z]). */
  pipe(a, b, r, seg = 8, o = {}) {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], L = Math.hypot(dx, dy, dz);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx / L, dy / L, dz / L));
    this.push(new THREE.Matrix4().compose(new THREE.Vector3(...a), q, new THREE.Vector3(1, 1, 1)));
    this.cyl(0, 0, 0, r, o.r1 ?? r, L, seg, { caps: o.caps ?? '', ...o });
    this.pop();
  }
  /**
   * Hip roof with eaves (Asian roofs: curl > 0 lifts the corners). Footprint sx × sz at height y (eave line),
   * rise = ridge height, over = overhang beyond the footprint. Ridge runs along x (sx ≥ sz) or pyramid if sx ≈ sz.
   */
  hipRoof(x, y, z, sx, sz, rise, over = 1, curl = 0, o = {}) {
    const col = o.col ?? 0x444444, kind = o.kind ?? 5, vr = o.var ?? 0;
    const ex = sx / 2 + over, ez = sz / 2 + over, rl = Math.max(0, (sx - sz) / 2) * 0.9;
    this.orient = [x, y - 0.3, z];
    const cy = curl, e = [[x - ex, y + cy, z - ez], [x + ex, y + cy, z - ez], [x + ex, y + cy, z + ez], [x - ex, y + cy, z + ez]];
    const mid = (a, b) => [(a[0] + b[0]) / 2, y, (a[2] + b[2]) / 2]; // edge midpoints stay low → upturned corners
    const r0 = [x - rl, y + rise, z], r1 = [x + rl, y + rise, z];
    const em = [mid(e[0], e[1]), mid(e[1], e[2]), mid(e[2], e[3]), mid(e[3], e[0])];
    // front (−z): e0 em0 e1 → ridge
    this.quad(e[0], em[0], r1, r0, col, kind, vr); this.tri(em[0], e[1], r1, col, kind, vr);
    this.quad(e[2], em[2], r0, r1, col, kind, vr); this.tri(em[2], e[3], r0, col, kind, vr);
    this.tri(e[1], em[1], r1, col, kind, vr); this.tri(em[1], e[2], r1, col, kind, vr);
    this.tri(e[3], em[3], r0, col, kind, vr); this.tri(em[3], e[0], r0, col, kind, vr);
    this.orient = null;
    if (o.under !== false) this.quad([x - ex, y + cy * 0.5 - 0.25, z + ez], [x + ex, y + cy * 0.5 - 0.25, z + ez], [x + ex, y + cy * 0.5 - 0.25, z - ez], [x - ex, y + cy * 0.5 - 0.25, z - ez], o.underCol ?? 0x1a1414, 0, vr); // eave underside (dark)
    if (o.ridge) this.box(x, y + rise - 0.1, z, rl * 2 + 0.6, 0.5, 0.5, { col: o.ridge, kind: o.ridgeKind ?? 0, faces: 'xXzZt' });
  }
  gableRoof(x, y, z, sx, sz, rise, over = 0.5, o = {}) {
    const col = o.col ?? 0x444444, kind = o.kind ?? 5, vr = o.var ?? 0, ex = sx / 2 + over, ez = sz / 2 + over;
    const a = [x - ex, y, z - ez], b = [x + ex, y, z - ez], c = [x + ex, y, z + ez], d = [x - ex, y, z + ez], r0 = [x - ex, y + rise, z], r1 = [x + ex, y + rise, z];
    this.orient = [x, y + rise * 0.3, z];
    this.quad(a, b, r1, r0, col, kind, vr); this.quad(c, d, r0, r1, col, kind, vr);
    this.tri([x - sx / 2, y, z + sz / 2], [x - sx / 2, y, z - sz / 2], [x - sx / 2, y + rise, z], o.gableCol ?? col, o.gableKind ?? 0, vr);
    this.tri([x + sx / 2, y, z - sz / 2], [x + sx / 2, y, z + sz / 2], [x + sx / 2, y + rise, z], o.gableCol ?? col, o.gableKind ?? 0, vr);
    this.orient = null;
  }
  /** Quad wound so its normal points along `nd` (an approximate outward direction). */
  quadN(p0, p1, p2, p3, nd, col, kind = 0, varr = 0, uv = null) {
    const cx = (p0[0] + p2[0]) / 2, cy = (p0[1] + p2[1]) / 2, cz = (p0[2] + p2[2]) / 2, keep = this.orient;
    this.orient = [cx - nd[0], cy - nd[1], cz - nd[2]]; this.quad(p0, p1, p2, p3, col, kind, varr, uv); this.orient = keep;
  }
  /** Arch (half ring) spanning x from −span/2..span/2 at height y (spring line), thickness th, depth (z) dz. */
  arch(x, y, z, span, th, dz, seg = 10, o = {}) {
    const col = o.col ?? 0x888888, kind = o.kind ?? 8, vr = o.var ?? 0, R = span / 2, R2 = R + th, rise = o.rise ?? 1;
    const pt = (r, a, zz) => [x + Math.cos(a) * r, y + Math.sin(a) * r * rise, zz];
    for (let i = 0; i < seg; i++) {
      const a0 = Math.PI * (i / seg), a1 = Math.PI * ((i + 1) / seg), am = (a0 + a1) / 2, zf = z - dz / 2, zb = z + dz / 2;
      const rad = [Math.cos(am), Math.sin(am) / Math.max(0.2, rise), 0];
      this.quadN(pt(R2, a1, zf), pt(R2, a0, zf), pt(R, a0, zf), pt(R, a1, zf), [0, 0, -1], col, kind, vr); // front ring face
      this.quadN(pt(R2, a0, zb), pt(R2, a1, zb), pt(R, a1, zb), pt(R, a0, zb), [0, 0, 1], col, kind, vr);
      this.quadN(pt(R2, a0, zf), pt(R2, a1, zf), pt(R2, a1, zb), pt(R2, a0, zb), rad, col, kind, vr); // extrados
      this.quadN(pt(R, a1, zf), pt(R, a0, zf), pt(R, a0, zb), pt(R, a1, zb), [-rad[0], -rad[1], 0], o.underCol ?? col, kind, vr); // intrados
    }
  }
  /** Low-poly blob (foliage / snow / cloud / rock): icosahedron detail 0–1, squashed by sy. */
  blob(x, y, z, r, sy = 1, o = {}) {
    const g = o.geo || (o.detail ? ICO1 : ICO0), pos = g.attributes.position, idx = g.index;
    const col = _c.set(o.col ?? 0x4a7a3a).clone(), kind = o.kind ?? 11, vr = o.var ?? Math.random(), j = o.jitter ?? 0.15, seed = o.seed ?? 1;
    const base = this.vcount;
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i), n = 1 + j * (Math.sin(px * 12.9 + seed) * Math.cos(pz * 7.3 + seed * 2.1) + Math.sin(py * 9.1 + seed * 0.7)) * 0.5;
      this._vert(x + px * r * n, y + py * r * sy * n, z + pz * r * n, px, py * (1 / Math.max(0.3, sy)), pz, col, px * r, py * r, kind, vr);
    }
    for (let i = 0; i < idx.count; i += 3) this.I.push3(base + idx.getX(i), base + idx.getX(i + 1), base + idx.getX(i + 2));
  }
  /** A prism / crystal (n-gon cone with a body): radius r, body height h, tip height tip. */
  crystal(x, y0, z, r, h, tip, n = 6, o = {}) { this.cyl(x, y0, z, r, r * 0.92, h, n, { ...o, caps: '' }); this.cyl(x, y0 + h, z, r * 0.92, 0.02, tip, n, { ...o, caps: '' }); }
  /** Lattice truss girder along x from x0..x1 at y (bottom chord), height h, depth (z) dz, member size m. */
  truss(x0, x1, y, z, h, dz, m = 0.35, o = {}) {
    const col = o.col ?? 0x2a2a2e, kind = o.kind ?? 7, L = x1 - x0, n = Math.max(2, Math.round(L / (h * 1.2)));
    for (const zz of [z - dz / 2, z + dz / 2]) {
      this.box((x0 + x1) / 2, y, zz, L, m, m, { col, kind }); this.box((x0 + x1) / 2, y + h - m, zz, L, m, m, { col, kind });
      for (let i = 0; i <= n; i++) { const xx = x0 + (L * i) / n; this.box(xx, y, zz, m, h, m, { col, kind }); }
      for (let i = 0; i < n; i++) { const xa = x0 + (L * i) / n, xb = x0 + (L * (i + 1)) / n, k = i % 2; this.pipe([xa, k ? y + h : y, zz], [xb, k ? y : y + h, zz], m * 0.45, 4, { col, kind }); }
    }
    for (let i = 0; i <= n; i += 2) { const xx = x0 + (L * i) / n; this.box(xx, y + h - m, z, m, m, dz, { col, kind }); }
  }
  // ---------------------------------------------------------------- output
  build(sphere = null) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.P.out(), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.N.out(), 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.C.out(), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(this.U.out(), 2));
    g.setAttribute('aMat', new THREE.BufferAttribute(this.M.out(), 2));
    const I = this.I.out(); g.setIndex(new THREE.BufferAttribute(this.vcount > 65535 ? I : new Uint16Array(I), 1));
    if (sphere) g.boundingSphere = sphere; else g.computeBoundingSphere(); // (modules pass a known sphere: no per-vertex pass)
    return g;
  }
  clear() { this._alloc(); this.mat.identity(); this.nrm.identity(); this.stack.length = 0; }
  get empty() { return this.I.length === 0; }
}
const ICO0 = new THREE.IcosahedronGeometry(1, 0), ICO1 = new THREE.IcosahedronGeometry(1, 1);
ICO0.index || ICO0.setIndex([...Array(ICO0.attributes.position.count).keys()]);
ICO1.index || ICO1.setIndex([...Array(ICO1.attributes.position.count).keys()]);
/** Colour helpers. */
export const col = (hex) => new THREE.Color(hex);
export function shade(hex, k) { return new THREE.Color(hex).multiplyScalar(k); }
export function mix(a, b, t) { return new THREE.Color(a).lerp(new THREE.Color(b), t); }
