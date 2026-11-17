// Shared helpers for the procedural cel-shaded environment art.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

let _gradient = null;
/**
 * Toon ramp, nearest filtered. Sampled at dotNL*0.5+0.5, 4 texels:
 * dotNL<-0.5 / <0 -> shadow (sun barely contributes), 0..0.5 -> mid, >0.5 -> lit.
 */
export function gradientMap() {
  if (_gradient) return _gradient;
  const v = [45, 60, 170, 255];
  const data = new Uint8Array(v.flatMap((x) => [x, x, x, 255]));
  const tex = new THREE.DataTexture(data, 4, 1, THREE.RGBAFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  _gradient = tex;
  return tex;
}

export function toonMaterial(params = {}) {
  return new THREE.MeshToonMaterial({ gradientMap: gradientMap(), ...params });
}

/** Create a CanvasTexture by running draw(ctx, w, h) once. */
export function canvasTexture(w, h, draw, { repeat = false, srgb = true, anisotropy = 8, mipmaps = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  draw(ctx, w, h);
  const tex = new THREE.CanvasTexture(c);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { tex.wrapS = tex.wrapT = THREE.RepeatWrapping; }
  tex.anisotropy = anisotropy;
  tex.generateMipmaps = mipmaps;
  if (!mipmaps) tex.minFilter = THREE.LinearFilter;
  return tex;
}

/** Deterministic PRNG. */
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const _c = new THREE.Color();
/**
 * Collects primitive geometries (with a per-piece colour) and merges them
 * into one vertex-coloured BufferGeometry -> one draw call per material.
 */
export class GeoBucket {
  constructor() { this.parts = []; }
  /**
   * @param {THREE.BufferGeometry} geo  (consumed)
   * @param {number|string|THREE.Color|function} color  or fn(x,y,z,nx,ny,nz)->THREE.Color
   * @param {object} [t] {pos:[x,y,z], rot:[x,y,z], scale:[x,y,z], matrix}
   */
  add(geo, color, t = {}) {
    let g = geo.index ? geo.toNonIndexed() : geo;
    for (const k of Object.keys(g.attributes)) {
      if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    }
    if (!g.attributes.uv) {
      g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    }
    if (!g.attributes.normal) g.computeVertexNormals();
    const m = t.matrix || new THREE.Matrix4().compose(
      new THREE.Vector3(...(t.pos || [0, 0, 0])),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...(t.rot || [0, 0, 0]), t.order || 'XYZ')),
      new THREE.Vector3(...(t.scale || [1, 1, 1])));
    g.applyMatrix4(m);
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    const P = g.attributes.position.array, N = g.attributes.normal.array;
    const isFn = typeof color === 'function';
    if (!isFn) _c.set(color);
    for (let i = 0; i < n; i++) {
      if (isFn) _c.copy(color(P[i * 3], P[i * 3 + 1], P[i * 3 + 2], N[i * 3], N[i * 3 + 1], N[i * 3 + 2]));
      col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.groups = [];
    this.parts.push(g);
    return this;
  }
  box(w, h, d, color, pos, rot) { return this.add(new THREE.BoxGeometry(w, h, d), color, { pos, rot }); }
  get empty() { return this.parts.length === 0; }
  build() {
    if (!this.parts.length) return new THREE.BufferGeometry();
    const g = mergeGeometries(this.parts, false);
    this.parts.forEach((p) => p.dispose());
    this.parts = [];
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
  mesh(material, name) {
    const m = new THREE.Mesh(this.build(), material);
    m.name = name || '';
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    return m;
  }
}

/**
 * Low-level quad builder (positions/normals/uvs/colors) for facades where we
 * need explicit world-scaled UVs.
 */
export class QuadBuilder {
  constructor() { this.p = []; this.n = []; this.uv = []; this.c = []; }
  /** a,b,c,d counter-clockwise seen from the front. uvs: [[u,v]x4]. */
  quad(a, b, c, d, uvs, color = [1, 1, 1]) {
    const e1 = new THREE.Vector3().subVectors(new THREE.Vector3(...b), new THREE.Vector3(...a));
    const e2 = new THREE.Vector3().subVectors(new THREE.Vector3(...d), new THREE.Vector3(...a));
    const nrm = new THREE.Vector3().crossVectors(e1, e2).normalize();
    const idx = [0, 1, 2, 0, 2, 3];
    const pts = [a, b, c, d];
    for (const i of idx) {
      this.p.push(...pts[i]);
      this.n.push(nrm.x, nrm.y, nrm.z);
      this.uv.push(...uvs[i]);
      this.c.push(...color);
    }
  }
  get count() { return this.p.length / 3; }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

export const col = (hex) => new THREE.Color(hex);
