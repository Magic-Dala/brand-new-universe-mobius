// v0.30 VFX kit: the shared GPU systems + every effect recipe (Mobius blue / Green Maniac green-orange).
// Owned by Effects (app.fx.vfx). Each public effect returns true when it ran, false when its flag is off — callers
// write `fx.vfx?.pumpkinBurst(p) || fx.boom(p, old)` so the old v0.29 path runs unchanged when a flag is off.
// Deterministic: every effect takes a seed (default: a per-kit sequence, reset by clear()) and spawns all of its
// particles at trigger time with staggered start times → its look is a pure function of (seed, time since trigger).
// Comfort: flashes ≤ 80 ms and small, bright cores fade within ~150 ms, near-camera quads are size-capped and faded in
// the shaders, the miss feedback lives on the view edge, no strobing (all pulses ≤ 2 Hz), no camera motion.
import * as THREE from 'three';
import { SUN_DIRECTION } from '../../art/sky.js';
import { pulse } from '../../art/fxLight.js';
import { vfxOn } from './vfxFlags.js';
import { Rng, hashSeed } from './rand.js';
import { FEEL } from '../../data/feel.js';
import { atlasTexture, smokeFlipbook, hexTexture, faceTexture } from './textures.js';
import { VFX_U, GpuParticles, Debris, Rings, Shells, Arcs, Beams, Attach, DamageEdge } from './systems.js';

// display colours (no colour-space conversion)
const C = {
  deep: [0.02, 0.48, 1.0], cyan: [0.5, 0.91, 1.0], white: [1, 1, 1], ice: [0.8, 0.97, 1.0],
  green: [0.29, 1.0, 0.35], lime: [0.75, 1.0, 0.3], orange: [1.0, 0.48, 0.1], amber: [1.0, 0.72, 0.25], yellow: [1.0, 0.9, 0.5], red: [1.0, 0.22, 0.06],
  purple: [0.42, 0.23, 0.54], smoke: [0.3, 0.22, 0.36], dark: [0.12, 0.1, 0.14], dust: [0.52, 0.44, 0.4], concrete: [0.4, 0.39, 0.42], shell: [0.9, 0.38, 0.06], shellDark: [0.55, 0.22, 0.05],
};
export const VFX_COLORS = C;
const MOBIUS = new Set([0x5fd8ff, 0x7ef0ff, 0x8ff0ff, 0xbff4ff, 0x9fefff]);
const MANIAC = new Set([0xffa020, 0xffb020, 0xff6a20]);
const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Vector3(), _q = new THREE.Quaternion();

/** P += dir × d (lobe offset). */
function kSet(P, d, k) { P.x += d.x * k; P.y += d.y * k; P.z += d.z * k; return P; }

