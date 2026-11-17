// v0.24 Bitcoins (was v0.23 gold coins): FEW, BIG ones, placed so collecting them is part of swinging well.
//  * gap coin:  one big Bitcoin floating in the middle of the avenue between the buildings, at swing height —
//               swing through it.
//  * wall row:  three Bitcoins in a horizontal line along a building wall that faces the route, at the height a
//               web swing reaches the wall — swing in, wall-run along it and pick up all three.
// Story chase: along the story route (window → factory). Endless city (after the factory): generated ahead of the
// player along the endless route and recycled behind; the count carries on.
// A slot only becomes real once the module under it is built; a gap coin is dropped if it sits inside / too close to
// a building, a wall row is skipped when no suitable wall is near. Flying or running through a coin collects it
// (swept along the chest path since the last frame, so fast swings never skip one). The count shows top-right in
// the helmet HUD.
import * as THREE from 'three';
import { audio } from '../core/audio.js';
import { STORY_ROUTE as ROUTE } from '../data/layout.js';
import { routePoint, routeHeight } from './chase.js';
import { WALLRUN } from './locomotion.js';

export const COINS = {
  from: 30, every: 38, // m along the route: first slot / slot spacing (slots alternate gap coin ↔ wall row)
  gapDrop: 7, // m below the route height (≈ the low point of a swing)
  gapClear: 2.0, // m: a gap coin keeps this far from every building
  wallSearch: 34, // m around the route point to look for a wall
  wallDrop: 6, // m below the route height for the wall row (clamped to the wall)
  wallCount: 3, wallGap: 3.4, // coins per row / spacing along the wall (m)
  wallOff: 0.75, // m off the wall face (a wall run holds the body ≈ 0.39 m off it)
  wallMinLen: 14, // m: the wall face must be at least this long
  radius: 2.2, // m pick-up radius around the chest path (v0.30: was 1.7)
  magnet: 9, // v0.30 m: coins this close to the chest are caught and fly to the player (then collected)
  magnetSpeed: [10, 60], // m/s: start speed / +acceleration per second while flying in
  size: 0.85, // coin radius (m)
  drawRange: 170, // m
  max: 120,
  ahead: 260, behind: 150, // endless: generate / recycle distances (m)
};
const CHEST = 1.3, R_BODY = 0.35;
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _e = new THREE.Euler();
const Y = new THREE.Vector3(0, 1, 0);

/** Bitcoin face: orange disc, light rim, white ₿ (tilted like the logo). mirror: for the back face. */
function bitcoinTexture(mirror) {
  if (typeof document === 'undefined') return null;
  const S = 256, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const grd = g.createRadialGradient(S * 0.38, S * 0.36, 8, S / 2, S / 2, S / 2);
  grd.addColorStop(0, '#ffc266'); grd.addColorStop(0.6, '#f7931a'); grd.addColorStop(1, '#c46a00');
  g.fillStyle = grd; g.fillRect(0, 0, S, S);
  g.strokeStyle = '#ffe1a8'; g.lineWidth = 10; g.beginPath(); g.arc(S / 2, S / 2, S * 0.43, 0, Math.PI * 2); g.stroke();
  g.translate(S / 2, S / 2); if (mirror) g.scale(-1, 1); g.rotate(-0.24); // (the cap UVs flip the canvas: −0.24 here = the logo's clockwise lean on screen)
  g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `900 ${S * 0.62}px system-ui, "Segoe UI Symbol", "Noto Sans", sans-serif`;
  g.lineJoin = 'round'; g.lineWidth = S * 0.05; g.strokeStyle = '#8a4200'; g.strokeText('\u20bf', 0, S * 0.02);
  g.fillText('\u20bf', 0, S * 0.02);
  const tx = new THREE.CanvasTexture(cv); tx.colorSpace = THREE.SRGBColorSpace; tx.anisotropy = 4;
  return tx;
}

