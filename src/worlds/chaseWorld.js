// World Chase streaming world (v0.40): which route modules exist right now, their colliders and swing anchors
// (spatial hashes), the route centre line (progress / pointAt), checkpoints, pins and the floating origin.
// Implements the same physics / anchor API as the Dala City world (src/data/cityWorld.js), so the existing
// Locomotion (swinging, wall run, cling, landing, markers) runs on it unchanged: app.locomotion.world = this.
//
// Kept around the player: modules [current − behind, current + ahead] (ahead grows with speed) and pinned modules
// (Green Maniac, the active checkpoint). A module is never recycled while the player is within keepRadius of its
// centre line, while a web is attached to one of its anchors, or while it is pinned. Recycling removes its colliders
// and anchors from the indexes and invalidates the anchor records (a.valid = false). The renderer listens to
// cellAdded / cellRemoved / rebased and marks a cell `ready` once its visuals are built; anchors of a cell are only
// selectable when ready (the same contract as the city).
import * as THREE from 'three';
import { RouteGen, toWorld, frameAt, pathY, ROUTE_CFG } from './route.js';
import { segBoxT, insideBox, worldToBox } from '../data/box.js';

export const WORLD_CFG = {
  aheadMin: 4, aheadMax: 8, aheadSeconds: 7, behind: 2,
  keepRadius: 110, // m: never recycle a module whose centre line is this close to the player
  createPerFrame: 1, rebaseDist: 1500, pathStep: 4,
  outLateral: 34, // m beyond the corridor half width before the soft pull back
  outGrace: 6, // s outside → quiet recovery
};

class SpatialHash {
  constructor(cell = 24) { this.cell = cell; this.map = new Map(); this.stamp = 0; }
  _k(ix, iz) { return ix * 73856093 ^ iz * 19349663; }
  insert(it, x0, z0, x1, z1) {
    const c = this.cell, keys = [];
    for (let ix = Math.floor(x0 / c); ix <= Math.floor(x1 / c); ix++) for (let iz = Math.floor(z0 / c); iz <= Math.floor(z1 / c); iz++) {
      const k = this._k(ix, iz); let a = this.map.get(k); if (!a) this.map.set(k, a = []); a.push(it); keys.push(k);
    }
    it._hk = keys;
  }
  remove(it) {
    for (const k of it._hk || []) { const a = this.map.get(k); if (!a) continue; const i = a.indexOf(it); if (i >= 0) { a[i] = a[a.length - 1]; a.pop(); } if (!a.length) this.map.delete(k); }
    it._hk = null;
  }
  rect(x0, z0, x1, z1, fn) {
    const c = this.cell, st = ++this.stamp;
    for (let ix = Math.floor(x0 / c); ix <= Math.floor(x1 / c); ix++) for (let iz = Math.floor(z0 / c); iz <= Math.floor(z1 / c); iz++) {
      const a = this.map.get(this._k(ix, iz)); if (!a) continue;
      for (let n = 0; n < a.length; n++) { const it = a[n]; if (it._st === st) continue; it._st = st; if (fn(it)) return true; }
    }
    return false;
  }
  clear() { this.map.clear(); }
}
function aabbOf(c) { const ex = Math.abs(c.cos) * c.hw + Math.abs(c.sin) * c.hd, ez = Math.abs(c.sin) * c.hw + Math.abs(c.cos) * c.hd; return [c.x - ex, c.z - ez, c.x + ex, c.z + ez]; }

