// Shared palette, toon gradient, cached materials and geometry helpers for all
// procedural art. Everything here is module-level and shared so that many
// instances of a model cost no extra programs / textures.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const PALETTE = {
  heroWhite: 0xf2f5f8,
  graphite: 0x23262b,
  cyan: 0x22d3ff,
  deepBlue: 0x1a6bff,
  emerald: 0x1f7a3a,
  emeraldDark: 0x0e2a17,
  scaleGreen: 0x3e8e3a,
  amber: 0xffb020,
  purple: 0x5b2a86,
  skin: 0xd8a07a,
  fabric: 0x2b2f3a,
  gunmetal: 0x2a2d33,
  black: 0x0b0c0e,
  ledRed: 0xff2a2a,
};

// ---------------------------------------------------------------- toon ramp
/** Shared 3-step gradient map (NearestFilter) for MeshToonMaterial. */
export const toonGradient = (() => {
  const data = new Uint8Array([90, 170, 255]);
  const tex = new THREE.DataTexture(data, data.length, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
})();

const _cache = new Map();
function cached(key, make) {
  let m = _cache.get(key);
  if (!m) { m = make(); _cache.set(key, m); }
  return m;
}

/** Cached cel material. */
export function toon(color, opts = {}) {
  const key = `toon:${color}:${JSON.stringify(opts)}`;
  return cached(key, () => new THREE.MeshToonMaterial({ color, gradientMap: toonGradient, ...opts }));
}

/** Cached metallic material (cheap: no env map needed, moderate metalness). */
export function metal(color, metalness = 0.55, roughness = 0.38, opts = {}) {
  const key = `metal:${color}:${metalness}:${roughness}:${JSON.stringify(opts)}`;
  return cached(key, () => new THREE.MeshStandardMaterial({ color, metalness, roughness, ...opts }));
}

/** Cached unlit glowing material (toneMapped:false so it pops / blooms). */
export function glow(color, opts = {}) {
  const key = `glow:${color}:${JSON.stringify(opts)}`;
  return cached(key, () => new THREE.MeshBasicMaterial({ color, toneMapped: false, ...opts }));
}

/** Cached additive transparent material (flames, glows). */
export function additive(color, opacity = 1, opts = {}) {
  const key = `add:${color}:${opacity}:${JSON.stringify(opts)}`;
  return cached(key, () => new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, blending: THREE.AdditiveBlending,
    depthWrite: false, toneMapped: false, ...opts,
  }));
}

export const MAT = {
  heroWhite: toon(PALETTE.heroWhite),
  graphite: toon(PALETTE.graphite),
  cyanLED: glow(PALETTE.cyan),
  deepBlue: glow(PALETTE.deepBlue),
  skin: toon(PALETTE.skin),
  fabric: toon(PALETTE.fabric),
  emerald: toon(PALETTE.emerald),
  emeraldDark: toon(PALETTE.emeraldDark),
  scaleGreen: toon(PALETTE.scaleGreen),
  amberGlow: glow(PALETTE.amber),
  purple: toon(PALETTE.purple),
  black: toon(PALETTE.black),
  gunmetal: toon(PALETTE.gunmetal),
};

// ------------------------------------------------------------- outlines
/**
 * Inverted-hull outline material. Vertices are pushed along their normal in
 * VIEW space, so `thickness` is in metres regardless of object / instance
 * scale. Cached per (color, thickness).
 */