export class Coins {
  constructor(app, cfg = COINS) {
    this.app = app; this.cfg = cfg;
    const g = new THREE.CylinderGeometry(cfg.size, cfg.size, cfg.size * 0.2, 40).rotateX(Math.PI / 2); // faces ±Z
    const rim = new THREE.TorusGeometry(cfg.size * 0.99, cfg.size * 0.07, 6, 40);
    const side = new THREE.MeshStandardMaterial({ color: 0xf7931a, emissive: 0x6a3000, emissiveIntensity: 0.8, metalness: 0.6, roughness: 0.3 });
    const face = (mirror) => new THREE.MeshBasicMaterial({ map: bitcoinTexture(mirror), toneMapped: false }); // unlit: the logo stays crisp + readable in shadow
    const rimMat = new THREE.MeshBasicMaterial({ color: 0xffe1a8, toneMapped: false });
    this.mesh = new THREE.InstancedMesh(g, [side, face(false), face(true)], cfg.max); this.rim = new THREE.InstancedMesh(rim, rimMat, cfg.max);
    for (const m of [this.mesh, this.rim]) { m.frustumCulled = false; m.count = 0; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); }
    this.root = new THREE.Group(); this.root.name = 'coins'; this.root.add(this.mesh, this.rim); app.scene.add(this.root);
    this.root.visible = false;
    this.items = []; this.slots = []; this.count = 0; this.active = false;
    this.prevChest = new THREE.Vector3(); this._hasPrev = false;
  }
  // ------------------------------------------------------------ route access (story route or endless route)
  _pt(s, out = new THREE.Vector3()) { return this.mode === 'endless' ? this.app.cityWorld.pointAt(s, out) : out.copy(routePoint(s)).setY(routeHeight(s)); }

  /** New story run: plan the slots along the story route (each validated once its module is built). */
  start() {
    const C = this.cfg; this.items = []; this.slots = []; this.count = 0; this.active = true; this.mode = 'story'; this._hasPrev = false; this.root.visible = true;
    const end = ROUTE.length - 30; let k = 0;
    for (let s = C.from; s < end; s += C.every) this.slots.push({ s, kind: k++ % 2 ? 'wall' : 'gap', side: (k >> 1) % 2 ? 1 : -1 });
    this.app.hud?.setCoins?.(0, true);
  }
  /** v7 endless city (after the factory): Bitcoins keep coming along the endless route; the count carries on. */
  startEndless(endless) {
    this.items = []; this.slots = []; this.active = true; this.mode = 'endless'; this.endless = endless; this._hasPrev = false; this.root.visible = true;
    this.nextS = endless.playerS + 25; this._k = 0;
    this.app.hud?.setCoins?.(this.count, true);
  }
  _endlessGen() {
    const C = this.cfg, ps = this.endless.playerS;
    while (this.nextS < ps + C.ahead) { const k = this._k++; this.slots.push({ s: this.nextS, kind: k % 2 ? 'wall' : 'gap', side: (k >> 1) % 2 ? 1 : -1 }); this.nextS += C.every; }
    if (this.items.length > C.max * 0.6) this.items = this.items.filter((it) => it.s > ps - C.behind);
    if (this.slots.length > 40) this.slots = this.slots.filter((sl) => sl.s > ps - C.behind);
  }
  /** v0.40 World Chase: coins come from the streamed route modules (cell.coins, validated by the generator); the
   *  collected ids are remembered so a recycled / re-added module can never pay out twice. */
  startWorld(ctl) {
    this.items = []; this.slots = []; this.count = 0; this.active = true; this.mode = 'world'; this.worldCtl = ctl; this._hasPrev = false; this.root.visible = true;
    this.collected = new Set();
    this.app.hud?.setCoins?.(0, true);
  }
  addCell(cell) {
    if (this.mode !== 'world') return;
    for (const c of cell.coins) { if (this.collected.has(c.id) || this.items.some((it) => it.id === c.id)) continue; this.items.push({ id: c.id, cell: cell.idx, pos: c.pos, s: c.s, kind: 'gap', state: 'live', ph: (c.s * 0.37) % 6 }); }
  }
  removeCell(cell) { if (this.mode === 'world') this.items = this.items.filter((it) => it.cell !== cell.idx); }
  stop() { this.active = false; this.mode = null; this.root.visible = false; this.app.hud?.setCoins?.(this.count, false); }
  /**
   * v0.47 Story chase: a punch knocks `n` Bitcoins out of Green Maniac at `pos`. They scatter around the point already
   * caught by the magnet, so they fly to the player and are collected by the normal update (count, sound, HUD pulse).
   * Returns how many were added (0 when no coin run is active).
   */
  burst(pos, n = 8) {
    if (!this.active || !(n > 0)) return 0;
    const C = this.cfg; let made = 0;
    for (let i = 0; i < n && this.items.length < 4 * C.max; i++) {
      const a = i * 2.399963, r = 0.9 + 0.9 * ((i * 0.618034) % 1); // golden-angle scatter (no clumps, deterministic)
      const p = new THREE.Vector3(pos.x + Math.cos(a) * r, pos.y + 0.3 + 1.2 * ((i * 0.381966) % 1), pos.z + Math.sin(a) * r);
      this.items.push({ pos: p, s: Infinity, kind: 'gap', state: 'live', ph: i * 0.7, mag: p.clone(), mv: C.magnetSpeed[0], burst: true }); made++;
    }
    return made;
  }

  /** Lazy validation: a slot becomes coins once the module under it is built. */
  _validate(head) {
    const w = this.app.cityWorld, C = this.cfg; let n = 0;
    for (let i = this.slots.length - 1; i >= 0; i--) {
      const sl = this.slots[i], p = this._pt(sl.s, _v);
      if (Math.hypot(p.x - head.x, p.z - head.z) > C.drawRange + 40) continue;
      const cell = w.cellAt(p.x, p.z); if (!cell || !cell.ready) continue;
      this.slots.splice(i, 1);
      if (sl.kind === 'gap') this._placeGap(sl, p.clone());
      else if (!this._placeWall(sl, p.clone())) this._placeGap(sl, p.clone()); // no usable wall here → a gap coin instead
      if (++n > 6) break;
    }
  }
  _placeGap(sl, p) {
    const w = this.app.cityWorld, C = this.cfg;
    const pos = p.clone(); pos.y -= C.gapDrop;
    if (pos.y < 5 || w.pointBlocked(pos.x, pos.y, pos.z, C.gapClear)) { pos.y = p.y - 2; if (w.pointBlocked(pos.x, pos.y, pos.z, C.gapClear)) return false; } // tight spot: a bit higher
    this.items.push({ pos, s: sl.s, kind: 'gap', state: 'live', ph: Math.random() * 6 });
    return true;
  }
  /** Three coins along the face of a building that looks at the route (on the slot's side if possible). */
  _placeWall(sl, p) {
    const w = this.app.cityWorld, C = this.cfg, h = p.y;
    const fwd = this._pt(sl.s + 4, _w).sub(p).setY(0); if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1); fwd.normalize();
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const y = h - C.wallDrop;
    let best = null;
    for (const c of w.collidersNear(p.x, p.z, C.wallSearch)) {
      if (['A', 'C'].includes(c.id) || c.y0 > y - 2 || c.y1 < y + WALLRUN.topMargin + 2) continue;
      const ax = new THREE.Vector3(c.cos, 0, -c.sin), az = new THREE.Vector3(c.sin, 0, c.cos);
      for (const [nrm, half, tan, thalf] of [[ax, c.hw, az, c.hd], [ax.clone().negate(), c.hw, az, c.hd], [az, c.hd, ax, c.hw], [az.clone().negate(), c.hd, ax, c.hw]]) {
        if (thalf * 2 < C.wallMinLen) continue;
        const fc = new THREE.Vector3(c.x, 0, c.z).addScaledVector(nrm, half);
        const to = _v.set(p.x - fc.x, 0, p.z - fc.z), dist = to.dot(nrm);
        if (dist < 4 || dist > C.wallSearch) continue; // the face must look at the route, from across the street
        if (Math.abs(nrm.dot(fwd)) > 0.5) continue; // a face along the route (not one facing up / down the avenue)
        const sideOk = Math.sign(-nrm.dot(right)) === sl.side;
        const u = THREE.MathUtils.clamp(to.dot(tan), -(thalf - WALLRUN.edgeMargin - C.wallGap - 1.5), thalf - WALLRUN.edgeMargin - C.wallGap - 1.5);
        const score = dist + (sideOk ? 0 : 12) + Math.abs(to.dot(tan) - u) * 0.5;
        if (!best || score < best.score) best = { score, c, nrm: nrm.clone(), fc, tan: tan.clone(), u };
      }
    }
    if (!best) return false;
    const yy = THREE.MathUtils.clamp(y, WALLRUN.bottomMargin + 3, best.c.y1 - WALLRUN.topMargin - 2);
    const out = [];
    for (let j = 0; j < C.wallCount; j++) {
      const o = best.u + (j - (C.wallCount - 1) / 2) * C.wallGap;
      const pos = best.fc.clone().addScaledVector(best.tan, o).addScaledVector(best.nrm, C.wallOff); pos.y = yy;
      if (w.pointBlocked(pos.x, pos.y, pos.z, 0.3)) return false; // something sticks out of the wall here
      out.push({ pos, s: sl.s, kind: 'wall', normal: best.nrm.clone(), state: 'live', ph: j * 0.6, building: best.c.id });
    }
    this.items.push(...out);
    return true;
  }

  update(dt, tNow) {
    if (!this.active) return;
    if (this.mode === 'endless') this._endlessGen();
    const C = this.cfg, app = this.app, head = app.camera.getWorldPosition(_v).clone();
    if (this.mode !== 'world') this._validate(head);
    // collect: swept sphere along the chest path since the last frame
    const chest = app.locomotion.feet(_w).add(_s.set(0, CHEST, 0)).clone();
    if (!this._hasPrev || chest.distanceTo(this.prevChest) > 25) { this.prevChest.copy(chest); this._hasPrev = true; } // (teleport / respawn: no sweep)
    const a = this.prevChest, ab = chest.clone().sub(a), L2 = ab.lengthSq();
    let got = 0;
    for (const it of this.items) {
      if (it.state !== 'live') continue;
      // v0.30 magnet: once the chest passes within C.magnet, the coin flies in (accelerating, faster than a swing)
      if (!it.mag && it.pos.distanceTo(chest) < C.magnet) { it.mag = it.pos.clone(); it.mv = C.magnetSpeed[0]; }
      const cp = it.mag || it.pos;
      if (it.mag) {
        it.mv += C.magnetSpeed[1] * dt;
        const d = _v.copy(chest).sub(it.mag), L = d.length();
        it.mag.addScaledVector(d, Math.min(1, (it.mv * dt) / Math.max(L, 1e-3)));
      }
      const t = L2 > 1e-8 ? THREE.MathUtils.clamp(_s.copy(cp).sub(a).dot(ab) / L2, 0, 1) : 0;
      if (_s.copy(a).addScaledVector(ab, t).distanceTo(cp) < C.radius || cp.distanceTo(chest) < C.radius) { it.state = 'got'; got++; if (it.id) this.collected?.add(it.id); app.fx.boom(cp, { color: 0xf7931a, size: 1.0, life: 0.45 }); }
    }
    this.prevChest.copy(chest);
    if (got) {
      this.count += got; audio.play('coin');
      for (const h of ['left', 'right']) app.hub?.haptic?.(h, 0.35, 35);
      app.hud?.setCoins?.(this.count, true, true);
    }
    // draw: gap coins spin; wall coins face out of the wall with a slight wobble
    let n = 0;
    for (const it of this.items) {
      if (it.state !== 'live' || n >= C.max) continue;
      if (it.pos.distanceToSquared(head) > C.drawRange * C.drawRange) continue;
      if (it.mag) _q.setFromEuler(_e.set(0, tNow * 9 + it.ph, 0)); // flying in: fast spin
      else if (it.kind === 'wall') _q.setFromAxisAngle(Y, Math.atan2(it.normal.x, it.normal.z) + Math.sin(tNow * 1.6 + it.ph) * 0.35);
      else _q.setFromEuler(_e.set(0, tNow * 1.8 + it.ph, 0));
      if (it.mag) _w.copy(it.mag); else { _w.copy(it.pos); _w.y += Math.sin(tNow * 1.5 + it.ph) * 0.15; }
      const sc = it.mag ? THREE.MathUtils.clamp(it.mag.distanceTo(chest) / 4, 0.45, 1) : 1; // shrinks into the player
      _m.compose(_w, _q, _s.set(sc, sc, sc));
      this.mesh.setMatrixAt(n, _m); this.rim.setMatrixAt(n, _m); n++;
    }
    this.mesh.count = this.rim.count = n;
    this.mesh.instanceMatrix.needsUpdate = this.rim.instanceMatrix.needsUpdate = true;
  }
  /** Origin rebase (endless city): shift everything. */
  shift(dx, dz) { for (const it of this.items) { if (this.mode !== 'world') { it.pos.x += dx; it.pos.z += dz; } if (it.mag) { it.mag.x += dx; it.mag.z += dz; } } this.prevChest.x += dx; this.prevChest.z += dz; } // (world mode: item.pos IS the cell's coin record, already shifted by the world)
  get total() { return this.items.filter((x) => x.state !== 'dropped').length; }
}