export class ChaseWorld {
  constructor(map, { seed = 20261103, autoReady = false, cfg = WORLD_CFG } = {}) {
    this.map = map; this.cfg = cfg; this.autoReady = autoReady; this.seed = seed;
    this.listeners = new Set();
    this.reset();
  }
  reset({ seed = this.seed } = {}) {
    for (const c of this.live?.values() || []) this._emit('cellRemoved', c);
    this.seed = seed;
    this.route = new RouteGen(this.map, seed);
    this.live = new Map(); this.cols = new SpatialHash(24); this.anch = new SpatialHash(24); this.colById = new Map();
    this.off = [0, 0]; // route space → world space (floating origin)
    this.pins = new Map(); this.attachedAll = []; this.attached = null;
    this.cur = 0; this.ahead = this.cfg.aheadMin; this._hintS = 0; this.time = 0; this.lateral = 0;
    this.stats = { cells: 0, anchors: 0, colliders: 0, created: 0, recycled: 0, createMs: 0, maxCreateMs: 0, recycleMs: 0, maxRecycleMs: 0, rebases: 0, missing: 0 };
    this.route.ensure(this.cfg.aheadMax + 2);
  }
  on(l) { this.listeners.add(l); return () => this.listeners.delete(l); }
  _emit(ev, ...a) { for (const l of this.listeners) l[ev]?.(...a); }
  get halfW() { return this.map.gen.halfW; }
  /** Locomotion API compatibility (`world.cells.size`). */
  get cells() { return this.live; }
  get modules() { return this.route.modules; }

  // ------------------------------------------------------------ module instantiation
  _w(m, u, v) { const p = toWorld(m, u, v); p[0] += this.off[0]; p[1] += this.off[1]; return p; }
  _create(idx) {
    const t0 = performance.now();
    const m = this.route.ensure(idx)[idx];
    const cell = { key: idx, idx, m, ready: this.autoReady, colliders: [], anchors: [], coins: [], checkpoints: [], structures: new Map(), pts: [], cum: [], s0: m.s0, s1: m.s1, born: this.time };
    for (const s of m.structures) {
      const ws = { s, cols: [] };
      s.tiers.forEach((t, k) => {
        const uc = s.u + (t.du || 0), f = frameAt(m, uc), yaw = -f.a;
        const [x, z] = this._w(m, uc, s.v + (t.dv || 0));
        const c = { id: s.id, x, z, yaw, cos: Math.cos(yaw), sin: Math.sin(yaw), hw: t.d / 2, hd: t.w / 2, y0: t.y0, y1: t.y1, base: k === 0, cell, s, role: s.role };
        cell.colliders.push(c); ws.cols.push(c); const [x0, z0, x1, z1] = aabbOf(c); this.cols.insert(c, x0, z0, x1, z1);
        if (k === 0) this.colById.set(s.id, c);
      });
      cell.structures.set(s.id, ws);
    }
    for (const a of m.anchors) {
      const [x, z] = this._w(m, a.u, a.v), f = frameAt(m, a.u);
      const nx = -Math.cos(f.a) * Math.sign(a.v || 0), nz = -Math.sin(f.a) * Math.sign(a.v || 0); // facing the corridor (0 for undersides)
      const w = { id: a.id, building: a.sid, kind: a.kind, p: new THREE.Vector3(x, a.y, z), pos: [x, a.y, z], normal: a.side ? [nx, 0, nz] : [0, -1, 0], cell, valid: true, s: m.s0 + a.u, low: !!a.low, src: a };
      cell.anchors.push(w); this.anch.insert(w, x, z, x, z);
    }
    for (const c of m.coins) { const [x, z] = this._w(m, c.u, c.v); cell.coins.push({ id: c.id, pos: new THREE.Vector3(x, c.y, z), s: m.s0 + c.u, tag: c.tag }); }
    for (const c of m.checkpoints) { const [x, z] = this._w(m, c.u, c.v), f = frameAt(m, c.u); cell.checkpoints.push({ ...c, pos: [x, c.y, z], s: m.s0 + c.u, yaw: -f.a }); }
    const st = this.cfg.pathStep, n = Math.max(2, Math.ceil(m.L / st));
    for (let k = 0; k <= n; k++) { const u = (m.L * k) / n, [x, z] = this._w(m, u, 0); cell.pts.push([x, pathY(m, u), z]); cell.cum.push(m.s0 + u); }
    this.live.set(idx, cell);
    this.stats.created++;
    const ms = performance.now() - t0; this.stats.createMs = ms; this.stats.maxCreateMs = Math.max(this.stats.maxCreateMs, ms);
    this._emit('cellAdded', cell);
    return cell;
  }
  _remove(cell) {
    const t0 = performance.now();
    for (const c of cell.colliders) { this.cols.remove(c); if (this.colById.get(c.id) === c) this.colById.delete(c.id); }
    for (const a of cell.anchors) { this.anch.remove(a); a.valid = false; }
    this.live.delete(cell.idx);
    this._emit('cellRemoved', cell);
    cell.colliders = []; cell.anchors = []; cell.structures.clear();
    this.stats.recycled++;
    const ms = performance.now() - t0; this.stats.recycleMs = ms; this.stats.maxRecycleMs = Math.max(this.stats.maxRecycleMs, ms);
  }
  markReady(cell) { if (this.live.get(cell.idx) === cell) cell.ready = true; }