export function outlineMaterial(thickness = 0.006, color = 0x000000) {
  return cached(`outline:${color}:${thickness}`, () => {
    const m = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide, toneMapped: false });
    const u = { value: thickness };
    m.userData.thickness = u;
    m.onBeforeCompile = (s) => {
      s.uniforms.outlineThickness = u;
      s.vertexShader = 'uniform float outlineThickness;\n' + s.vertexShader.replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vec3 oN = normal;
        #ifdef USE_INSTANCING
          oN = mat3( instanceMatrix ) * oN;
        #endif
        oN = normalize( normalMatrix * oN );
        mvPosition.xyz += oN * outlineThickness;
        gl_Position = projectionMatrix * mvPosition;`,
      );
    };
    m.customProgramCacheKey = () => 'inv-hull-outline';
    return m;
  });
}

const _smoothCache = new WeakMap();
/** Position-only, welded, smooth-normal copy of a geometry (crack-free hulls). */
export function smoothHullGeometry(geom) {
  let g = _smoothCache.get(geom);
  if (g) return g;
  g = new THREE.BufferGeometry();
  const src = geom.index ? geom.toNonIndexed() : geom;
  g.setAttribute('position', src.getAttribute('position').clone());
  g = mergeVertices(g, 1e-4);
  g.computeVertexNormals();
  _smoothCache.set(geom, g);
  return g;
}

/**
 * Adds an inverted-hull outline as a child of `mesh` and returns it.
 * Works with Mesh and InstancedMesh (instance matrices + count are shared).
 */
export function outline(mesh, thickness = 0.006, color = 0x000000) {
  const geom = smoothHullGeometry(mesh.geometry);
  const mat = outlineMaterial(thickness, color);
  let o;
  if (mesh.isInstancedMesh) {
    o = new THREE.InstancedMesh(geom, mat, mesh.instanceMatrix.count);
    o.instanceMatrix = mesh.instanceMatrix;
    o.onBeforeRender = () => { o.count = mesh.count; };
    o.frustumCulled = false;
  } else {
    o = new THREE.Mesh(geom, mat);
    o.frustumCulled = mesh.frustumCulled;
  }
  o.name = (mesh.name || 'mesh') + ':outline';
  o.renderOrder = mesh.renderOrder;
  o.raycast = () => {};
  mesh.add(o);
  return o;
}

// ------------------------------------------------------- geometry helpers
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

/** Strip a geometry to non-indexed position/normal/uv so anything merges. */
export function normalizeGeometry(g) {
  let out = g.index ? g.toNonIndexed() : g.clone();
  for (const name of Object.keys(out.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'uv') out.deleteAttribute(name);
  }
  if (!out.attributes.normal) out.computeVertexNormals();
  if (!out.attributes.uv) {
    out.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(out.attributes.position.count * 2), 2));
  }
  out.morphAttributes = {};
  out.clearGroups();
  return out;
}

/** Compose a matrix from [x,y,z] position, [x,y,z] euler (or Quaternion), scale. */
export function makeMatrix(pos = [0, 0, 0], rot = [0, 0, 0], scale = 1, order = 'XYZ') {
  _p.set(pos[0], pos[1], pos[2]);
  if (rot && rot.isQuaternion) _q.copy(rot); else _q.setFromEuler(_e.set(rot[0], rot[1], rot[2], order));
  if (typeof scale === 'number') _s.setScalar(scale); else _s.set(scale[0], scale[1], scale[2]);
  return _m.compose(_p, _q, _s);
}

/**
 * Collects geometry per material, then merges into one mesh per material
 * (+ one optional merged outline hull) under a parent Object3D.
 */
export class PartBuilder {
  constructor() { this.lists = new Map(); this.hull = []; }

  /** add(geom, material, pos, rot, scale, {outline:true}) – geometry is copied. */
  add(geom, mat, pos, rot, scale, opts = {}) {
    const g = normalizeGeometry(geom);
    g.applyMatrix4(makeMatrix(pos, rot, scale, opts.order));
    if (!this.lists.has(mat)) this.lists.set(mat, []);
    this.lists.get(mat).push(g);
    if (opts.outline) this.hull.push(g);
    return this;
  }

  /** Adds a pre-transformed geometry (already in part space). */
  addRaw(geom, mat, opts = {}) {
    const g = normalizeGeometry(geom);
    if (!this.lists.has(mat)) this.lists.set(mat, []);
    this.lists.get(mat).push(g);
    if (opts.outline) this.hull.push(g);
    return this;
  }

  /** Builds merged meshes into `parent`. Returns {meshes: Map(mat→mesh), outline}. */
  build(parent, { outlineThickness = 0.006, outlineColor = 0x000000, name = 'part' } = {}) {
    const meshes = new Map();
    for (const [mat, list] of this.lists) {
      const geom = list.length === 1 ? list[0] : mergeGeometries(list, false);
      const mesh = new THREE.Mesh(geom, mat);
      mesh.name = name;
      parent.add(mesh);
      meshes.set(mat, mesh);
    }
    let hullMesh = null;
    if (this.hull.length) {
      const hg = smoothHullGeometry(this.hull.length === 1 ? this.hull[0] : mergeGeometries(this.hull, false));
      hullMesh = new THREE.Mesh(hg, outlineMaterial(outlineThickness, outlineColor));
      hullMesh.name = name + ':outline';
      hullMesh.raycast = () => {};
      parent.add(hullMesh);
    }
    return { meshes, outline: hullMesh };
  }

  /** Builds a single merged geometry for one material (for instancing etc). */
  geometryFor(mat) {
    const list = this.lists.get(mat);
    return list.length === 1 ? list[0] : mergeGeometries(list, false);
  }
}

/** Shared unit-ish primitive geometries (do not dispose). */
export const GEO = {
  sphere: new THREE.SphereGeometry(1, 16, 12),
  sphereLo: new THREE.SphereGeometry(1, 10, 8),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 12, 1),
  cylLo: new THREE.CylinderGeometry(1, 1, 1, 8, 1),
  cone: new THREE.ConeGeometry(1, 1, 8, 1),
  cone4: new THREE.ConeGeometry(1, 1, 4, 1),
  box: new THREE.BoxGeometry(1, 1, 1),
  octa: new THREE.OctahedronGeometry(1, 0),
};

/** A tapered cylinder (frustum) along +Y, centred, unit-length scaled by args. */
export function frustum(rTop, rBot, h, seg = 10) {
  return new THREE.CylinderGeometry(rTop, rBot, h, seg, 1);
}

/** Glowing lemniscate (infinity / Möbius) tube in the XY plane. */
export function lemniscateGeometry(a = 0.07, tube = 0.007, segs = 96) {
  class Lemniscate extends THREE.Curve {
    getPoint(t, target = new THREE.Vector3()) {
      const u = t * Math.PI * 2;
      const s = Math.sin(u), c = Math.cos(u);
      const d = 1 + s * s;
      return target.set((a * c) / d, (a * s * c) / d, 0);
    }
  }
  return new THREE.TubeGeometry(new Lemniscate(), segs, tube, 6, true);
}
