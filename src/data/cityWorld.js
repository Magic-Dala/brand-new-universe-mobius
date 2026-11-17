// Dala City streaming world (街區串流與回收) — which modules exist right now, their colliders and swing
// anchors (spatial index), the route centre line, checkpoints and origin rebasing. No rendering here:
// the renderer (src/art/city.js) listens to cell added / removed / role changed / rebased events and
// marks a cell `ready` once its visuals are built; anchors of a cell are only selectable when ready.
//
// Kept around the player: route tiles [current − behindTiles, current + ahead] (ahead grows with speed:
// speed × aheadSeconds), crossroads candidates, pinned tiles (Green Maniac, story events) and one ring
// of side blocks (fillers) around all of them. A cell is never recycled while the player is within
// keepRadius of it, while a web is attached to one of its anchors, or while it is pinned. Recycling
// removes its colliders and anchors from the index and invalidates the anchor records (a.valid = false).
import * as THREE from 'three';
import { CITY_CFG } from './cityConfig.js';
import { MODULES, STEP, transformOf, toWorldXZ, dirToWorld, moduleContent, modulePath } from './blocks.js';
import { RouteGen, EXIT_TILE, FACTORY_TILE } from './route.js';
import { worldToBox, segBoxT, insideBox, hashInt } from './box.js';

const S = CITY_CFG.cell, HALF = S / 2, SL = CITY_CFG.street / 2;
const ckey = (i, j) => `${i},${j}`;
const NEI = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];

/** Uniform spatial hash (xz) with removal. Items are inserted over their AABB. */
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
  get size() { let n = 0; for (const a of this.map.values()) n += a.length; return n; } // bucket entries
  get count() { const u = new Set(); for (const a of this.map.values()) for (const it of a) u.add(it); return u.size; } // distinct items (tests)
}

function aabbOf(c) { // rotations are multiples of 90°
  const ex = Math.abs(c.cos) * c.hw + Math.abs(c.sin) * c.hd, ez = Math.abs(c.sin) * c.hw + Math.abs(c.cos) * c.hd;
  return [c.x - ex, c.z - ez, c.x + ex, c.z + ez];
}

export class CityWorld {
  constructor({ cfg = CITY_CFG, autoReady = false } = {}) {
    this.cfg = cfg; this.autoReady = autoReady;
    this.listeners = new Set();
    this.contentCache = new Map();
    this.reset();
  }
  /** New run (story or endless continuation keeps the same route object). */
  reset({ seed = this.cfg.seed, mode = 'story' } = {}) {
    for (const c of this.cells?.values() || []) this._emit('cellRemoved', c);
    this.route = new RouteGen({ seed, storySeed: this.cfg.storySeed });
    this.mode = mode; // 'story' (route capped behind the factory exit) | 'endless'
    this.cells = new Map(); this.cols = new SpatialHash(24); this.anch = new SpatialHash(24);
    this.colById = new Map(); this.byBuilding = new Map();
    this.oi = 0; this.oj = 0; // origin cell (rebasing)
    this.paths = []; // [{ idx, pts:[[x,y,z]], cum:[s], s0, s1 }] committed route tiles (window)
    this.pins = new Map(); this.attached = null;
    this.curTile = 0; this.aheadTiles = this.cfg.aheadMinTiles; this.time = 0; this._hintS = 0;
    this.stats = { cells: 0, route: 0, filler: 0, cand: 0, anchors: 0, colliders: 0, created: 0, recycled: 0, createMs: 0, maxCreateMs: 0, recycleMs: 0, maxRecycleMs: 0, conflicts: 0, rebases: 0, lingering: 0 };
    this.rebaseOffset = [0, 0];
    this._ensurePaths();
  }
  on(l) { this.listeners.add(l); return () => this.listeners.delete(l); }
  _emit(ev, ...a) { for (const l of this.listeners) l[ev]?.(...a); }

  // ------------------------------------------------------------ grid
  cellCenter(i, j) { return [(i - this.oi) * S, this.cfg.originZ + (j - this.oj) * S]; }
  cellOf(x, z) { return [Math.round(x / S) + this.oi, Math.round((z - this.cfg.originZ) / S) + this.oj]; }
  cellAt(x, z) { const [i, j] = this.cellOf(x, z); return this.cells.get(ckey(i, j)) || null; }
  tileTransform(t) { const [cx, cz] = this.cellCenter(t.cell[0], t.cell[1]); return transformOf(cx, cz, t.heading); }
  distToCell(i, j, x, z) { const [cx, cz] = this.cellCenter(i, j); const dx = Math.max(0, Math.abs(x - cx) - HALF), dz = Math.max(0, Math.abs(z - cz) - HALF); return Math.hypot(dx, dz); }