  // ------------------------------------------------------------ route centre line
  /** Ordered live cells. */
  _ordered() { return [...this.live.values()].sort((a, b) => a.idx - b.idx); }
  /** Point on the route at arc length s (x, y = flight height, z), in world space. Works for any generated module. */
  pointAt(s, out = new THREE.Vector3()) {
    const M = this.route.modules; if (!M.length) return out.set(0, 0, 0);
    let m = M.find((x) => s <= x.s1) || M.at(-1); if (s < 0) m = M[0];
    const u = Math.max(0, Math.min(m.L, s - m.s0)), [x, z] = this._w(m, u, 0);
    return out.set(x, pathY(m, u), z);
  }
  /** Heading (rad, forward = (sin a, −cos a)) at arc length s. */
  headingAt(s) { const M = this.route.modules; const m = M.find((x) => s <= x.s1) || M.at(-1); return frameAt(m, Math.max(0, Math.min(m.L, s - m.s0))).a; }
  moduleAtS(s) { const M = this.route.modules; return M.find((x) => s <= x.s1) || M.at(-1); }
  /** Project xz onto the live centre line near the hint (continuity) → { s, dist, idx, y }. */
  progress(x, z, hintS = this._hintS) {
    let best = null;
    for (const c of this.live.values()) {
      if (c.s1 < hintS - 260 || c.s0 > hintS + 320) continue;
      const P = c.pts;
      for (let k = 1; k < P.length; k++) {
        const a = P[k - 1], b = P[k], dx = b[0] - a[0], dz = b[2] - a[2], L2 = dx * dx + dz * dz || 1;
        const u = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[2]) * dz) / L2));
        const px = a[0] + dx * u, pz = a[2] + dz * u, d = Math.hypot(x - px, z - pz), s = c.cum[k - 1] + (c.cum[k] - c.cum[k - 1]) * u;
        const score = d + 0.35 * Math.max(0, Math.abs(s - hintS) - 30);
        if (!best || score < best.score) best = { s, dist: d, idx: c.idx, y: a[1] + (b[1] - a[1]) * u, score };
      }
    }
    return best || { s: hintS, dist: 1e9, idx: this.cur, y: 0 };
  }
  cellAt(x, z) { const pr = this.progress(x, z); if (pr.dist > this.halfW + this.cfg.outLateral) return null; return this.live.get(pr.idx) || null; }

  // ------------------------------------------------------------ streaming
  pin(name, idx) { if (idx == null) this.pins.delete(name); else this.pins.set(name, idx); }
  setAttached(a) { const l = Array.isArray(a) ? a.filter(Boolean) : a ? [a] : []; this.attachedAll = l; this.attached = l.at(-1) || null; }
  /** Streaming step (pos / vel: player feet + velocity). force: create everything now (behind the loading screen). */
  update(pos, vel = { x: 0, y: 0, z: 0 }, dt = 1 / 60, { force = false } = {}) {
    this.time += dt;
    const C = this.cfg;
    if (!this.live.size) this._create(0);
    const pr = this.progress(pos.x, pos.z); this._hintS = pr.s; this.lateral = pr.dist;
    this.cur = Math.max(0, pr.idx);
    const sp = Math.hypot(vel.x, vel.y, vel.z);
    this.ahead = Math.max(C.aheadMin, Math.min(C.aheadMax, Math.ceil((sp * C.aheadSeconds) / 70) + C.aheadMin - 1));
    const lo = Math.max(0, this.cur - C.behind), hi = this.cur + this.ahead;
    this.route.ensure(hi + 2);
    const want = new Set(); for (let k = lo; k <= hi; k++) want.add(k);
    for (const idx of this.pins.values()) if (idx != null && idx >= 0) want.add(idx);
    const missing = [...want].filter((k) => !this.live.has(k)).sort((a, b) => Math.abs(a - this.cur) - Math.abs(b - this.cur));
    const n = force ? missing.length : Math.min(missing.length, C.createPerFrame);
    for (let q = 0; q < n; q++) this._create(missing[q]);
    for (const c of [...this.live.values()]) { if (want.has(c.idx) || this._protected(c, pos)) continue; this._remove(c); }
    const st = this.stats; st.cells = this.live.size; st.anchors = 0; st.colliders = 0; st.missing = missing.length - n;
    for (const c of this.live.values()) { st.anchors += c.anchors.length; st.colliders += c.colliders.length; }
    this._maybeRebase(pos);
    return missing.length - n;
  }
  _protected(c, pos) {
    if (this.attachedAll.some((a) => a.cell === c && a.valid)) return true;
    for (const idx of this.pins.values()) if (idx === c.idx) return true;
    for (const p of c.pts) if (Math.hypot(p[0] - pos.x, p[2] - pos.z) < this.cfg.keepRadius) return true;
    return false;
  }
  pendingNear(p, range = 220) { let n = 0; for (const c of this.live.values()) if (!c.ready && c.pts.some((q) => Math.hypot(q[0] - p.x, q[2] - p.z) < range)) n++; return n + (this.stats.missing || 0); }
  /** Speed cap (m/s) when the player is about to reach a module that is not built yet (never enter emptiness). */
  speedCapAt(pos) {
    const cur = this.live.get(this.cur), next = this.live.get(this.cur + 1);
    if (!cur || !cur.ready) return 3;
    if (!next || !next.ready) { const e = cur.pts.at(-1); if (Math.hypot(e[0] - pos.x, e[2] - pos.z) < 40) return 5; }
    return Infinity;
  }
  inCorridor(x, y, z) { const pr = this.progress(x, z); return pr.dist < this.halfW + this.cfg.outLateral && y < 200; }
  /** Locomotion hook (replaces the city corridor): soft pull back toward the route, quiet recovery after outGrace. */
  customBounds(loco, f, dt) {
    const pr = this.progress(f.x, f.z), c = this.live.get(pr.idx);
    if (pr.dist < this.halfW + this.cfg.outLateral && c && c.ready && pr.s > 2) { loco._out = 0; return; }
    loco._out += dt;
    const p = this.pointAt(Math.max(6, pr.s));
    const dx = p.x - f.x, dz = p.z - f.z, d = Math.hypot(dx, dz);
    if (d > 1e-3) {
      const nx = dx / d, nz = dz / d, outward = -(loco.vel.x * nx + loco.vel.z * nz);
      if (outward > 0) { const k = outward * Math.min(1, dt * 6); loco.vel.x += nx * k; loco.vel.z += nz * k; }
      loco.vel.x += nx * 9 * dt; loco.vel.z += nz * 9 * dt;
    }
    if (loco._out > this.cfg.outGrace) { loco._out = 0; loco.detach(true); if (loco.onOutOfBounds?.() !== true) loco.placeAt(loco.safePoint); }
  }
  /** The latest built checkpoint at or before arc length s (never on a recycled module). */
  checkpointBefore(s) {
    let best = null;
    for (const c of this.live.values()) { if (!c.ready) continue; for (const cp of c.checkpoints) if (cp.s <= s + 2 && (!best || cp.s > best.s)) best = cp; }
    return best;
  }
  checkpointFor(idx) { const c = this.live.get(idx); return c && c.ready ? c.checkpoints[0] || null : null; }
  tileCell(idx) { return this.live.get(idx) || null; }
  /** Furthest arc length whose modules are built, scanning forward from s. */
  readyUntil(s) {
    let lim = s;
    for (const c of this._ordered()) { if (c.s1 < s) continue; if (!c.ready) break; lim = c.s1; }
    return lim;
  }

  // ------------------------------------------------------------ physics / anchor queries (locomotion API)
  collidersNear(x, z, rad, out = []) { out.length = 0; this.cols.rect(x - rad, z - rad, x + rad, z + rad, (c) => { out.push(c); }); return out; }
  anchorsNear(x, z, rad, out = []) { out.length = 0; this.anch.rect(x - rad, z - rad, x + rad, z + rad, (a) => { if (a.valid && a.cell.ready) out.push(a); }); return out; }
  colliderOf(id) { return this.colById.get(id) || null; }
  building(id) { return this.colById.get(id) || null; }
  pointBlocked(x, y, z, pad = 0) { return this.cols.rect(x - pad, z - pad, x + pad, z + pad, (c) => insideBox(c, x, y, z, pad)); }
  segmentBlocked(ax, ay, az, bx, by, bz, ownId = null, ignore = null, endTrim = 0.5) {
    const L = Math.hypot(bx - ax, by - ay, bz - az); if (L < 1e-6) return false;
    const tEnd = Math.max(0, 1 - endTrim / L);
    return this.cols.rect(Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz), (c) => {
      if (ignore && ignore.has(c.id)) return false;
      if (insideBox(c, ax, ay, az)) return false;
      const t0 = segBoxT(c, ax, ay, az, bx, by, bz, tEnd); if (t0 < 0) return false;
      if (ownId && c.id === ownId) {
        const hx = ax + (bx - ax) * t0, hy = ay + (by - ay) * t0, hz = az + (bz - az) * t0;
        if (Math.hypot(hx - bx, hy - by, hz - bz) < 3.5) return false;
        if (hy > c.y1 - 3) return false;
      }
      return true;
    });
  }
  get activeAnchors() { const out = []; for (const c of this.live.values()) if (c.ready) for (const a of c.anchors) if (a.valid) out.push(a); return out; }

  // ------------------------------------------------------------ floating origin
  _maybeRebase(pos) {
    const R = this.cfg.rebaseDist;
    if (Math.abs(pos.x) < R && Math.abs(pos.z) < R) return;
    if (this.attached && Math.abs(pos.x) < R * 2 && Math.abs(pos.z) < R * 2) return; // a calm moment (not on a web)
    this.rebase(-Math.round(pos.x), -Math.round(pos.z));
  }
  /** Shift every world-space record by (dx, 0, dz); listeners (renderer, game) shift theirs. */
  rebase(dx, dz) {
    if (!dx && !dz) return;
    this.off[0] += dx; this.off[1] += dz;
    this.cols.clear(); this.anch.clear();
    for (const c of this.live.values()) {
      for (const k of c.colliders) { k.x += dx; k.z += dz; const [x0, z0, x1, z1] = aabbOf(k); this.cols.insert(k, x0, z0, x1, z1); }
      for (const a of c.anchors) { a.pos[0] += dx; a.pos[2] += dz; a.p.x += dx; a.p.z += dz; this.anch.insert(a, a.pos[0], a.pos[2], a.pos[0], a.pos[2]); }
      for (const p of c.pts) { p[0] += dx; p[2] += dz; }
      for (const k of c.coins) { k.pos.x += dx; k.pos.z += dz; }
      for (const k of c.checkpoints) { k.pos[0] += dx; k.pos[2] += dz; }
    }
    this.stats.rebases++;
    this._emit('rebased', dx, dz);
  }
}
export { worldToBox, ROUTE_CFG };
