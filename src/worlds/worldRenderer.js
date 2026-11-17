// World Chase renderer (v0.40): builds the visuals of each streamed route module with the map's kit (one merged
// opaque mesh + one additive glow mesh + one floor ribbon per module), the sky dome, the far backdrop (follows the
// camera, faces the route's main heading), the camera-following particles and the anchor devices (instanced).
// Module visuals are built time-sliced (generator, per-frame budget) and the cell is marked ready afterwards, so
// anchors / coins only appear on geometry that exists. Everything it creates is disposed in dispose().
import * as THREE from 'three';
import { GeoBuilder, K } from './art/builder.js';
import { createWorldMaterial, createTreeMaterial, createGlowMaterial, createFloorMaterial, createSkyMaterial, createParticles } from './art/shaders.js';
import { toWorld, frameAt } from './route.js';
import { mulberry32 } from '../data/box.js';
import { KITS } from './kits/index.js';

const MAX_ANCHORS = 640;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(1.35, 1.35, 1.35), _v = new THREE.Vector3(), _z = new THREE.Vector3(0, 0, 1), _up = new THREE.Vector3(0, 1, 0);

export class WorldRenderer {
  constructor(app, map, world) {
    this.app = app; this.map = map; this.world = world;
    this.kit = KITS[map.id];
    this.root = new THREE.Group(); this.root.name = `world-${map.id}`;
    this.mat = createWorldMaterial(map.look);
    this.glowMat = createGlowMaterial(map.look);
    this.floorMat = createFloorMaterial(map);
    this.backMat = createWorldMaterial(map.look); this.backMat.side = THREE.DoubleSide;
    { const bf = map.look.backFog || [map.look.fog.near * 2.5, map.look.fog.far * 2.6]; this.backMat.uniforms.uFog.value.set(bf[0], bf[1], 0, 0); this.backMat.uniforms.uLitFrac.value = map.look.win.litFrac * 0.35; }
    this.backGlow = createGlowMaterial(map.look); this.backGlow.uniforms.uFog.value.set(map.look.fog.near * 3, map.look.fog.far * 3, 0, 0);
    this.mats = [this.mat, this.glowMat, this.floorMat, this.backMat, this.backGlow];
    this.extras = this.kit.createExtras?.(this) || null; // v0.41: optional per-kit extras (foldscape: the Blender detail pools)
    this.visuals = new Map(); this.jobs = []; this.stats = { built: 0, buildMs: 0, maxBuildMs: 0, tris: 0, queue: 0 };
    this._sky(); this._backdrop(); this._underPlane(); this._anchors();
    this.particles = createParticles(map.look); this.root.add(this.particles); this.mats.push(this.particles.material);
    this.off = world.on({
      cellAdded: (c) => this.jobs.push({ cell: c, gen: this._buildCell(c) }),
      cellRemoved: (c) => this._release(c),
      rebased: (dx, dz) => { for (const v of this.visuals.values()) { v.group.position.x += dx; v.group.position.z += dz; } this._anchorsDirty = true; this.extras?.rebased?.(dx, dz); },
    });
    this.time = 0;
  }
  // ---------------------------------------------------------------- sky / backdrop / far plane
  _sky() {
    this.skyMat = createSkyMaterial(this.map.look); this.mats.push(this.skyMat);
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1100, 32, 16), this.skyMat); this.sky.frustumCulled = false; this.sky.renderOrder = 1000; this.sky.name = 'WorldSky';
    this.root.add(this.sky);
  }
  _backdrop() {
    const b = new GeoBuilder(), g = new GeoBuilder(), r = mulberry32(0xbac0 + this.map.order);
    this.kit.backdrop?.(b, g, { map: this.map, rng: r, K });
    this.backdrop = new THREE.Group(); this.backdrop.name = 'WorldBackdrop';
    if (!b.empty) { const m = new THREE.Mesh(b.build(), this.backMat); m.frustumCulled = false; this.backdrop.add(m); }
    if (b.leaves) {
      const material = createTreeMaterial(this.backMat);
      this.mats.push(material);
      this.backdrop.add(new THREE.Mesh(b.leaves.build(), material));
    }
    if (!g.empty) { const m = new THREE.Mesh(g.build(), this.backGlow); m.frustumCulled = false; m.renderOrder = 5; this.backdrop.add(m); }
    this.backdropArt = this.kit.decorateBackdrop?.(this.backdrop) || null;
    this.backdrop.rotation.y = -this.world.route.modules[0].a0;
    this.root.add(this.backdrop);
  }
  _underPlane() {
    const geo = new THREE.PlaneGeometry(2600, 2600, 1, 1).rotateX(-Math.PI / 2);
    const n = geo.attributes.position.count; geo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n * 3).fill(1), 3));
    geo.setAttribute('aMat', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
    const uv = geo.attributes.uv; for (let i = 0; i < n; i++) uv.setXY(i, geo.attributes.position.getX(i), 999);
    this.under = new THREE.Mesh(geo, this.floorMat); this.under.position.y = -0.35; this.under.frustumCulled = false; this.under.name = 'WorldUnder';
    this.root.add(this.under);
  }
  _anchors() {
    const b = new GeoBuilder();
    this.kit.anchorDevice ? this.kit.anchorDevice(b) : defaultAnchorDevice(b);
    this.anchorMesh = new THREE.InstancedMesh(b.build(), this.mat, MAX_ANCHORS); this.anchorMesh.count = 0; this.anchorMesh.frustumCulled = false; this.anchorMesh.name = 'AnchorDevices';
    const hb = new GeoBuilder(); hb.blob(0, 0, 0.2, 0.62, 1, { col: 0x1e7a8a, kind: 3, detail: 1, jitter: 0 });
    this.haloMesh = new THREE.InstancedMesh(hb.build(), this.glowMat, MAX_ANCHORS); this.haloMesh.count = 0; this.haloMesh.frustumCulled = false; this.haloMesh.renderOrder = 6;
    this.root.add(this.anchorMesh, this.haloMesh);
    this._anchorsDirty = true;
  }
  _refreshAnchors() {
    let n = 0;
    for (const v of this.visuals.values()) {
      if (!v.cell.ready) continue;
      for (const a of v.cell.anchors) {
        if (!a.valid || n >= MAX_ANCHORS) continue;
        const nr = a.normal; _v.set(nr[0], nr[1], nr[2]);
        _q.setFromUnitVectors(_z, _v.lengthSq() > 0.5 ? _v.normalize() : _up);
        _m.compose(a.p, _q, _s); this.anchorMesh.setMatrixAt(n, _m); this.haloMesh.setMatrixAt(n, _m); n++;
      }
    }
    this.anchorMesh.count = this.haloMesh.count = n;
    this.anchorMesh.instanceMatrix.needsUpdate = this.haloMesh.instanceMatrix.needsUpdate = true;
    this._anchorsDirty = false;
  }
  // ---------------------------------------------------------------- modules
  *_buildCell(cell) {
    const m = cell.m, map = this.map, kit = this.kit, rng = mulberry32((m.seed ^ 0x9e37) >>> 0 || 1);
    const ox = this.world.off[0], oz = this.world.off[1];
    const [gx, gz] = toWorld(m, 0, 0); // group origin = module start (keeps vertex floats small)
    const b = new GeoBuilder(), g = new GeoBuilder(), fb = new GeoBuilder();
    const ctx = { m, map, rng, K, glow: g, halfW: m.halfW, world: this.world };
    const local = (u, v) => { const [x, z] = toWorld(m, u, v); return [x - gx, z - gz]; };
    ctx.local = local;
    ctx.extras = this.extras?.beginCell?.(cell, b, gx, gz) || null; // (placements in route space: rebase-safe)
    for (const s of m.structures) {
      const [x, z] = local(s.u, s.v), yaw = -frameAt(m, s.u).a;
      b.pushTRS(x, 0, z, yaw); g.pushTRS(x, 0, z, yaw);
      ctx.side = s.side || 1; ctx.s = s;
      try { (kit[s.kind] || kit[s.role] || kit.structure)(b, s, ctx); } catch (e) { console.warn('kit', map.id, s.kind, e); }
      b.pop(); g.pop();
      yield;
    }
    kit.moduleDecor?.(b, ctx); yield;
    // floor ribbon (uv.x = route arc length → continuous flow, uv.y = metres across)
    const W = m.halfW + 46, n = Math.max(2, Math.ceil(m.L / 6));
    for (let k = 0; k < n; k++) {
      const u0 = (m.L * k) / n, u1 = (m.L * (k + 1)) / n;
      const a0 = local(u0, -W), b0 = local(u0, W), a1 = local(u1, -W), b1 = local(u1, W);
      const v0 = fb.vcount;
      fb.quad([a0[0], 0, a0[1]], [b0[0], 0, b0[1]], [b1[0], 0, b1[1]], [a1[0], 0, a1[1]], 0xffffff, 0, 0, [0, 0, 0, 0]);
      fb.setUV(v0, m.s0 + u0, -W); fb.setUV(v0 + 1, m.s0 + u0, W); fb.setUV(v0 + 2, m.s0 + u1, W); fb.setUV(v0 + 3, m.s0 + u1, -W); // (s, v)
    }
    const group = new THREE.Group(); group.name = `module-${m.idx}-${m.type}`; group.position.set(gx + ox, 0, gz + oz);
    const meshes = [];
    // a conservative bounding sphere from the module extents (no per-vertex pass), each mesh built in its own step
    const [mx, mz] = local(m.L / 2, 0), sph = new THREE.Sphere(new THREE.Vector3(mx, 60, mz), m.L / 2 + m.halfW + 120);
    if (!b.empty) { const mesh = new THREE.Mesh(b.build(sph), this.mat); mesh.name = 'arch'; meshes.push(mesh); yield; }
    if (b.leaves) {
      if (!this.leafMat) {
        this.leafMat = createTreeMaterial(this.mat);
        this.mats.push(this.leafMat);
      }
      const mesh = new THREE.Mesh(b.leaves.build(), this.leafMat);
      mesh.name = 'foliage';
      meshes.push(mesh);
      yield;
    }
    if (!g.empty) { const mesh = new THREE.Mesh(g.build(sph), this.glowMat); mesh.name = 'glow'; mesh.renderOrder = 8; meshes.push(mesh); yield; }
    { const mesh = new THREE.Mesh(fb.build(sph), this.floorMat); mesh.name = 'floor'; meshes.push(mesh); }
    for (const me of meshes) { group.add(me); me.matrixAutoUpdate = false; me.updateMatrix(); }
    // shift if a rebase happened while building
    group.position.x += this.world.off[0] - ox; group.position.z += this.world.off[1] - oz;
    this.root.add(group);
    const tris = meshes.reduce((t, me) => t + (me.geometry.index ? me.geometry.index.count / 3 : 0), 0);
    this.visuals.set(cell, { cell, group, meshes, tris });
    this.extras?.endCell?.(cell, ctx.extras);
    this.stats.tris += tris; this.stats.built++;
    this.world.markReady(cell);
    this._anchorsDirty = true;
    this.app?.worldChase?.onCellReady?.(cell);
  }
  _release(cell) {
    this.jobs = this.jobs.filter((j) => j.cell !== cell);
    this.extras?.releaseCell?.(cell);
    const v = this.visuals.get(cell); if (!v) return;
    this.root.remove(v.group);
    for (const me of v.meshes) me.geometry.dispose();
    this.stats.tris -= v.tris;
    this.visuals.delete(cell); this._anchorsDirty = true;
    this.app?.worldChase?.onCellRemoved?.(cell);
  }
  /** Build pending module visuals within the budget (ms). budget ≥ 1e6 → everything now (loading screen). */
  pump(budget = 2.5) {
    const t0 = performance.now(); let n = 0;
    this._est = this._est ?? 0.6; // running estimate of one build step (ms): never start a step that would overrun the slice
    while (this.jobs.length && (n === 0 || performance.now() - t0 + this._est < budget)) {
      const j = this.jobs[0], s0 = performance.now();
      const r = j.gen.next();
      const d = performance.now() - s0; this._est = this._est * 0.85 + d * 0.15; n++;
      if (r.done) this.jobs.shift();
    }
    const ms = performance.now() - t0; this.stats.buildMs = ms; this.stats.maxBuildMs = Math.max(this.stats.maxBuildMs, ms); this.stats.queue = this.jobs.length;
    if (this._anchorsDirty) this._refreshAnchors();
  }
  get pending() { return this.jobs.length; }
  /** cam: camera world position; view (optional): the rendering camera, for kits whose extras select by view (forest). */
  update(dt, cam, view = null) {
    this.time += dt;
    const t = this.time;
    for (const mt of this.mats) if (mt.uniforms?.uTime) mt.uniforms.uTime.value = t;
    this.sky.position.copy(cam);
    this.backdrop.position.set(cam.x, 0, cam.z);
    this.under.position.x = Math.round(cam.x / 50) * 50; this.under.position.z = Math.round(cam.z / 50) * 50;
    this.particles.material.uniforms.uCam.value.copy(cam);
    this.kit.animate?.(this, dt, t, cam);
    this.extras?.update?.(cam, view);
  }
  dispose() {
    this.off?.();
    this.backdropArt?.dispose(); this.backdropArt = null;
    for (const v of this.visuals.values()) { for (const me of v.meshes) me.geometry.dispose(); }
    this.visuals.clear(); this.jobs = [];
    this.extras?.dispose?.(); this.extras = null; // (first: its pools share cached geometry the traverse below must not dispose)
    this.root.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    for (const m of this.mats) m.dispose();
    this.anchorMesh.dispose?.(); this.haloMesh.dispose?.();
    this.kit.disposeExtras?.(this);
    this.root.parent?.remove(this.root);
  }
}