  // ------------------------------------------------------------ route path (window of committed tiles)
  _ensurePaths() {
    const tiles = this.route.tiles;
    let last = this.paths.at(-1);
    for (let i = last ? last.idx + 1 : 0; i < tiles.length; i++) {
      const t = tiles[i]; if (!t.exit) break; // unresolved crossroads: no committed path yet
      const T = this.tileTransform(t), lp = modulePath(t.kind, t.exit, t.fly);
      const pts = lp.map(([x, y, z]) => { const [wx, wz] = toWorldXZ(T, x, z); return [wx, y, wz]; });
      const s0 = last ? last.s1 : 0, cum = [s0];
      if (last) { const a = last.pts.at(-1), b = pts[0]; const gap = Math.hypot(b[0] - a[0], b[2] - a[2]); cum[0] = s0 + gap; } // start / factory exit gaps
      for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][2] - pts[k - 1][2]));
      last = { idx: i, pts, cum, s0: cum[0], s1: cum.at(-1) }; this.paths.push(last); t.s0 = last.s0; t.s1 = last.s1;
    }
    while (this.paths.length > 40 && this.paths[0].idx < this.curTile - 14) this.paths.shift();
  }
  pathOf(idx) { const p0 = this.paths[0]; if (!p0) return null; const p = this.paths[idx - p0.idx]; return p && p.idx === idx ? p : null; }
  /** Point on the committed route at arc length s (x, y = flight height, z). */
  pointAt(s, out = new THREE.Vector3()) {
    const P = this.paths; if (!P.length) return out.set(0, 0, 0);
    let e = P.find((p) => s <= p.s1) || P.at(-1); if (s < P[0].s0) e = P[0];
    const S2 = Math.max(e.s0, Math.min(e.s1, s));
    for (let k = 1; k < e.pts.length; k++) {
      if (S2 <= e.cum[k] || k === e.pts.length - 1) {
        const a = e.pts[k - 1], b = e.pts[k], L = e.cum[k] - e.cum[k - 1], u = L > 1e-6 ? (S2 - e.cum[k - 1]) / L : 0;
        return out.set(a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u);
      }
    }
    return out;
  }
  /** Project xz onto the route near the hint (continuity), → { s, dist, tile, y }. */
  progress(x, z, hintS = this._hintS) {
    let best = null;
    for (const e of this.paths) {
      if (e.s1 < hintS - 260 || e.s0 > hintS + 320) continue;
      for (let k = 1; k < e.pts.length; k++) {
        const a = e.pts[k - 1], b = e.pts[k], dx = b[0] - a[0], dz = b[2] - a[2], L2 = dx * dx + dz * dz || 1;
        const u = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[2]) * dz) / L2));
        const px = a[0] + dx * u, pz = a[2] + dz * u, d = Math.hypot(x - px, z - pz), s = e.cum[k - 1] + (e.cum[k] - e.cum[k - 1]) * u;
        const score = d + 0.35 * Math.max(0, Math.abs(s - hintS) - 30);
        if (!best || score < best.score) best = { s, dist: d, tile: e.idx, y: a[1] + (b[1] - a[1]) * u, score };
      }
    }
    return best || { s: 0, dist: 1e9, tile: 0, y: 0 };
  }

  // ------------------------------------------------------------ content
  _ckey(def, tag) { return `${def.kind}|${def.variant}|${def.seed}|${def.fly?.in}|${def.fly?.out}|${def.minH}|${def.maxH}|${tag}`; }
  _content(def, tag) {
    const k = this._ckey(def, tag);
    let c = this.contentCache.get(k);
    if (!c) {
      c = moduleContent({ kind: def.kind, variant: def.variant, seed: def.seed, flyIn: def.fly?.in, flyOut: def.fly?.out, minH: def.minH, maxH: def.maxH, tag });
      this.contentCache.set(k, c);
      if (this.contentCache.size > 700) this.contentCache.delete(this.contentCache.keys().next().value);
    }
    return c;
  }
  fillerDef(i, j) { const h = hashInt(this.cfg.seed ^ 0x5f11, i * 92821 + j * 689287); return { kind: 'filler', variant: (h >>> 3) & 3, seed: h >>> 0, heading: (h >>> 7) & 3, fly: { in: 40, out: 40 } }; }
  /**
   * Layout of any grid cell (active or not) for the low-detail backdrop: { content, T, role, generated }.
   * allowGenerate = false → null when the layout is not cached yet (callers spread the work over frames).
   */
  layoutAt(i, j, allowGenerate = true) {
    const c = this.cells.get(ckey(i, j)); if (c) return c;
    const t = this._reserved?.get(ckey(i, j));
    const def = t || this.fillerDef(i, j), tag = t ? t.tag : `f${i}_${j}`;
    const k = this._ckey(def, tag), had = this.contentCache.has(k);
    if (!had && !allowGenerate) return null;
    const content = this._content(def, tag);
    if (t) return { content, T: this.tileTransform(t), role: 'route', generated: !had };
    const [cx, cz] = this.cellCenter(i, j);
    return { content, T: transformOf(cx, cz, def.heading), role: 'filler', generated: !had };
  }

  _createCell(i, j, role, tile) {
    const t0 = performance.now();
    const def = tile || this.fillerDef(i, j);
    const tag = tile ? tile.tag : `f${i}_${j}`;
    const content = this._content(def, tag);
    const T = tile ? this.tileTransform(tile) : transformOf(...this.cellCenter(i, j), def.heading);
    const cell = { key: ckey(i, j), i, j, role, tile: tile || null, kind: def.kind, content, T, ready: this.autoReady, visual: null, buildings: [], colliders: [], anchors: [], born: this.time };
    // buildings + colliders (one box per tier)
    for (const b of content.buildings) {
      const [x, z] = toWorldXZ(T, b.lx, b.lz);
      const wb = { ...b, x, z, yaw: T.yaw, cos: T.cos, sin: T.sin, hw: b.hx, hd: b.hz, y0: 0, y1: b.h, cell, faces: b.faces };
      cell.buildings.push(wb);
      b.tiers.forEach((tr, k) => {
        const c = { id: b.id, x, z, yaw: T.yaw, cos: T.cos, sin: T.sin, hw: tr.hx, hd: tr.hz, y0: tr.y0, y1: tr.y1, b: wb, base: k === 0, deck: 'L', cell };
        cell.colliders.push(c); const [x0, z0, x1, z1] = aabbOf(c); this.cols.insert(c, x0, z0, x1, z1);
        if (k === 0 && !this.colById.has(b.id)) this.colById.set(b.id, c);
      });
      this.byBuilding.set(b.id, wb);
    }
    for (const a of content.anchors) {
      const [x, z] = toWorldXZ(T, a.lp[0], a.lp[2]), [nx, nz] = dirToWorld(T, a.ln[0], a.ln[2]);
      const w = { id: a.id, building: a.building, kind: a.kind, pos: [x, a.lp[1], z], normal: [nx, a.ln[1], nz], p: new THREE.Vector3(x, a.lp[1], z), cell, valid: true, deck: 'L' };
      cell.anchors.push(w); this.anch.insert(w, x, z, x, z);
    }
    // route data in world space
    const W = (p) => { const [x, z] = toWorldXZ(T, p[0], p[2]); return [x, p[1], z]; };
    cell.mounts = {};
    for (const [k, v] of Object.entries(content.mounts)) cell.mounts[k] = Array.isArray(v[0]) ? v.map(W) : W(v);
    const cp = content.checkpoint;
    if (cp) {
      if (cp.kind === 'factoryRoof') { const C = cell.buildings.find((b) => b.id === 'C'); const [x, z] = toWorldXZ(T, C.lx - 3, C.lz - 8); cell.checkpoint = { kind: 'roof', pos: [x, C.h, z], normal: [0, 1, 0], building: 'C' }; }
      else { const [nx, nz] = dirToWorld(T, cp.ln[0], cp.ln[2]); cell.checkpoint = { kind: cp.kind, pos: W(cp.lp), normal: [nx, 0, nz], building: cp.building || null }; }
    }
    this.cells.set(cell.key, cell);
    this.stats.created++;
    const ms = performance.now() - t0; this.stats.createMs = ms; this.stats.maxCreateMs = Math.max(this.stats.maxCreateMs, ms);
    this._emit('cellAdded', cell);
    return cell;
  }
  _removeCell(cell) {
    const t0 = performance.now();
    for (const c of cell.colliders) { this.cols.remove(c); if (this.colById.get(c.id) === c) this.colById.delete(c.id); }
    for (const a of cell.anchors) { this.anch.remove(a); a.valid = false; }
    for (const b of cell.buildings) if (this.byBuilding.get(b.id) === b) this.byBuilding.delete(b.id);
    this.cells.delete(cell.key);
    this._emit('cellRemoved', cell);
    cell.colliders = []; cell.anchors = []; cell.buildings = [];
    this.stats.recycled++;
    const ms = performance.now() - t0; this.stats.recycleMs = ms; this.stats.maxRecycleMs = Math.max(this.stats.maxRecycleMs, ms);
  }
  markReady(cell) { if (this.cells.get(cell.key) === cell) cell.ready = true; }

  // ------------------------------------------------------------ streaming
  /** Pins keep a route tile (and its side blocks) alive: Green Maniac's tile, story event tiles. */
  pin(name, idx) { if (idx == null) this.pins.delete(name); else this.pins.set(name, idx); }
  setAttached(a) { const l = Array.isArray(a) ? a.filter(Boolean) : a ? [a] : []; this.attachedAll = l; this.attached = l.at(-1) || null; } // v0.24: up to two webs
  /** Current route tile (cell containment first, then projection). */
  _currentTile(pos) {
    const c = this.cellAt(pos.x, pos.z);
    if (c && c.role === 'route' && c.tile) return c.tile.idx;
    const pr = this.progress(pos.x, pos.z); return pr.tile;
  }
  _checkCommit(pos) {
    const p = this.route.pending; if (!p) return;
    const c = this.cellAt(pos.x, pos.z);
    const T = this.tileTransform(p), [lx, lz] = worldToBox({ x: T.cx, z: T.cz, cos: T.cos, sin: T.sin }, pos.x, pos.z);
    const d = this.cfg.endless.commitDist;
    let exit = null;
    if (c && c.key === ckey(...p.cell)) { if (lz < -d && Math.abs(lx) < SL + 4) exit = 'N'; else if (lx > d && Math.abs(lz) < SL + 4) exit = 'E'; else if (lx < -d && Math.abs(lz) < SL + 4) exit = 'W'; }
    else if (c && c.role === 'cand' && c.cand?.from === p.idx) exit = c.cand.exit;
    if (exit && (p.allowed || p.exits).includes(exit)) this.choose(exit);
  }
  /** Commit the pending crossroads exit (player choice); the other branches become side blocks. */
  choose(exit) {
    const p = this.route.pending; if (!p || !this.route.choose(p.idx, exit)) return false;
    this.route.ensure(p.idx + 3);
    this._ensurePaths();
    for (const c of this.cells.values()) if (c.role === 'cand') {
      const t = this.route.tiles[c.cand.idx];
      if (c.cand.exit === exit && t && t.cell[0] === c.i && t.cell[1] === c.j) { c.role = 'route'; c.tile = t; c.cand = null; this._emit('cellRoleChanged', c); }
      else { c.role = 'filler'; c.cand = null; this._emit('cellRoleChanged', c); }
    }
    this._emit('routeChosen', p.idx, exit);
    return true;
  }
  /**
   * Streaming step. pos / vel: player feet + velocity (world). opts.force: create everything now
   * (startup, behind a black screen). Returns the number of cells still missing.
   */
  update(pos, vel = { x: 0, y: 0, z: 0 }, dt = 1 / 60, { force = false } = {}) {
    this.time += dt;
    const cfg = this.cfg;
    this._checkCommit(pos);
    const cur = Math.max(0, this._currentTile(pos)); this.curTile = cur;
    const sp = Math.hypot(vel.x, vel.y, vel.z);
    const ahead = Math.max(cfg.aheadMinTiles, Math.min(cfg.aheadMaxTiles, Math.ceil(sp * cfg.aheadSeconds / S) + cfg.aheadMinTiles));
    this.aheadTiles = ahead;
    const cap = this.mode === 'story' ? EXIT_TILE + 1 : Infinity;
    this.route.ensure(Math.min(cap + 1, cur + ahead + 8));
    this._ensurePaths();
    const pr = this.progress(pos.x, pos.z); this._hintS = pr.s; this.lateral = pr.dist;

    // ---------------- wanted cells
    const want = new Map(), reserved = new Map(), tiles = this.route.tiles;
    for (const t of tiles) if (t.idx >= cur - cfg.behindTiles - 4) reserved.set(ckey(...t.cell), t);
    const lastIdx = Math.min(tiles.length - 1, cur + ahead, cap);
    const addRoute = (t) => want.set(ckey(...t.cell), { role: 'route', tile: t, i: t.cell[0], j: t.cell[1] });
    for (let k = Math.max(0, cur - cfg.behindTiles); k <= lastIdx; k++) addRoute(tiles[k]);
    for (const idx of this.pins.values()) if (tiles[idx]) addRoute(tiles[idx]);
    const pend = this.route.pending;
    if (pend && pend.idx <= cur + ahead && this.mode !== 'story') {
      for (const br of this.route.candidates(pend.idx, 4)) br.tiles.forEach((t, d) => {
        const k = ckey(...t.cell); reserved.set(k, t);
        if (d < 2 && !want.has(k)) want.set(k, { role: 'cand', tile: t, i: t.cell[0], j: t.cell[1], cand: { from: pend.idx, exit: br.exit, idx: t.idx } });
      });
    }
    this._reserved = reserved;
    for (const w of [...want.values()]) for (const [di, dj] of NEI) {
      const i = w.i + di, j = w.j + dj, k = ckey(i, j);
      if (!want.has(k) && !reserved.has(k)) want.set(k, { role: 'filler', tile: null, i, j });
    }

    // ---------------- role changes / conflicts, creation (nearest first), recycling
    const missing = [];
    for (const [k, w] of want) {
      const c = this.cells.get(k);
      if (!c) { missing.push(w); continue; }
      if (w.role === 'route' && c.role !== 'route') {
        if (c.tile && c.tile.cell[0] === w.i && c.tile.cell[1] === w.j && c.kind === w.tile.kind && (c.tile.idx === w.tile.idx)) { c.role = 'route'; c.tile = w.tile; this._emit('cellRoleChanged', c); }
        else { this.stats.conflicts++; this._removeCell(c); missing.push(w); } // a side block where the route now goes: rebuilt
      } else if (w.role === 'cand' && c.role === 'filler' && !c.tile) { this.stats.conflicts++; this._removeCell(c); missing.push(w); }
      else if (w.role === 'cand' && !c.cand) { c.role = 'cand'; c.cand = w.cand; this._emit('cellRoleChanged', c); }
    }
    missing.sort((a, b) => this.distToCell(a.i, a.j, pos.x, pos.z) - this.distToCell(b.i, b.j, pos.x, pos.z));
    const n = force ? missing.length : Math.min(missing.length, cfg.createPerFrame);
    for (let q = 0; q < n; q++) { const w = missing[q]; const c = this._createCell(w.i, w.j, w.role, w.tile); if (w.cand) c.cand = w.cand; }
    let lingering = 0;
    for (const c of [...this.cells.values()]) {
      if (want.has(c.key)) continue;
      if (this._protected(c, pos)) { lingering++; continue; }
      this._removeCell(c);
    }
    // ---------------- stats
    const st = this.stats; st.cells = this.cells.size; st.route = 0; st.filler = 0; st.cand = 0; st.anchors = 0; st.colliders = 0; st.lingering = lingering; st.missing = missing.length - n;
    for (const c of this.cells.values()) { st[c.role]++; st.anchors += c.anchors.length; st.colliders += c.colliders.length; }
    if (this.mode === 'endless') this._maybeRebase(pos);
    return missing.length - n;
  }
  _protected(c, pos) {
    if (this.distToCell(c.i, c.j, pos.x, pos.z) < this.cfg.keepRadius) return true;
    if (this.attachedAll?.some((x) => x.cell === c && x.valid)) return true;
    for (const idx of this.pins.values()) { const t = this.route.tiles[idx]; if (t && t.cell[0] === c.i && t.cell[1] === c.j) return true; }
    return false;
  }
  /** Cells around p not built yet (data or visuals) — Loading screens wait for 0. */
  pendingNear(p, range = 160) {
    let n = 0; for (const c of this.cells.values()) if (!c.ready && this.distToCell(c.i, c.j, p.x, p.z) < range) n++;
    return n + (this.stats.missing || 0);
  }
  /** Speed cap (m/s) when the player is about to reach a module that is not built yet (never enter emptiness). */
  speedCapAt(pos) {
    const cur = this.route.tiles[this.curTile], next = this.route.tiles[this.curTile + 1];
    const chk = (t) => { if (!t) return true; const c = this.cells.get(ckey(...t.cell)); return !!(c && c.ready); };
    if (cur && !chk(cur)) return 3;
    if (next && !chk(next) && this.distToCell(next.cell[0], next.cell[1], pos.x, pos.z) < this.cfg.slowDownNearUnready) return 5;
    return Infinity;
  }
  /** Inside the playable corridor? (an active cell, near the route centre line, below the soft ceiling) */
  inCorridor(x, y, z) {
    if (y > this.cfg.corridor.maxHeight + 5) return false;
    const c = this.cellAt(x, z); if (!c) return false;
    if (c.role === 'route' || c.role === 'cand') return true;
    return this.progress(x, z).dist < this.cfg.corridor.halfWidth;
  }
  /** Respawn spot of a route tile (cling / roof / ground) if that tile is built. */
  checkpointFor(idx) {
    const t = this.route.tiles[idx]; if (!t) return null;
    const c = this.cells.get(ckey(...t.cell)); if (!c || !c.ready || !c.checkpoint) return null;
    return { ...c.checkpoint, tile: idx };
  }
  tileCell(idx) { const t = this.route.tiles[idx]; return t ? this.cells.get(ckey(...t.cell)) || null : null; }

  // ------------------------------------------------------------ physics / anchor queries (locomotion API)
  collidersNear(x, z, rad, out = []) { out.length = 0; this.cols.rect(x - rad, z - rad, x + rad, z + rad, (c) => { out.push(c); }); return out; }
  anchorsNear(x, z, rad, out = []) { out.length = 0; this.anch.rect(x - rad, z - rad, x + rad, z + rad, (a) => { if (a.valid && a.cell.ready) out.push(a); }); return out; }
  colliderOf(id) { return this.colById.get(id) || null; }
  building(id) { return this.byBuilding.get(id) || null; }
  pointBlocked(x, y, z, pad = 0) { return this.cols.rect(x - pad, z - pad, x + pad, z + pad, (c) => insideBox(c, x, y, z, pad)); }
  /**
   * Segment a→b blocked by a building? Boxes containing a are ignored (firing from inside the home room);
   * hits on ownId within 3.5 m of b, or over its own roof edge (3 m), don't count; the last endTrim m are skipped.
   */
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
  get activeAnchors() { const out = []; for (const c of this.cells.values()) if (c.ready) for (const a of c.anchors) if (a.valid) out.push(a); return out; }
  anchorById(id) { for (const c of this.cells.values()) for (const a of c.anchors) if (a.id === id) return a; return null; }

  // ------------------------------------------------------------ origin rebasing (float precision on long runs)
  _maybeRebase(pos) {
    const R = this.cfg.rebaseDist;
    if (Math.abs(pos.x) < R && Math.abs(pos.z - this.cfg.originZ) < R) return;
    if (this.attached && Math.abs(pos.x) < R * 2 && Math.abs(pos.z) < R * 2) return; // wait for a calm moment (not on a web)
    const [pi, pj] = this.cellOf(pos.x, pos.z);
    this.rebase(pi, pj);
  }
  /** Make cell (i, j) the new origin cell: everything in world space shifts by (dx, 0, dz) (listeners too). */
  rebase(i, j) {
    const dx = -(i - this.oi) * S, dz = -(j - this.oj) * S;
    if (!dx && !dz) return;
    this.oi = i; this.oj = j;
    this.cols.clear(); this.anch.clear();
    for (const c of this.cells.values()) {
      c.T = { ...c.T, cx: c.T.cx + dx, cz: c.T.cz + dz };
      for (const b of c.buildings) { b.x += dx; b.z += dz; }
      for (const k of c.colliders) { k.x += dx; k.z += dz; const [x0, z0, x1, z1] = aabbOf(k); this.cols.insert(k, x0, z0, x1, z1); }
      for (const a of c.anchors) { a.pos[0] += dx; a.pos[2] += dz; a.p.x += dx; a.p.z += dz; this.anch.insert(a, a.pos[0], a.pos[2], a.pos[0], a.pos[2]); }
      for (const v of Object.values(c.mounts)) (Array.isArray(v[0]) ? v : [v]).forEach((p) => { p[0] += dx; p[2] += dz; });
      if (c.checkpoint) { c.checkpoint.pos[0] += dx; c.checkpoint.pos[2] += dz; }
    }
    for (const e of this.paths) for (const p of e.pts) { p[0] += dx; p[2] += dz; }
    this.rebaseOffset[0] += dx; this.rebaseOffset[1] += dz;
    this.stats.rebases++;
    this._emit('rebased', dx, dz);
  }
}

/** The one city world used by the game (renderer, locomotion, story, HUD). */
export const cityWorld = new CityWorld();
export { FACTORY_TILE, EXIT_TILE };
void MODULES; void STEP;
