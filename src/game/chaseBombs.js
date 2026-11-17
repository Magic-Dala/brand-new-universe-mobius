// v0.21 story chase: Green Maniac lobs ordinary pumpkin bombs back at the player (not beat-synced).
// Each bomb is aimed ONCE at release (where the player is + a limited lead), then flies ballistically —
// it never homes. The player shoots it with a wrist web or swings out of the way. Pooled; bombs that
// time out, hit the city or drift out of range are recycled. Damage feedback = the arcade's (flash +
// sound + haptics), no camera motion.
import * as THREE from 'three';
import { audio } from '../core/audio.js';
import { settings } from '../core/settings.js';
import { createPumpkinBomb, GREEN_MANIAC_THROW_RELEASE } from '../art/enemies.js';
import { pickTarget, angularZoneSize } from './aim.js';
import { STORY_COMBAT } from '../data/storyCombat.js';
import { mulberry32 } from '../data/box.js';
import { sweptHit } from '../worlds/chaseCombat.js';

const _v = new THREE.Vector3(), _w = new THREE.Vector3();

/** Aim point with limited prediction (pure – unit tested). */
export function bombAimPoint(chest, vel, T, cfg = STORY_COMBAT.bombs, out = new THREE.Vector3()) {
  const lead = _w.copy(vel).multiplyScalar(T * cfg.leadFactor);
  if (lead.length() > cfg.maxLead) lead.setLength(cfg.maxLead);
  return out.copy(chest).add(lead);
}
/** Launch velocity that reaches `target` after T seconds under gravity g (pure – unit tested). */
export function launchVelocity(from, target, T, g, out = new THREE.Vector3()) {
  out.copy(target).sub(from).divideScalar(T); out.y += 0.5 * g * T;
  return out;
}
export function flightTimeFor(dist, cfg = STORY_COMBAT.bombs) { return THREE.MathUtils.clamp(dist / cfg.speed, cfg.flightTime[0], cfg.flightTime[1]); }

export class ChaseBombs {
  constructor(app, cfg = STORY_COMBAT.bombs) {
    this.app = app; this.cfg = cfg;
    this.root = new THREE.Group(); this.root.name = 'chaseBombs'; app.scene.add(this.root);
    this.items = [];
    // v0.44 palm shield: asked for every flying pumpkin before its own proximity / wall tests.
    // 0 = nothing in its way, 1 = its path meets a raised shield (the proximity fuse waits), 2 = blocked (consumed via blockAt).
    this.blocker = (it) => app.shield?.tryBlock(this, it) || 0;
    this.reset();
  }
  _mk(kind = 'normal') { // v0.42: 'giant' = the World Chase heavy pumpkin (evil-face model)
    const p = createPumpkinBomb({ model: kind });
    const scale = kind === 'giant' ? (this.cfg.giantScale ?? 1.25) : this.cfg.scale;
    p.root.scale.setScalar(scale); p.root.visible = false; this.root.add(p.root);
    return { p, kind, scale, active: false, phase: null, t: 0, pos: new THREE.Vector3(), vel: new THREE.Vector3(), prev: new THREE.Vector3(), id: 0, hl: 0 };
  }
  _get(kind = 'normal') {
    let it = this.items.find((x) => !x.active && (x.kind || 'normal') === kind);
    if (!it) { const n = this.items.filter((x) => (x.kind || 'normal') === kind).length; if (n >= (kind === 'giant' ? 2 : this.cfg.maxActive + 1)) return null; it = this._mk(kind); this.items.push(it); }
    it.active = true; it.t = 0; it.p.root.visible = true; it.p.setGlow(0.4); it.p.setHighlight?.(0); it.blast = null; it.launchT = null; it.g = null;
    it.p.root.scale.setScalar(it.scale ?? this.cfg.scale);
    return it;
  }
  _free(it) { it.active = false; it.phase = null; it.p.root.visible = false; if (it.hl) { it.hl = 0; it.p.setHighlight?.(0); } }
  reset(seed = 1) {
    for (const it of this.items) this._free(it);
    this.rand = mulberry32(seed >>> 0 || 1);
    this.timer = this.cfg.firstDelay; this.windup = null; this.seq = 0; this._chest0 = null;
    this.stats = { thrown: 0, destroyed: 0, hits: 0, exploded: 0, fizzled: 0, recycled: 0, blocked: 0 };
  }
  get activeCount() { return this.items.filter((x) => x.active).length; }
  get flying() { return this.items.filter((x) => x.active && x.phase === 'fly'); }