/** The swing-anchor device seen in every concept: dark mount plate, three arms, a bright cyan ring + core (faces +z). */
export function defaultAnchorDevice(b, { dark = 0x25282e, ring = 0x7ef0ff, core = 0xeaffff } = {}) {
  b.pushTRS(0, 0, 0, 0, 1, 1, 1, Math.PI / 2); // build along +y, rotated so +y → +z (the facing direction)
  b.cyl(0, -0.36, 0, 0.74, 0.64, 0.3, 14, { col: dark, kind: K.METAL });
  for (const a of [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3]) {
    b.pushTRS(0, 0, 0, a);
    b.box(0, -0.34, 0.98, 0.3, 0.24, 0.9, { col: dark, kind: K.METAL });
    b.box(0, -0.12, 1.36, 0.16, 0.08, 0.16, { col: ring, kind: K.EMIS });
    b.pop();
  }
  b.cyl(0, -0.08, 0, 0.56, 0.56, 0.1, 18, { col: 0x10161c, kind: K.PLAIN });
  b.cyl(0, 0.0, 0, 0.5, 0.42, 0.08, 18, { col: ring, kind: K.EMIS });
  b.cyl(0, 0.06, 0, 0.3, 0.22, 0.12, 14, { col: 0x1a2a30, kind: K.METAL });
  b.cyl(0, 0.16, 0, 0.18, 0.1, 0.06, 12, { col: core, kind: K.EMIS });
  b.pop();
}
