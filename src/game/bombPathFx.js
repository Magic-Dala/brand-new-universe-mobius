// v1.1 chase pumpkins: the flight path preview — a warm dashed ribbon in pumpkin orange from each pumpkin (held in
// Green Maniac's hand or in flight) to where it will arrive. ONE mesh per app for every path of every chase (one draw
// call while any path shows, none otherwise), one ShaderMaterial compiled before play (prewarm), no lights, no
// per-frame allocation. Depth-tested (hidden behind buildings). The dashes flow toward the player. The path ends at
// the player: it fades out over fadeSpan before fadeNear and nothing is drawn within fadeNear of the head (the fragment
// shader discards there as well). Tunables: BOMB_PATH.preview (src/data/bombPath.js).
import * as THREE from 'three';
import { BOMB_PATH } from '../data/bombPath.js';
import { settings } from '../core/settings.js';

const VERT = /* glsl */`
attribute float aS; attribute float aA; attribute vec3 aC;
varying float vS; varying float vA; varying vec3 vC; varying vec3 vW;
void main() {
  vS = aS; vA = aA; vC = aC;
  vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const FRAG = /* glsl */`
uniform vec3 uHead; uniform float uNear; uniform float uTime; uniform float uPeriod; uniform float uSpeed; uniform float uDuty; uniform float uOpacity;
varying float vS; varying float vA; varying vec3 vC; varying vec3 vW;
void main() {
  if (distance(vW, uHead) < uNear || vA < 0.002) discard;
  float ph = fract((vS + uTime * uSpeed) / uPeriod);
  float dash = smoothstep(0.0, 0.08, ph) * (1.0 - smoothstep(uDuty - 0.08, uDuty, ph));
  gl_FragColor = vec4(vC, vA * uOpacity * (0.35 + 0.65 * dash));
}`;

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _t = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();

export class BombPathFx {
  /** The one instance of an app (every ChaseBombs of every chase draws into it). */
  static for(app) { return app._bombPathFx || (app._bombPathFx = new BombPathFx(app.scene)); }
  constructor(scene, cfg = BOMB_PATH.preview) {
    this.cfg = cfg; const N = cfg.points, P = cfg.maxPaths;
    this.N = N; this.P = P;
    const V = P * N * 2;
    this.pos = new Float32Array(V * 3); this.s = new Float32Array(V); this.al = new Float32Array(V); this.col = new Float32Array(V * 3);
    const idx = new Uint16Array(P * (N - 1) * 6); let k = 0;
    for (let p = 0; p < P; p++) for (let i = 0; i < N - 1; i++) { const a = (p * N + i) * 2; idx[k++] = a; idx[k++] = a + 1; idx[k++] = a + 2; idx[k++] = a + 1; idx[k++] = a + 3; idx[k++] = a + 2; }
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aS = new THREE.BufferAttribute(this.s, 1).setUsage(THREE.DynamicDrawUsage);
    this.aA = new THREE.BufferAttribute(this.al, 1).setUsage(THREE.DynamicDrawUsage);
    this.aC = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos); g.setAttribute('aS', this.aS); g.setAttribute('aA', this.aA); g.setAttribute('aC', this.aC);
    g.setIndex(new THREE.BufferAttribute(idx, 1)); g.setDrawRange(0, 0);
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide, toneMapped: false, fog: false,
      uniforms: { uHead: { value: new THREE.Vector3() }, uNear: { value: cfg.fadeNear }, uTime: { value: 0 }, uPeriod: { value: cfg.dash.period }, uSpeed: { value: cfg.dash.speed }, uDuty: { value: cfg.dash.duty }, uOpacity: { value: 1 } },
    });
    this.mesh = new THREE.Mesh(g, this.mat); this.mesh.name = 'bombPaths'; this.mesh.frustumCulled = false; this.mesh.renderOrder = 5; this.mesh.visible = false;
    scene?.add(this.mesh);
    this.owners = []; this.count = 0; this._warm = false; this.time = 0;
    this.head = new THREE.Vector3();
    this.stats = { commits: 0, paths: 0, minDist: Infinity };
  }
  /** A ChaseBombs registers once and gets its own path records: { pts (Float32Array 3·N), n, kind, alpha }. */
  owner() {
    const recs = []; for (let i = 0; i < this.P; i++) recs.push({ pts: new Float32Array(this.N * 3), n: this.N, kind: 'normal', alpha: 0 });
    const o = { recs, count: 0 }; this.owners.push(o); return o;
  }
  /** Keep the mesh drawable (with nothing in it) so renderer.compile() builds its program before play. */
  prewarm(on) { this._warm = !!on; this.mesh.visible = this._warm || this.count > 0; }
  /** Rebuild the ribbon from every owner's records. head = the player's head (world). */
  commit(head, time) {
    const C = this.cfg, N = this.N; this.head.copy(head); this.time = time;
    const U = this.mat.uniforms; U.uHead.value.copy(head); U.uTime.value = time; U.uOpacity.value = settings.comfortMode ? 0.5 : 1;
    let p = 0, minD = Infinity;
    const tanMin = Math.tan((C.minDeg * Math.PI) / 180);
    for (let o = 0; o < this.owners.length; o++) {
      const ow = this.owners[o];
      for (let r = 0; r < ow.count && p < this.P; r++) {
        const rec = ow.recs[r], pts = rec.pts;
        // clip at the fadeNear sphere around the head: the path ends where it reaches it
        let n = rec.n;
        _a.fromArray(pts, 0); if (_a.distanceTo(head) < C.fadeNear) continue;
        for (let i = 1; i < rec.n; i++) {
          _b.fromArray(pts, i * 3);
          if (_b.distanceTo(head) < C.fadeNear) {
            _a.fromArray(pts, (i - 1) * 3); let lo = 0, hi = 1; // bisect the crossing on segment i−1 → i
            for (let k = 0; k < 12; k++) { const m = (lo + hi) / 2; _t.lerpVectors(_a, _b, m); if (_t.distanceTo(head) < C.fadeNear) hi = m; else lo = m; }
            _t.lerpVectors(_a, _b, lo); _t.toArray(pts, i * 3); n = i + 1; break;
          }
        }
        if (n < 2) continue;
        const w = rec.kind === 'giant' ? C.width.giant : C.width.normal;
        _c.setHex(rec.kind === 'giant' ? C.color.giant : C.color.normal);
        // distance left to the end of the path (dash phase): the dashes flow toward the player
        let sEnd = 0; const base = p * N * 2;
        for (let i = n - 1; i >= 0; i--) {
          if (i < n - 1) { _a.fromArray(pts, i * 3); _b.fromArray(pts, (i + 1) * 3); sEnd += _a.distanceTo(_b); }
          this.s[base + i * 2] = this.s[base + i * 2 + 1] = sEnd;
        }
        for (let i = 0; i < N; i++) {
          const j = Math.min(i, n - 1), v = base + i * 2;
          _a.fromArray(pts, j * 3);
          _b.fromArray(pts, Math.min(j + 1, n - 1) * 3); _t.fromArray(pts, Math.max(j - 1, 0) * 3); _t.subVectors(_b, _t); // tangent
          _s.subVectors(_a, head); const d = _s.length(); if (i < n) minD = Math.min(minD, d);
          _s.cross(_t); if (_s.lengthSq() < 1e-10) _s.set(0, 1, 0); _s.normalize().multiplyScalar(0.5 * Math.max(w, d * tanMin));
          this.pos[v * 3] = _a.x + _s.x; this.pos[v * 3 + 1] = _a.y + _s.y; this.pos[v * 3 + 2] = _a.z + _s.z;
          this.pos[v * 3 + 3] = _a.x - _s.x; this.pos[v * 3 + 4] = _a.y - _s.y; this.pos[v * 3 + 5] = _a.z - _s.z;
          const f = i < n ? rec.alpha * THREE.MathUtils.smoothstep(d, C.fadeNear, C.fadeNear + C.fadeSpan) : 0;
          this.al[v] = this.al[v + 1] = f;
          if (i >= n) this.s[v] = this.s[v + 1] = 0;
          this.col[v * 3] = this.col[v * 3 + 3] = _c.r; this.col[v * 3 + 1] = this.col[v * 3 + 4] = _c.g; this.col[v * 3 + 2] = this.col[v * 3 + 5] = _c.b;
        }
        p++;
      }
    }
    this.count = p; this.stats.commits++; this.stats.paths = p; this.stats.minDist = minD;
    this.geo.setDrawRange(0, p * (N - 1) * 6);
    if (p) { this.aPos.needsUpdate = this.aS.needsUpdate = this.aA.needsUpdate = this.aC.needsUpdate = true; }
    this.mesh.visible = p > 0 || this._warm;
  }
  /** Every path of every owner gone (a chase ends). */
  clearAll() { for (const o of this.owners) o.count = 0; this.count = 0; this.geo.setDrawRange(0, 0); this.mesh.visible = this._warm; }
}