export class VfxKit {
  constructor(scene) {
    this.root = new THREE.Group(); this.root.name = 'vfx-kit'; scene.add(this.root);
    this.time = 0; this.seq = 1; this.rng = new Rng(1); this.camera = null;
    const atlas = atlasTexture(), smoke = smokeFlipbook(), hex = hexTexture(), face = faceTexture();
    this.add = new GpuParticles(3072, 'add', atlas, 'vfx-add');
    this.smoke = new GpuParticles(640, 'smoke', smoke, 'vfx-smoke');
    this.debris = new Debris(256, SUN_DIRECTION);
    this.rings = new Rings(64); this.shells = new Shells(48); this.arcs = new Arcs(64, C.cyan);
    this.beams = new Beams(16, hex); this.attach = new Attach(40, face); this.edge = new DamageEdge();
    this.systems = [this.debris, this.smoke, this.add, this.rings, this.shells, this.arcs];
    for (const s of [...this.systems, this.beams, this.attach]) this.root.add(s.mesh);
    // thruster flame shader (swapped onto Locomotion's cones while the `thruster` flag is on)
    this.flameMat = new THREE.ShaderMaterial({
      uniforms: { uTime: VFX_U.uTime, uLevel: { value: 0 } }, transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
      vertexShader: 'varying float vK; varying vec3 vN; varying vec3 vV; varying float vA; void main(){ vK = clamp(-position.y / 0.55, 0.0, 1.0); vA = atan(position.x, position.z); vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
      fragmentShader: `uniform float uTime, uLevel; varying float vK; varying vec3 vN; varying vec3 vV; varying float vA;
        void main(){ float f = abs(dot(normalize(vN), vV)); float flick = 0.88 + 0.12 * sin(uTime * 11.0 + vK * 9.0 + vA * 3.0);
          float band = 0.75 + 0.25 * sin(vK * 26.0 - uTime * 30.0);
          float a = pow(1.0 - vK, 1.4) * (0.35 + 0.65 * f) * uLevel * flick * band;
          vec3 c = mix(vec3(1.0, 1.0, 1.0), vec3(0.15, 0.55, 1.0), smoothstep(0.0, 0.5, vK));
          gl_FragColor = vec4(c * a * 1.9, 1.0); }`,
    });
    this.flameWarm = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.55, 10, 1, true), this.flameMat); this.flameWarm.visible = false; this.flameWarm.frustumCulled = false; this.root.add(this.flameWarm);
    this.warmObjs = [];
    this.att = Array.from({ length: 28 }, () => ({ on: false, obj: null, kind: '', t: 0, scale: 1, seed: 0, n: 0, acc: 0, last: new THREE.Vector3(), has: false }));
    this._swapped = null; this._thrAcc = 0; this._thrN = 0; this._lastBlast = { t: -9, p: new THREE.Vector3() }; this._lastNet = { t: -9, p: new THREE.Vector3() };
    // reusable particle spec (no allocation per emit)
    this.P = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 1, s0: 0.1, s1: 0.1, g: 0, drag: 0.05, c0: C.white, i0: 1, hot: 0, c1: C.white, i1: 1, a: 1, rot: 0, spin: 0, tile: 0, stretch: 0 };
    this.D = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 1, wx: 0, wy: 0, wz: 0, floor: -1e3, sx: 0.1, sy: 0.1, sz: 0.1, g: 9.8, alb: C.shell, em: 0, emc: C.green, cool: 0.5 };
  }

  // ------------------------------------------------------------------ helpers
  _seed(seed) { return this.rng.reset(seed ?? hashSeed(this.seq++, 0x51ed)); }
  /** reset P to defaults at position p */
  _p(p) { const P = this.P; P.x = p.x; P.y = p.y; P.z = p.z; P.vx = P.vy = P.vz = 0; P.life = 1; P.s0 = P.s1 = 0.1; P.g = 0; P.drag = 0.05; P.c0 = C.white; P.i0 = 1; P.hot = 0; P.c1 = C.white; P.i1 = 1; P.a = 1; P.rot = 0; P.spin = 0; P.tile = 0; P.stretch = 0; return P; }
  _flash(p, size, col, life = 0.07, delay = 0, a = 1, tile = 0) {
    const P = this._p(p); P.life = life; P.s0 = size * 0.55; P.s1 = size; P.c0 = col; P.c1 = col; P.hot = 0.5; P.a = a; P.tile = tile;
    this.add.emit(P, this.time + delay);
  }
  /** v0.45: a short flash at the hand when a web fires / attaches (pooled flash, no new meshes) */
  handFlash(p) { this._flash(p, 0.12, C.ice, 0.08); }
  /** radial spark burst: n streaks */
  _sparks(r, p, n, sp0, sp1, l0, l1, size, c0, c1, { g = 6, drag = 2.5, stretch = 0.16, up = -1, delay = 0, i = 1.4, tile = 1, spread = 0 } = {}) {
    for (let k = 0; k < n; k++) {
      const P = this._p(p); (up >= 0 ? r.hemi(_a, up) : r.dir(_a));
      const s = r.range(sp0, sp1); P.vx = _a.x * s; P.vy = _a.y * s; P.vz = _a.z * s;
      if (spread) { P.x += r.sym(spread); P.y += r.sym(spread); P.z += r.sym(spread); }
      P.life = r.range(l0, l1); P.s0 = size * 1.3; P.s1 = size * 0.45; P.g = g; P.drag = drag; P.c0 = c0; P.c1 = c1; P.i0 = i; P.i1 = i * 0.8; P.hot = 0.25; P.stretch = tile === 1 ? stretch : 0; P.tile = tile; P.rot = r.range(0, 6.28);
      this.add.emit(P, this.time + delay + (n > 20 ? r.range(0, 0.02) : 0));
    }
  }
  _embers(r, p, n, { spread = 0.3, vy = [0.4, 1.4], vxz = 0.8, g = -0.25, life = [1, 1.8], size = 0.035, col = C.amber, col1 = C.orange, delay = [0, 0], i = 1.6 } = {}) {
    for (let k = 0; k < n; k++) {
      const P = this._p(p); P.x += r.sym(spread); P.y += r.sym(spread * 0.6); P.z += r.sym(spread);
      P.vx = r.sym(vxz); P.vy = r.range(vy[0], vy[1]); P.vz = r.sym(vxz); P.g = g; P.drag = 0.8;
      P.life = Math.min(0.85, r.range(life[0], life[1]) * 0.6); P.s0 = size; P.s1 = size * 0.5; // v0.30d: gone by ≈ 0.85 s P.c0 = col; P.c1 = col1; P.i0 = i; P.i1 = i * 0.6; P.tile = 0;
      this.add.emit(P, this.time + r.range(delay[0], delay[1]));
    }
  }
  /** fire → smoke puffs (premultiplied: emissive fire that turns into lit smoke) */
  _fire(r, p, n, { spread = 0.15, speed = [0.8, 2.2], up = 0.35, s0 = [0.25, 0.4], s1 = [0.7, 1.0], life = [0.45, 0.65], fire = C.orange, fi = 1.7, fireDur = 0.6, smoke = C.purple, a = 0.9, g = -0.5, drag = 3, delay = [0, 0] } = {}) {
    for (let k = 0; k < n; k++) {
      const P = this._p(p); r.dir(_a); P.x += _a.x * spread; P.y += _a.y * spread; P.z += _a.z * spread;
      const s = r.range(speed[0], speed[1]); P.vx = _a.x * s; P.vy = _a.y * s + up * s; P.vz = _a.z * s;
      P.g = g; P.drag = drag; P.life = r.range(life[0], life[1]); P.s0 = r.range(s0[0], s0[1]); P.s1 = r.range(s1[0], s1[1]);
      P.c0 = fire; P.i0 = fi; P.hot = fireDur; P.c1 = smoke; P.i1 = 1; P.a = a; P.rot = r.range(0, 6.28); P.spin = r.sym(0.8); P.tile = r.range(0, 16);
      this.smoke.emit(P, this.time + r.range(delay[0], delay[1]));
    }
  }
  _smokePuffs(r, p, n, { spread = 0.3, vy = [0.3, 0.8], vxz = 0.4, s0 = [0.3, 0.5], s1 = [1, 1.4], life = [1, 1.4], col = C.purple, a = 0.6, g = -0.15, drag = 0.8, delay = [0, 0], fire = null, fireDur = 0 } = {}) {
    for (let k = 0; k < n; k++) {
      const P = this._p(p); P.x += r.sym(spread); P.y += r.sym(spread * 0.5); P.z += r.sym(spread);
      P.vx = r.sym(vxz); P.vy = r.range(vy[0], vy[1]); P.vz = r.sym(vxz); P.g = g; P.drag = drag;
      P.life = Math.min(1.5, r.range(life[0], life[1])); P.s0 = r.range(s0[0], s0[1]); P.s1 = r.range(s1[0], s1[1]);
      P.c0 = fire || C.dark; P.i0 = fire ? 1.4 : 0; P.hot = fire ? fireDur : 0; P.c1 = col; P.a = a; P.rot = r.range(0, 6.28); P.spin = r.sym(0.4); P.tile = r.range(0, 16);
      this.smoke.emit(P, this.time + r.range(delay[0], delay[1]));
    }
  }
  _shards(r, p, n, { speed = [2.5, 5.5], up = 0.25, size = 1, life = [1.1, 1.5], alb = C.shell, em = 1.3, emc = C.green, cool = 0.5, floor = null, delay = 0, rubble = false } = {}) {
    const D = this.D;
    // comfort: chunks never fly at the eyes — directions toward a camera closer than 4 m are mirrored away
    const cam = this.camera ? this.camera.getWorldPosition(_d) : null, toCam = cam && cam.distanceTo(p) < 4 ? _e.copy(cam).sub(p).setY(0).normalize() : null;
    for (let k = 0; k < n; k++) {
      r.hemi(_a, up); const s = r.range(speed[0], speed[1]);
      if (toCam) { const d = _a.x * toCam.x + _a.z * toCam.z; if (d > -0.2) { _a.x -= toCam.x * (d + 0.4) * 2; _a.z -= toCam.z * (d + 0.4) * 2; _a.normalize(); } }
      D.x = p.x + _a.x * 0.08; D.y = p.y + _a.y * 0.08; D.z = p.z + _a.z * 0.08;
      D.vx = _a.x * s; D.vy = _a.y * s; D.vz = _a.z * s; D.life = Math.min(1.0, r.range(life[0], life[1]) * 0.6); // v0.30d: no chunks left lying around
      r.dir(_b); const w = r.range(6, 15); D.wx = _b.x * w; D.wy = _b.y * w; D.wz = _b.z * w;
      D.floor = floor ?? p.y - 1.4; const m = size * r.range(0.6, 1.35);
      if (rubble) { D.sx = 0.22 * m; D.sy = 0.15 * m; D.sz = 0.2 * m; } else { D.sx = 0.11 * m; D.sy = 0.028 * m; D.sz = 0.085 * m; }
      D.g = 9.8; D.alb = alb; D.em = em * (rubble ? (r.next() < 0.45 ? 1 : 0) : 1); D.emc = emc; D.cool = cool;
      this.debris.emit(D, this.time + delay);
    }
  }
  _ring(p, life, r0, r1, col, I, { n = null, width = 0.06, ease = 3, mode = 0, delay = 0, fadePow = 1.5, seed = 0 } = {}) {
    this.rings.emit(p.x, p.y, p.z, this.time + delay, life, n, r0, r1, width, ease, col, I, mode, seed, fadePow);
  }
  _shell(p, life, r0, r1, mode, col, I, { hex = 4, ease = 3, delay = 0, seed = 0, fadePow = 1.2 } = {}) {
    return this.shells.emit(p.x, p.y, p.z, this.time + delay, life, r0, r1, mode, col, I, hex, ease, seed, fadePow);
  }
  _arcsAround(r, p, n, rad0, rad1, delay0, step, life0, life1) {
    for (let k = 0; k < n; k++) {
      r.dir(_a); const a = _b.copy(p).addScaledVector(_a, r.range(0.05, 0.25));
      r.dir(_c); const b = _d.copy(p).addScaledVector(_c, r.range(rad0, rad1));
      this.arcs.emit(a, b, this.time + delay0 + k * step, r.range(life0, life1), r.range(0, 100), 0.011, r.range(0.06, 0.11), 13);
    }
  }

  /**
   * Layered Green Maniac fireball (≈ radius s m): white-hot core flash ≤ 70 ms → green rim flash (shell + ring) →
   * 5–9 billowing lobes (heat ramp yellow → orange → dark red with soot fringes, fire gone by ≈ 400 ms) → rolling
   * black / purple smoke that takes over by 400 ms. o: { lobes, fire (tint), fi, soot, green, near, up }
   */
  _fireball(r, p, s, { lobes = 6, fire = C.orange, fi = 1.6, soot = 6, green = 1, near = 0, up = 0.6, smokeCol = C.dark, fireDur = 0.45, life = [0.7, 0.95], clear = false } = {}) {
    const P = this.P;
    // clear (arcade): the lanes must stay readable for the NEXT bombs → no lingering soot, short thin lobes that sink away
    if (clear) { soot = 0; life = [0.3, 0.42]; }
    this._flash(p, 0.75 * s, C.white, 0.065);                                   // ≤ 80 ms white core
    if (green > 0) {                                                             // toxic green rim flash
      if (near <= 0.5) this._shell(p, 0.17, 0.35 * s, 1.2 * s, 0, C.green, 1.7 * green, { ease: 3, fadePow: 1.3 }); // (a full-view sphere when the eyes are inside it)
      this._ring(p, 0.28, 0.2 * s, 1.45 * s, C.green, 1.5 * green, { width: 0.07, delay: 0.01 });
      this._flash(p, (near > 0.5 ? 0.5 : 1.1) * s, C.green, 0.16, 0.015, 0.75 * green);
    }
    for (let k = 0; k < lobes; k++) {                                            // billowing lobes
      r.hemi(_a, 0.1); _a.y = Math.abs(_a.y) * 0.8 + 0.2 * up; _a.normalize();
      kSet(this._p(p), _a, 0.22 * s);
      const sp = r.range(1.0, 1.9) * s; P.vx = _a.x * sp; P.vy = _a.y * sp + up * 0.6 * s; P.vz = _a.z * sp;
      P.g = -0.6 * s; P.drag = 2.8; P.life = r.range(life[0], life[1]);
      P.s0 = r.range(0.45, 0.6) * s; P.s1 = r.range(1.05, 1.35) * s * (clear ? 0.7 : 1);
      P.c0 = fire; P.i0 = fi; P.hot = near > 0.5 ? 0.2 : clear ? 0.26 : fireDur; P.c1 = k % 3 === 2 ? C.purple : smokeCol; P.a = clear ? 0.6 : 0.95;
      if (clear) { P.g = 1.2 * s; P.vy -= 0.4 * s; }
      P.rot = r.range(0, 6.28); P.spin = r.sym(1.2); P.tile = r.range(0, 16);
      this.smoke.emit(P, this.time + k * 0.008);
    }
    for (let k = 0; k < 3; k++) {                                                // hotter inner core lobes
      r.dir(_a); kSet(this._p(p), _a, 0.08 * s); const sp = r.range(0.3, 0.8) * s;
      P.vx = _a.x * sp; P.vy = _a.y * sp + 0.5 * s; P.vz = _a.z * sp; P.drag = 2; P.g = -0.8 * s;
      P.life = r.range(0.38, 0.5); P.s0 = 0.35 * s; P.s1 = 0.75 * s; P.c0 = C.amber; P.i0 = fi * 1.1; P.hot = near > 0.5 ? 0.35 : 0.75; P.c1 = smokeCol; P.a = 0.9;
      P.rot = r.range(0, 6.28); P.spin = r.sym(1.5); P.tile = r.range(0, 16);
      this.smoke.emit(P, this.time);
    }
    for (let k = 0; k < soot; k++) {                                             // rolling soot (takes over by 400 ms)
      r.hemi(_a, 0.3); kSet(this._p(p), _a, 0.3 * s);
      P.vx = _a.x * 0.5 * s; P.vy = r.range(0.5, 1.0) * s; P.vz = _a.z * 0.5 * s; P.g = -0.25 * s; P.drag = 1.2;
      P.life = r.range(1.0, 1.4); P.s0 = 0.55 * s; P.s1 = r.range(1.7, 2.1) * s; // (v0.30b: dissolves by ≈ 1.4 s)
      P.c0 = C.red; P.i0 = 0.9; P.hot = 0.1; P.c1 = k % 2 ? C.purple : C.dark; P.a = 0.72;
      P.rot = r.range(0, 6.28); P.spin = r.sym(0.6); P.tile = r.range(0, 16);
      this.smoke.emit(P, this.time + r.range(0.12, 0.26));
    }
    this._sparks(r, p, 18, 3 * s, 7.5 * s, 0.3, 0.6, 0.05 * Math.max(1, s * 0.7), C.lime, C.green, { g: 6, drag: 2.3, i: 1.9 });
    this._sparks(r, p, 14, 3 * s, 7 * s, 0.3, 0.55, 0.05 * Math.max(1, s * 0.7), C.yellow, C.orange, { g: 6, drag: 2.3 });
  }

  // ------------------------------------------------------------------ Mobius
  /** Charge glint at the wrist when a web leaves it. */
  webGlint(p, to, seed) {
    const r = this._seed(seed);
    this._flash(p, 0.13, C.ice, 0.11, 0, 1, 2);
    _e.copy(to).sub(p).normalize();
    for (let k = 0; k < 5; k++) { const P = this._p(p); const s = r.range(2, 4); r.dir(_a); P.vx = (_e.x + _a.x * 0.5) * s; P.vy = (_e.y + _a.y * 0.5) * s; P.vz = (_e.z + _a.z * 0.5) * s; P.life = r.range(0.1, 0.18); P.s0 = 0.03; P.s1 = 0.01; P.drag = 4; P.c0 = C.white; P.c1 = C.cyan; P.stretch = 0.05; P.tile = 1; P.i0 = 1.5; this.add.emit(P, this.time); }
  }
  /** Small blue impact (web contact, fan-web strand, routed blue booms). */
  webImpact(p, size = 0.7, seed) {
    if (!vfxOn('webShot')) return false;
    const r = this._seed(seed), s = Math.max(0.3, size);
    this._flash(p, 0.42 * s, C.ice, 0.07);
    this._ring(p, 0.26, 0.08 * s, 0.85 * s, C.cyan, 1.4, { width: 0.05, mode: 1, seed: r.range(0, 9) });
    this._sparks(r, p, Math.round(8 + 6 * s), 2.5 * s, 6 * s, 0.18, 0.38, 0.045, C.white, C.cyan, { g: 3, drag: 4 });
    this._sparks(r, p, 4, 0.6, 1.4, 0.4, 0.6, 0.07, C.cyan, C.deep, { tile: 3, g: -0.3, drag: 1.5, i: 0.9 });
    return true;
  }
  /** Hex web net that wraps the target (Effects.net). Returns the shell slot. */
  net(p, r0, life, seed) {
    const r = this._seed(seed);
    const slot = this._shell(p, life, r0 * 0.5, r0 * 1.1, 1, C.cyan, 1.5, { hex: 3.0, seed: r.range(0, 9), fadePow: 1.6 });
    if (this.time - this._lastNet.t > 0.03 || this._lastNet.p.distanceTo(p) > 0.1) { // impact sparks once per contact
      this._lastNet.t = this.time; this._lastNet.p.copy(p);
      this._flash(p, 0.4, C.ice, 0.06);
      this._sparks(r, p, 10, 2, 5, 0.18, 0.35, 0.04, C.white, C.cyan, { g: 3, drag: 4 });
      this._ring(p, 0.22, 0.1, 0.75, C.cyan, 1.1, { width: 0.05 });
    }
    return slot;
  }
  /** Web beam / swing rope (per frame, from Effects.update). */
  beam(b, grow, fade) {
    const rope = b.vfxRope;
    if (!b._vfxInit) { b._vfxInit = true; b._vfxT0 = this.time; b._vfxSeed = (this.seq * 7.31) % 100; b._vfxBurst = false; b._vfxSnap = false; if (!rope) this.webGlint(b.from, b.to); }
    if (rope) {
      if (grow >= 1 && !b._vfxBurst) { b._vfxBurst = true; this.attachBurst(b.to); }
      let s1 = grow, br = 1.2;
      if (!b.hold) { // release snap: the strand recoils toward the wrist over the release window
        if (!b._vfxSnap) { b._vfxSnap = true; b._vfxRel = b.t; this.releaseSnap(b.to, b.from); }
        const k = Math.min(1, (b.t - b._vfxRel) / Math.max(0.05, b.life - b._vfxRel));
        s1 = Math.max(0, 1 - k * k * 1.2); br = 0.9 + 0.8 * (1 - k) * k * 2;
      }
      if (b.pulse > 0) br += 1.1 * b.pulse; // v0.44: a web pull brightens the strand briefly
      const fl = this.host?.flowLevel || 0; br += FEEL.flow.beamBright[fl]; // v0.45: Flow brightens / widens the swing web
      this.beams.put(b.from, b.to, 0.042 * (1 + 0.35 * (b.pulse || 0)) * (1 + FEEL.flow.beamWidth[fl]), 0.02, 0, s1, br, 1, b._vfxT0, b._vfxSeed);
    } else this.beams.put(b.from, b.to, 0.028, 0.016, 0, grow, fade * 1.05, 0, b._vfxT0, b._vfxSeed);
  }
  attachBurst(p, seed) {
    const r = this._seed(seed);
    this._flash(p, 0.75, C.white, 0.07, 0, 1, 2);                      // ≤ 80 ms white star
    this._flash(p, 1.7, C.cyan, 0.34, 0.01, 1.0, 3);                   // hex flash (lattice motif)
    this._flash(p, 0.6, C.deep, 0.3, 0, 0.6);
    this._ring(p, 0.42, 0.1, 2.2, C.cyan, 2.0, { width: 0.05, mode: 1, seed: r.range(0, 9) });
    this._sparks(r, p, 16, 2.5, 6, 0.25, 0.5, 0.07, C.white, C.cyan, { g: 4, drag: 3 });
    this._sparks(r, p, 6, 0.8, 2, 0.5, 0.8, 0.14, C.cyan, C.deep, { tile: 3, g: 1, drag: 2, i: 1.1 });
    pulse(p, 0x7fe8ff, 0.6, 3, 0.25);
  }
  releaseSnap(p, from, seed) {
    const r = this._seed(seed);
    this._flash(p, 0.35, C.ice, 0.07);
    this._sparks(r, p, 8, 1.5, 4, 0.2, 0.35, 0.05, C.ice, C.deep, { g: 5, drag: 3 });
    if (from) for (let k = 0; k < 10; k++) { // the snapped strand sheds sparks along its length
      const f = (k + r.next()) / 10, P = this._p(_a.copy(from).lerp(p, f));
      r.dir(_b); P.vx = _b.x * 1.2; P.vy = _b.y * 1.2; P.vz = _b.z * 1.2; P.g = 4; P.drag = 2; P.life = r.range(0.2, 0.35);
      P.s0 = 0.05; P.s1 = 0.015; P.c0 = C.white; P.c1 = C.cyan; P.i0 = 1.4; P.stretch = 0.1; P.tile = 1;
      this.add.emit(P, this.time + f * 0.1);
    }
  }
  /** Light bomb in flight: trail until the object is hidden. */
  blueTrail(obj, opts = {}) { if (!vfxOn('blueBomb')) return false; this._attachObj(obj, 'blue', opts.scale || 1); return true; }
  /** Blue light bomb detonation: implosion → nova → ring → lingering arcs (+ light pulse). */
  blueBomb(p, { size = 1, seed } = {}) {
    if (!vfxOn('blueBomb')) return false;
    const r = this._seed(seed), s = size, T = 0.09;
    // implosion (0–90 ms)
    this._shell(p, T + 0.01, 1.05 * s, 0.12 * s, 2, C.cyan, 0.55, { ease: 1.6, fadePow: 0.3 });
    for (let k = 0; k < 22; k++) { r.dir(_a); const R = r.range(0.8, 1.25) * s; const P = this._p(_b.copy(p).addScaledVector(_a, R)); P.vx = -_a.x * R / T; P.vy = -_a.y * R / T; P.vz = -_a.z * R / T; P.life = T; P.s0 = 0.05; P.s1 = 0.03; P.c0 = C.cyan; P.c1 = C.white; P.stretch = 0.012; P.tile = 1; P.i0 = 1.3; this.add.emit(P, this.time); }
    // flash + nova (90–450 ms)
    this._flash(p, 1.05 * s, C.white, 0.08, T);
    this._flash(p, 1.7 * s, C.ice, 0.12, T, 0.55, 2);
    this._shell(p, 0.38, 0.25 * s, 1.75 * s, 0, C.cyan, 1.3, { hex: 5, ease: 4, delay: T, fadePow: 1.6 });
    this._shell(p, 0.22, 0.1 * s, 0.85 * s, 0, C.ice, 0.9, { ease: 3, delay: T });
    // rings: horizontal ground/air shockwave + camera-facing hex band
    this._ring(p, 0.55, 0.3 * s, 3.4 * s, C.cyan, 1.6, { n: UP, width: 0.05, delay: T + 0.02 });
    this._ring(p, 0.4, 0.2 * s, 1.9 * s, C.cyan, 1.2, { width: 0.06, mode: 1, delay: T, seed: r.range(0, 9) });
    // sparks + hex glyphs
    this._sparks(r, p, 34, 6 * s, 13 * s, 0.35, 0.7, 0.055, C.white, C.cyan, { g: 4, drag: 3.5, delay: T });
    this._sparks(r, p, 12, 1 * s, 2.6 * s, 0.6, 1.0, 0.12, C.cyan, C.deep, { tile: 3, g: -0.3, drag: 1.4, delay: T + 0.02, i: 1.0 });
    // lingering electric arcs + afterglow + embers
    this._arcsAround(r, p, 6, 0.7 * s, 1.35 * s, T + 0.06, 0.07, 0.45, 0.85);
    { const P = this._p(p); P.life = 0.65; P.s0 = 1.2 * s; P.s1 = 1.8 * s; P.c0 = C.deep; P.c1 = C.deep; P.a = 0.4; this.add.emit(P, this.time + T + 0.05); }
    this._embers(r, p, 14, { spread: 0.5 * s, col: C.cyan, col1: C.deep, life: [1.0, 1.6], delay: [T, T + 0.3] });
    pulse(p, 0x7fe8ff, 1.6, 10 * s, 0.6);
    return true;
  }
  /** Back-pack thrusters (per frame from Locomotion; level 0…1). */
  thruster(group, level, dt) {
    if (!vfxOn('thruster')) {
      if (this._swapped) { for (const [m, mat] of this._swapped) m.material = mat; this._swapped = null; }
      return false;
    }
    if (!this._swapped) { this._swapped = []; for (const m of group.children) if (m.isMesh) { this._swapped.push([m, m.material]); m.material = this.flameMat; } }
    this.flameMat.uniforms.uLevel.value = level;
    if (!group.visible || level < 0.04) return true;
    this._thrAcc += dt * 26 * level;
    let k = 0;
    for (const m of group.children) {
      if (!m.isMesh) continue;
      m.getWorldPosition(_a); m.getWorldQuaternion(_q); _b.set(0, -1, 0).applyQuaternion(_q); // nozzle + exhaust direction
      this.attach.put(_a, 0.26, C.cyan, 1.0 * level, 2);
      k++;
    }
    while (this._thrAcc >= 1) {
      this._thrAcc -= 1; const r = this.rng.reset(hashSeed(0x7a11, this._thrN++));
      for (const m of group.children) {
        if (!m.isMesh) continue;
        m.getWorldPosition(_a); m.getWorldQuaternion(_q); _b.set(0, -1, 0).applyQuaternion(_q);
        const P = this._p(_a.addScaledVector(_b, 0.12)); const sp = r.range(2, 3.2);
        P.vx = _b.x * sp + r.sym(0.3); P.vy = _b.y * sp + r.sym(0.3); P.vz = _b.z * sp + r.sym(0.3);
        P.life = r.range(0.18, 0.28); P.s0 = 0.09; P.s1 = 0.26; P.drag = 3; P.c0 = C.ice; P.c1 = C.deep; P.i0 = 1.3 * level; P.i1 = 0.7; P.a = 0.9; P.hot = 0.3;
        this.add.emit(P, this.time);
        if (this._thrN % 2 === 0) { P.life = r.range(0.25, 0.4); P.s0 = 0.06; P.s1 = 0.03; P.c0 = C.cyan; P.c1 = C.deep; P.i0 = 1.2 * level; P.tile = 3; P.rot = r.range(0, 6.28); P.spin = r.sym(4); P.vx += r.sym(0.8); P.vz += r.sym(0.8); this.add.emit(P, this.time); }
        if (this._thrN % 3 === 0) { P.life = 0.5; P.s0 = 0.1; P.s1 = 0.45; P.c0 = C.dark; P.i0 = 0; P.c1 = [0.75, 0.8, 0.9]; P.a = 0.12 * level; P.tile = r.range(0, 16); P.hot = 0; this.smoke.emit(P, this.time); }
      }
    }
    void k;
    return true;
  }

  // ------------------------------------------------------------------ Green Maniac
  /** Pumpkin bomb in flight: carved-face glow, green halo, fuse sparks, toxic trail (until the bomb is hidden). */
  pumpkinFlight(obj, { scale = 1 } = {}) { if (!vfxOn('pumpkinFlight')) return false; this._attachObj(obj, 'pumpkin', scale); return true; }
  /** Giant bomb charge-up: face grins brighter, embers sucked in, heavier fuse (until hidden). */
  giantCharge(obj) { if (!vfxOn('giantBomb')) return false; this._attachObj(obj, 'giant', obj.root?.scale?.x || 1.65); return true; }
  /** Player success: orange-green burst, shell shards, seeds, smoke puff. */
  pumpkinBurst(p, { size = 1, by = 'web', floor = null, seed, clear = false } = {}) {
    if (!vfxOn('pumpkinBurst')) return false;
    const r = this._seed(seed), s = size * 0.75;
    // v0.30b: it is MOBIUS' hit → it opens with his colour (cyan-white flash + ring + blue sparks), the pumpkin's fire follows
    this._flash(p, 0.95 * s, C.cyan, 0.09, 0, 1.4); this._ring(p, 0.26, 0.15 * size, 1.1 * size, C.cyan, 1.5, { width: 0.07 });
    this._sparks(r, p, 16, 3 * s, 7 * s, 0.25, 0.5, 0.05, C.white, C.cyan, { g: 4, drag: 2.3, i: 1.8 });
    this._fireball(r, p, s, { lobes: clear ? 5 : 6, soot: 4, clear, green: 0 }); // (no green: green belongs to Green Maniac) // clear: arcade (smoke must not hide the next bombs)
    this._shards(r, p, 16, { size: size * 1.6, speed: [2.5 * size, 5 * size], floor });
    this._embers(r, p, 12, { spread: 0.1, vy: [1, 3], vxz: 2, g: 7, life: [0.6, 1.0], size: 0.032, col: C.yellow, col1: C.amber });
    if (by === 'bomb') this._ring(p, 0.3, 0.1 * size, 1.3 * size, C.cyan, 1.0, { width: 0.05, mode: 1 });
    pulse(p, 0xff8a30, 0.8, 5 * size, 0.35);
    return true;
  }
  /** Pumpkin bomb reaching the player: near-player explosion kept out of the face (edge rim = damageEdge()). */
  missBlast(p, camPos, { seed } = {}) {
    if (!vfxOn('missBlast')) return false;
    const r = this._seed(seed);
    // keep the visual ≥ 1.3 m from the eyes and a little low → reads as hitting the shield, not exploding in the face
    _e.copy(p).sub(camPos); const dist = _e.length(); _e.divideScalar(dist || 1);
    { // never straight below the eyes: keep the elevation ≥ −25° (lower periphery, visible), direction from the bomb's side
      let hx = _e.x, hz = _e.z, hl = Math.hypot(hx, hz);
      if (hl < 0.3 && this.camera) { this.camera.getWorldDirection(_b); hx = _b.x; hz = _b.z; hl = Math.hypot(hx, hz) || 1; }
      if (_e.y < -0.42) { _e.set(hx / hl * 0.906, -0.42, hz / hl * 0.906); }
    }
    if (this.camera) { // v0.30b: never in the view centre — pushed ≥ 28° off the gaze, toward the lower side
      this.camera.getWorldDirection(_b); const cs = _e.dot(_b);
      if (cs > 0.88) { const dn = _a.set(0, -1, 0).addScaledVector(_b, _b.y).normalize(); _e.copy(_b).multiplyScalar(0.88).addScaledVector(dn, 0.475).normalize(); }
    }
    const q = _c.copy(camPos).addScaledVector(_e, Math.max(dist, 1.6));
    this._lastBlast.t = this.time; this._lastBlast.p.copy(q);
    this._fireball(r, q, 0.42, { lobes: 5, soot: 3, fire: C.red, fi: 1.7, green: 0.3, fireDur: 0.4, life: [0.45, 0.6] });
    // sparks fly to the sides (perpendicular to the view) → past the periphery, never into the eyes
    for (let k = 0; k < 20; k++) { r.dir(_a); _a.addScaledVector(_e, -_a.dot(_e)).normalize(); const sp = r.range(3, 7); const P = this._p(q); P.vx = _a.x * sp; P.vy = _a.y * sp; P.vz = _a.z * sp; P.life = r.range(0.2, 0.4); P.s0 = 0.04; P.s1 = 0.015; P.g = 5; P.drag = 2.5; P.c0 = C.yellow; P.c1 = C.red; P.stretch = 0.04; P.tile = 1; P.i0 = 1.4; this.add.emit(P, this.time); }
    this._shards(r, q, 6, { speed: [1.5, 3.5] });
    this._ring(q, 0.18, 0.06, 0.6, C.amber, 0.9, { width: 0.06 });
    pulse(q, 0xff5020, 1.0, 4, 0.3);
    return true;
  }
  /** Damage feedback on the VIEW EDGE (rim + shield crack). Called from App.flashDamage. */
  damageEdge() {
    if (!vfxOn('missBlast')) return false;
    let dx = 0, dy = -1;
    if (this.camera && this.time - this._lastBlast.t < 0.6) { const l = _a.copy(this._lastBlast.p); this.camera.worldToLocal(l); dx = l.x; dy = l.y; if (Math.hypot(dx, dy) < 0.05) { dx = 0; dy = -1; } }
    this.edge.trigger(dx, dy, 1 + (this.seq++ % 61) * 1.37);
    return true;
  }
  /** Large pumpkin fireball (giant bomb / routed big orange booms). */
  giantBlast(p, { size = 1, seed, smoke = true } = {}) {
    if (!vfxOn('giantBomb')) return false;
    this._bigFire(this._seed(seed), p, size, smoke);
    return true;
  }
  _bigFire(r, p, s, smoke, near = 0) {
    this._fireball(r, p, (near > 0.5 ? 1.6 : 2.4) * s, { lobes: near > 0.5 ? 5 : 9, soot: near > 0.5 ? 3 : 8, near, up: 1.0, fireDur: 0.42, life: [1.0, 1.3] });
    this._ring(p, 0.6, 0.5 * s, 7 * s, C.amber, 1.2, { n: UP, width: 0.04, delay: 0.02 });
    this._sparks(r, p, 30, 6 * s, 14 * s, 0.4, 0.9, 0.07, C.yellow, C.orange, { g: 8, drag: 2 });
    this._shards(r, p, near > 0.5 ? 8 : 20, { rubble: true, size: 0.9 * s, speed: [3 * s, 8 * s], up: near > 0.5 ? 0.15 : 0.35, life: [1.5, 2.2], alb: C.shellDark, em: 2.0, emc: C.orange, cool: 0.9, floor: p.y - 0.4 });
    if (smoke) this._smokePuffs(r, _a.copy(p).add(_b.set(0, 0.8 * s, 0)), 10, { spread: 0.8 * s, vy: [0.8, 1.6], vxz: 0.5, s0: [1.2 * s, 1.6 * s], s1: [3 * s, 3.8 * s], life: [1.6, 2.2], col: C.smoke, a: 0.6, g: -0.2, delay: [0.3, 0.7] });
    this._embers(r, p, 30, { spread: 0.8 * s, vy: [1, 3], vxz: 1.2, life: [1.4, 2.4], delay: [0, 0.8] });
    pulse(p, 0xff7a1a, 2.0, 16 * s, 0.9);
  }
  /** Story roof blast (factoryFlow._explode): dust → fire → debris shower → smoke column → embers, ~3 s. */
  roofExplosion(p, { seed } = {}) {
    if (!vfxOn('roofExplosion')) return false;
    const r = this._seed(seed);
    // LOD: in the story the bomb lands ~1 m from the player → fewer, smaller near-camera quads (overdraw ≤ 2.5 layers)
    const near = this.camera ? THREE.MathUtils.clamp(1 - (this.camera.getWorldPosition(_e).distanceTo(p) - 3) / 5, 0, 1) : 0;
    // dust burst along the roof (0 ms)
    for (let k = 0; k < 14; k++) { if (near > 0.5 && k % 2) continue; const a = (k / 14) * 6.283 + r.sym(0.2); const P = this._p(p); const sp = r.range(3, 6); P.vx = Math.cos(a) * sp; P.vy = r.range(0.2, 0.8); P.vz = Math.sin(a) * sp; P.drag = 2.6; P.life = r.range(1.0, 1.4); P.s0 = 0.4; P.s1 = r.range(1.8, 2.4); P.c0 = C.dark; P.i0 = 0; P.c1 = C.dust; P.a = 0.7; P.rot = r.range(0, 6.28); P.tile = r.range(0, 16); this.smoke.emit(P, this.time); }
    this._ring(p, 0.5, 0.3, 6, C.dust, 0.5, { n: UP, width: 0.08 });
    // fire (60 ms)
    const t0 = this.time; this.time += 0.06; this._bigFire(r, _c.copy(p).add(_d.set(0, 0.4, 0)), 1.1 - 0.35 * near, false, near); this.time = t0;
    // debris chunk shower (150 ms)
    this._shards(r, p, near > 0.5 ? 10 : 28, { rubble: true, size: near > 0.5 ? 0.7 : 1.2, speed: near > 0.5 ? [3, 6] : [4, 9], up: near > 0.5 ? 0.2 : 0.5, life: [1.8, 2.4], alb: C.concrete, em: 1.6, emc: C.orange, cool: 0.7, floor: p.y - 0.15, delay: 0.15 });
    // smoke column (0.3 – 2.2 s)
    for (let k = 0; k < 22; k++) {
      if (near > 0.5 && k % 2) continue;
      const P = this._p(p); P.x += r.sym(0.6); P.z += r.sym(0.6); P.y += 0.3;
      P.vx = r.sym(0.4); P.vy = r.range(1.2, 2.6); P.vz = r.sym(0.4); P.g = -0.15; P.drag = 0.4;
      P.life = r.range(1.3, 1.5); P.s0 = r.range(1.6, 2.2); P.s1 = r.range(4.5, 5.6);
      const early = k < 6; P.c0 = C.red; P.i0 = early ? 0.8 : 0; P.hot = early ? 0.08 : 0; P.c1 = k % 3 ? C.smoke : C.purple; P.a = 0.7; P.rot = r.range(0, 6.28); P.spin = r.sym(0.3); P.tile = r.range(0, 16);
      this.smoke.emit(P, this.time + 0.3 + k * 0.085);
    }
    this._embers(r, _c.copy(p).add(_d.set(0, 0.5, 0)), 40, { spread: 1.0, vy: [1, 3.2], vxz: 1.1, g: -0.35, life: [1.2, 2.0], delay: [0.2, 2.5] });
    pulse(p, 0xff7a1a, 2.2, 18, 1.0);
    return true;
  }
  /** Chase bomb explosion (5–40 m against the sunset): bigger, darker smoke outline, bright core. */
  chaseBomb(p, { size = 2.6, seed } = {}) {
    if (!vfxOn('chaseBomb')) return false;
    const r = this._seed(seed), s = size * 0.6;
    this._fireball(r, p, s, { lobes: 7, soot: 6, green: 1.2 });
    for (let k = 0; k < 7; k++) { const a = (k / 7) * 6.283 + r.sym(0.3); const P = this._p(p); const sp = r.range(1.4, 2.2) * s; P.vx = Math.cos(a) * sp; P.vy = r.range(-0.2, 0.5) * s; P.vz = Math.sin(a) * sp; P.drag = 2; P.g = -0.2; P.life = r.range(1.1, 1.4); P.s0 = 0.5 * s; P.s1 = 1.6 * s; P.c0 = C.red; P.i0 = 0.9; P.hot = 0.1; P.c1 = C.dark; P.a = 0.8; P.rot = r.range(0, 6.28); P.tile = r.range(0, 16); this.smoke.emit(P, this.time + 0.1); }
    this._shards(r, p, 10, { size: size * 0.8, speed: [3 * s, 6 * s], floor: p.y - 6 });
    this._embers(r, p, 12, { spread: 0.4 * s, vy: [0.6, 2], vxz: 1.2, life: [0.9, 1.5], size: 0.05 });
    pulse(p, 0xff7a1a, 1.4, 12, 0.5);
    return true;
  }
  /** Bomb timing out in the air (small fizzle). */
  fizzle(p, seed) {
    if (!vfxOn('chaseBomb')) return false;
    const r = this._seed(seed);
    this._flash(p, 0.3, C.amber, 0.06);
    this._smokePuffs(r, p, 3, { spread: 0.1, s0: [0.15, 0.25], s1: [0.5, 0.7], life: [0.8, 1.1], a: 0.5 });
    this._sparks(r, p, 6, 1.5, 3, 0.2, 0.35, 0.04, C.yellow, C.orange, { g: 5 });
    return true;
  }
  /** fx.boom routing by colour family (returns true when handled by the kit). */
  routeBoom(p, color, size, life) {
    void life;
    if (MOBIUS.has(color)) return color === 0x5fd8ff && size >= 1.2 ? this.blueBomb(p, { size: size / 1.4 }) : this.webImpact(p, size);
    if (MANIAC.has(color)) return size >= 2 ? this.giantBlast(p, { size: size / 2.8 }) : this.chaseBomb(p, { size: Math.max(0.6, size * 1.6) });
    if (color === 0xffd080) return this.fizzle(p);
    return false;
  }

  // ------------------------------------------------------------------ attachments (follow moving objects)
  _attachObj(obj, kind, scale) {
    let a = this.att.find((x) => x.on && x.obj === obj) || this.att.find((x) => !x.on);
    if (!a) return;
    a.on = true; a.obj = obj; a.kind = kind; a.t = 0; a.scale = scale; a.seed = hashSeed(this.seq++, 0xa77); a.n = 0; a.acc = 0; a.has = false;
  }
  _stepAttach(a, dt) {
    const o = a.obj.root || a.obj;
    if (!o.visible || !o.parent || (o.parent.visible === false)) { a.on = false; a.obj = null; return; }
    a.t += dt; a.n++;
    const p = o.getWorldPosition(_a), s = a.scale;
    const vel = _b.set(0, 0, 0); if (a.has && dt > 0) vel.copy(p).sub(a.last).divideScalar(dt); a.last.copy(p); a.has = true;
    const r = this.rng.reset(hashSeed(a.seed, a.n));
    const cam = this.camera ? this.camera.getWorldPosition(_c) : null;
    if (a.kind === 'blue') {
      this.attach.put(p, 0.45, C.deep, 0.9, 2);
      for (let k = 0; k < 2; k++) { const P = this._p(p); P.vx = -vel.x * 0.15 + r.sym(0.6); P.vy = -vel.y * 0.15 + r.sym(0.6); P.vz = -vel.z * 0.15 + r.sym(0.6); P.life = r.range(0.18, 0.3); P.s0 = 0.05; P.s1 = 0.015; P.drag = 3; P.c0 = C.white; P.c1 = C.cyan; P.stretch = 0.03; P.tile = 1; P.i0 = 1.4; this.add.emit(P, this.time); }
      { const P = this._p(p); P.life = 0.22; P.s0 = 0.16; P.s1 = 0.05; P.c0 = C.cyan; P.c1 = C.deep; P.a = 0.7; this.add.emit(P, this.time); }
      if (a.n % 3 === 0) { const P = this._p(p); P.vx = r.sym(0.4); P.vy = r.sym(0.4); P.vz = r.sym(0.4); P.life = 0.4; P.s0 = 0.07; P.s1 = 0.03; P.c0 = C.cyan; P.c1 = C.deep; P.tile = 3; P.rot = r.range(0, 6.28); P.i0 = 1.1; this.add.emit(P, this.time); }
      return;
    }
    const giant = a.kind === 'giant';
    const R = 0.17 * s; // bomb radius (0.34 m model × scale)
    const k = giant ? THREE.MathUtils.smoothstep(a.t, 0, 2.2) : 1;
    const flick = 0.92 + 0.08 * Math.sin(a.t * 6.0 + a.seed) * Math.sin(a.t * 2.3); // candle-like, slow
    // carved face glow (in front of the shell toward the camera) + toxic halo
    this.attach.put(p, R * (giant ? 2.3 + 0.5 * k : 2.5), C.orange, (giant ? 0.45 + 1.25 * k : 0.75) * flick, 0, 0, R * 0.9);
    const hp = giant ? 0.5 + 0.5 * Math.sin(a.t * 6.283 * 1.5) : 1; // giant: 1.5 Hz pulse
    this.attach.put(p, R * (giant ? 6 + 2 * k : 7), C.green, (giant ? 0.18 + 0.32 * k * hp : 0.38) * flick, 1);
    // fuse sparks (stem on top)
    const top = _d.copy(p); top.y += R * 1.05;
    if (a.n % (giant ? 1 : 2) === 0) for (let q = 0; q < (giant ? 2 : 1); q++) { const P = this._p(top); P.vx = r.sym(1.2) + vel.x * 0.3; P.vy = r.range(1, 2.4) + vel.y * 0.3; P.vz = r.sym(1.2) + vel.z * 0.3; P.g = 6; P.drag = 1.5; P.life = r.range(0.15, 0.3); P.s0 = 0.035 * Math.sqrt(s); P.s1 = 0.01; P.c0 = C.yellow; P.c1 = C.orange; P.stretch = 0.05; P.tile = 1; P.i0 = 1.6; this.add.emit(P, this.time); }
    if (!giant) {
      // toxic green trail + faint purple smoke
      const sp = vel.length();
      if (sp > 0.5) {
        const P = this._p(p); P.x += r.sym(R * 0.5); P.y += r.sym(R * 0.5); P.z += r.sym(R * 0.5);
        P.vx = r.sym(0.25); P.vy = r.range(0, 0.3); P.vz = r.sym(0.25); P.drag = 1.5;
        P.life = r.range(0.4, 0.55); P.s0 = 0.16 * s; P.s1 = 0.06 * s; P.c0 = C.lime; P.c1 = C.green; P.i0 = 1.3; P.i1 = 0.9; P.a = 0.75; P.hot = 0.1;
        this.add.emit(P, this.time);
        if (a.n % 2 === 0) { P.life = 0.8; P.s0 = 0.2 * s; P.s1 = 0.6 * s; P.c0 = C.green; P.i0 = 0.7; P.hot = 0.35; P.c1 = C.purple; P.a = 0.45; P.tile = r.range(0, 16); P.rot = r.range(0, 6.28); this.smoke.emit(P, this.time); }
      }
    } else if (a.n % 1 === 0) {
      // charge: embers sucked into the bomb
      const n = 1 + Math.round(2 * k);
      for (let q = 0; q < n; q++) { r.dir(_e); const D = R * r.range(3.5, 5.5), L = r.range(0.3, 0.45); const P = this._p(_c.copy(p).addScaledVector(_e, D)); P.vx = -_e.x * D / L; P.vy = -_e.y * D / L; P.vz = -_e.z * D / L; P.life = L; P.s0 = 0.03; P.s1 = 0.06; P.c0 = q % 2 ? C.lime : C.amber; P.c1 = C.yellow; P.stretch = 0.02; P.tile = 1; P.i0 = 0.6 + 1.0 * k; this.add.emit(P, this.time); }
    }
    void cam;
  }

  // ------------------------------------------------------------------ frame
  preUpdate() { this.beams.begin(); this.attach.begin(); }
  update(dt, camera) {
    if (camera && this.camera !== camera) { this.camera = camera; camera.add(this.edge.mesh); }
    this.time += dt; VFX_U.uTime.value = this.time;
    for (const a of this.att) if (a.on) this._stepAttach(a, dt);
    let live = false;
    for (const s of this.systems) { s.frame(this.time); live = live || s.mesh.visible; }
    this.beams.end(); this.attach.end(); this.edge.update(dt);
    for (const o of this.warmObjs) if (o.k > 0 && --o.k === 0) o.obj.visible = o.was;
    if (this.flameWarm.visible && --this._flameWarm <= 0) this.flameWarm.visible = false;
    if (this.time > 1800 && !live && !this.att.some((a) => a.on)) this.clear(); // keep float time precise
  }
  /** Show every system for a few frames (programs compiled during a lead-in, never in play). */
  prewarm(frames = 4) {
    for (const s of [...this.systems, this.beams, this.attach, this.edge]) s.warm = frames;
    this.flameWarm.visible = true; this._flameWarm = frames;
    for (const o of this.warmObjs) { if (o.k <= 0) o.was = o.obj.visible; o.k = frames; o.obj.visible = true; }
  }
  /** Objects with their own new materials (wind streaks…) shown during prewarm. */
  registerWarm(obj) { this.warmObjs.push({ obj, k: 0, was: obj.visible }); }
  shift(dx, dz) { VFX_U.uOffset.value.x += dx; VFX_U.uOffset.value.z += dz; this._lastBlast.p.x += dx; this._lastBlast.p.z += dz; }
  clear() {
    for (const s of this.systems) s.clear();
    this.beams.clear(); this.attach.clear(); this.edge.clear();
    for (const a of this.att) { a.on = false; a.obj = null; }
    this.time = 0; VFX_U.uTime.value = 0; VFX_U.uOffset.value.set(0, 0, 0); this.seq = 1; this._thrN = 0; this._thrAcc = 0;
    this._lastBlast.t = -9; this._lastNet.t = -9;
  }
  stats() { return { draws: [...this.systems, this.beams, this.attach, this.edge].filter((s) => s.mesh.visible).length, att: this.att.filter((a) => a.on).length }; }
}