  /**
   * ctx: { allow (may start a new throw), boss, chest, playerVel }. Flying bombs always keep updating
   * (a pause only stops NEW throws, it never freezes or deletes bombs already in the air).
   */
  update(dt, { allow, boss, chest, playerVel }) {
    const C = this.cfg;
    // ---- schedule / windup
    if (this.windup) {
      const w = this.windup, it = w.it; w.t += dt;
      boss.throwPoint(it.pos); it.p.root.position.copy(it.pos);
      it.p.setGlow(0.5 + 0.5 * Math.abs(Math.sin(w.t * 14))); it.p.update(dt); it.p.root.lookAt(chest);
      if (!allow && !w.thrown) { this._free(it); this.windup = null; } // cancelled (turn / tether / roof)
      else {
        if (!w.thrown && w.t >= C.windup) { w.thrown = true; w.tThrow = w.t; boss.throw(); }
        if (w.thrown && w.t - w.tThrow >= GREEN_MANIAC_THROW_RELEASE) this._launch(it, chest, playerVel), this.windup = null;
      }
    } else if (allow) {
      this.timer -= dt;
      const d = boss.root.position.distanceTo(chest);
      if (this.timer <= 0 && d > C.minRange && d < C.maxRange && this.activeCount < C.maxActive) {
        const it = this._get();
        if (it) { it.phase = 'held'; this.windup = { it, t: 0, thrown: false }; audio.play('tick'); boss.maniac?.setState?.('turn'); } // v6: turns around first (turn clip ≈ windup), then the 180°-yawed throw
        this.timer = C.interval[0] + this.rand() * (C.interval[1] - C.interval[0]);
      }
    }
    // ---- flight
    const world = this.world || this.app.cityWorld; // v0.40: the World Chase sets its own world
    for (const it of this.items) {
      if (!it.active || it.phase !== 'fly') continue;
      it.t += dt;
      it.prev.copy(it.pos);
      it.vel.y -= (it.g ?? C.gravity) * dt;
      it.pos.addScaledVector(it.vel, dt);
      it.p.root.position.copy(it.pos); if (it.kind === 'giant') it.p.root.lookAt(chest); else it.p.root.rotation.y += dt * 4; it.p.update(dt); // (v0.42: the heavy pumpkin keeps its evil face toward Mobius)
      it.p.setCountdown?.(null);
      const blk = this.blocker ? this.blocker(it) : 0; // v0.44 palm shield (swept in the shield's frame)
      if (blk === 2) continue; // burst on the shield: no explosion, no damage — the item is already recycled
      const dc = it.pos.distanceTo(chest);
      if (C.swept) { // v0.41 World Chase: continuous tests (bomb + player both move up to ~2 m per frame)
        const k = blk === 1 ? -1 : sweptHit(it.prev, it.pos, this._chest0 || chest, chest, C.proximity);
        if (k >= 0) { it.pos.lerpVectors(it.prev, it.pos, k); this._explode(it, chest); continue; }
        if (it.pos.y < 0.3 || world?.segmentBlocked(it.prev.x, it.prev.y, it.prev.z, it.pos.x, it.pos.y, it.pos.z, null, null, 0) || world?.pointBlocked(it.pos.x, it.pos.y, it.pos.z, 0.1)) { this._explode(it, chest); continue; }
      } else {
        if (blk !== 1 && dc < C.proximity) { this._explode(it, chest); continue; }
        if (it.pos.y < 0.3 || world?.pointBlocked(it.pos.x, it.pos.y, it.pos.z, 0.15)) { this._explode(it, chest); continue; }
      }
      if (it.t > C.life) { this.stats.fizzled++; this.app.fx.boom(it.pos, { color: 0xffd080, size: 0.35, life: 0.35 }); this._free(it); continue; }
      if (dc > C.recycleDist) { this.stats.recycled++; this._free(it); }
    }
    (this._chest0 || (this._chest0 = new THREE.Vector3())).copy(chest);
  }
  /** opts (v0.42 World Chase): { T (flight s), offset (Vector3 added to the aim point), blast (m), gravity (m/s²) }. */
  _launch(it, chest, playerVel, opts = {}) {
    const C = this.cfg;
    const T = opts.T ?? flightTimeFor(it.pos.distanceTo(chest), C);
    const target = bombAimPoint(chest, playerVel, T, C, _v);
    if (opts.offset) target.add(opts.offset);
    if (opts.blast) it.blast = opts.blast;
    it.g = opts.gravity ?? null; // (v0.42: the heavy pumpkin flies a flatter arc — stays in view)
    launchVelocity(it.pos, target, T, it.g ?? C.gravity, it.vel);
    it.phase = 'fly'; it.t = 0; it.target = target.clone(); it.p.setGlow(0.7); it.id = ++this.seq; it.prev.copy(it.pos);
    this.app.fx.vfx?.pumpkinFlight(it.p, { scale: C.scale }); // v0.30 vfx (visual only)
    this.stats.thrown++;
    audio.play('throwEnemy');
  }
  _explode(it, chest) {
    const C = this.cfg, app = this.app;
    this.stats.exploded++;
    if (it.kind === 'giant') app.fx.vfx?.giantBlast?.(it.pos, { size: 0.8, smoke: false }) || app.fx.boom(it.pos, { color: 0xff8a1a, size: 1.8, life: 0.7 });
    else app.fx.vfx?.chaseBomb(it.pos) || app.fx.boom(it.pos, { color: 0xffa020, size: 1.0, life: 0.55 }); // v0.30 vfx
    audio.play('boomEnemy');
    if (it.pos.distanceTo(chest) < (it.blast || C.blastRadius) && (!this.world || !this.world.segmentBlocked(it.pos.x, it.pos.y, it.pos.z, chest.x, chest.y, chest.z))) { // same feedback as an arcade miss: flash + sound + haptics, no camera motion
      this.stats.hits++;
      app.flashDamage?.(); audio.play('damage');
      for (const h of ['left', 'right']) app.hub.haptic?.(h, 0.5, 80);
      this.onPlayerHit?.(it); // v0.41 World Chase: HP (once per bomb id)
    }
    this._free(it);
  }
  /** A wrist web shot: destroys the flying bomb it picks (generous zone). Returns the bomb or null. */
  tryShoot(e) {
    const C = this.cfg, cands = [];
    for (const it of this.items) {
      if (!it.active || it.phase !== 'fly') continue;
      const d = it.pos.distanceTo(e.origin), s = Math.max(C.hitZone, angularZoneSize(d, C.hitMinDeg, settings.assistMargin, 0));
      cands.push({ pos: it.pos, w: s, h: s, it });
    }
    if (!cands.length) return null;
    const pick = pickTarget(e.origin, e.dir, cands, { margin: settings.assistMargin, maxDist: 45, occluded: (o, p) => !!(this.world || this.app.cityWorld)?.segmentBlocked(o.x, o.y, o.z, p.x, p.y, p.z) });
    if (!pick) return null;
    const it = pick.target.it, app = this.app;
    app.fx.web(e.origin, it.pos); app.fx.net(it.pos, 0.45); app.fx.vfx?.pumpkinBurst(it.pos, { size: C.scale }) || app.fx.boom(it.pos, { color: 0x5fd8ff, size: 0.8, life: 0.5 }); // v0.30 vfx
    audio.play('webHit'); audio.play('boomBlue');
    this.stats.destroyed++;
    this._free(it);
    return it;
  }
  /** v0.41: destroy a flying bomb with a web from `origin` (the World Chase picks the target itself). */
  shootDown(it, origin, by = 'web') {
    const C = this.cfg, app = this.app;
    if (!it?.active || it.phase !== 'fly') return false;
    if (by === 'web') { app.fx.web(origin, it.pos); app.fx.net(it.pos, 0.45); audio.play('webHit'); }
    app.fx.vfx?.pumpkinBurst(it.pos, { size: (it.scale ?? C.scale) * (it.kind === 'giant' ? 1.6 : 1), by }) || app.fx.boom(it.pos, { color: 0x5fd8ff, size: 0.8, life: 0.5 });
    audio.play('boomBlue');
    this.stats.destroyed++;
    this.onShotDown?.(it, by); // v0.42 World Chase: heavy-pumpkin counter check (before the item is recycled)
    this._free(it);
    return true;
  }
  /**
   * v0.44: a flying pumpkin burst on the palm shield at `at`. Purely defensive: no explosion damage, no reflection,
   * not counted as destroyed / shot down (no score, no heavy-pumpkin counter). Processed once — the item is recycled here.
   */
  blockAt(it, at) {
    const C = this.cfg, app = this.app;
    if (!it?.active || it.phase !== 'fly') return false;
    this.stats.blocked++;
    app.fx.net?.(at, it.kind === 'giant' ? 0.6 : 0.4);
    app.fx.vfx?.pumpkinBurst(at, { size: (it.scale ?? C.scale) * (it.kind === 'giant' ? 1.2 : 0.8), by: 'shield' }) || app.fx.boom(at, { color: 0x5fd8ff, size: 0.6, life: 0.4 });
    this.onBlocked?.(it);
    this._free(it);
    return true;
  }
  /** v0.41: the pumpkin the assist is aiming at shows a highlight (level 1; 0 clears). */
  highlight(it, lvl) { if (it && it.hl !== lvl) { it.hl = lvl; it.p.setHighlight?.(lvl); } }
  clear() { for (const it of this.items) this._free(it); this.windup = null; }
  /** v0.40 floating origin: flying bombs move with the world. */
  shift(dx, dz) { for (const it of this.items) if (it.active) { it.pos.x += dx; it.pos.z += dz; it.p.root.position.x += dx; it.p.root.position.z += dz; if (it.target) { it.target.x += dx; it.target.z += dz; } } }
}
void _w;
