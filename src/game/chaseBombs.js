// v0.21 story chase: Green Maniac lobs ordinary pumpkin bombs back at the player (not beat-synced).
// Each bomb is aimed at release (where the player is + a limited lead), then flies ballistically.
// v1.1 (settings.bombTracking): it tracks the player a little during the flight (src/game/bombPath.js: mild, lets go
// before arrival, never further than BOMB_PATH.tracking.maxShift from the release aim); off = it never homes (v1.0).
// v1.1 (settings.bombPath): a dashed path shows where each held or flying pumpkin will arrive (src/game/bombPathFx.js). The player shoots it with a wrist web or swings out of the way. Pooled; bombs that
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
import { BOMB_PATH } from '../data/bombPath.js';
import { FIGHT } from '../worlds/bossFight.js';
import { trackedAim, steer, tracking, passedPlayer, samplePath } from './bombPath.js';
import { BombPathFx } from './bombPathFx.js';

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _pa = new THREE.Vector3(), _pv = new THREE.Vector3(), _up35 = new THREE.Vector3(0, 0.35, 0);

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

/**
 * v1.1 path preview for Green Maniac's telegraph (World Chase and Story chase share it): each held pumpkin gets the
 * flight it would take if released this frame — the same flight time, spread offset and gravity as the release code in
 * worldChase.js / storyCombat.js. T = the telegraph state ({ kind, heavyT }), k = 0 … 1 through the telegraph.
 */
const _pd = new THREE.Vector3(), _pl = new THREE.Vector3(), _po = new THREE.Vector3();
export function planHeldThrows(B, held, T, k, chest, bossPos) {
  const F = FIGHT;
  let i = 0;
  if (T.kind === 'spread') { _pd.copy(chest).sub(bossPos).setY(0).normalize(); _pl.set(-_pd.z, 0, _pd.x); } // the lateral axis at the player (as at the release)
  for (const it of held) {
    if (!it.active || it.phase !== 'held') continue;
    if (T.kind === 'spread') B.planHeld(it, F.spread.flight + 0.08 * Math.abs(i - 1), _po.copy(_pl).multiplyScalar((i - 1) * F.spread.lateral), null, k);
    else if (T.kind === 'heavy') B.planHeld(it, T.heavyT || (F.heavy.flight[0] + F.heavy.flight[1]) / 2, null, F.heavy.gravity, k);
    else B.planHeld(it, THREE.MathUtils.clamp(flightTimeFor(it.pos.distanceTo(chest), B.cfg), F.single.flight[0], F.single.flight[1]), null, null, k);
    i++;
  }
}
export class ChaseBombs {
  constructor(app, cfg = STORY_COMBAT.bombs) {
    this.app = app; this.cfg = cfg;
    this.root = new THREE.Group(); this.root.name = 'chaseBombs'; app.scene.add(this.root);
    this.items = [];
    // v0.44 palm shield: asked for every flying pumpkin before its own proximity / wall tests.
    // 0 = nothing in its way, 1 = its path meets a raised shield (the proximity fuse waits), 2 = blocked (consumed via blockAt).
    this.blocker = (it) => app.shield?.tryBlock(this, it) || 0;
    // v1.1 tracking (today's lead and cap + BOMB_PATH.tracking) and the path preview (one shared ribbon per app)
    this.trackCfg = { ...BOMB_PATH.tracking, leadFactor: cfg.leadFactor, maxLead: cfg.maxLead };
    this.pathCfg = BOMB_PATH.preview;
    this.pathFx = app.scene ? BombPathFx.for(app) : null; this.paths = this.pathFx ? this.pathFx.owner() : null;
    this._pChest = new THREE.Vector3(); this._pVel = new THREE.Vector3(); this._pHead = new THREE.Vector3(); this._pTime = 0; this._inUpdate = false; this._pReady = false;
    this.reset();
  }
  _mk(kind = 'normal') { // v0.42: 'giant' = the World Chase heavy pumpkin (evil-face model)
    const p = createPumpkinBomb({ model: kind });
    const scale = kind === 'giant' ? (this.cfg.giantScale ?? 1.25) : this.cfg.scale;
    p.root.scale.setScalar(scale); p.root.visible = false; this.root.add(p.root);
    return { p, kind, scale, active: false, phase: null, t: 0, pos: new THREE.Vector3(), vel: new THREE.Vector3(), prev: new THREE.Vector3(), id: 0, hl: 0,
      T: 0, aim0: new THREE.Vector3(), off: new THREE.Vector3(), trk: false, plan: false, pT: 0, pOff: new THREE.Vector3(), pG: 0, pK: 0, relA: 0 }; // (v1.1: tracking + the held path plan)
  }
  _get(kind = 'normal') {
    let it = this.items.find((x) => !x.active && (x.kind || 'normal') === kind);
    if (!it) { const n = this.items.filter((x) => (x.kind || 'normal') === kind).length; if (n >= (kind === 'giant' ? 2 : this.cfg.maxActive + 1)) return null; it = this._mk(kind); this.items.push(it); }
    it.active = true; it.t = 0; it.p.root.visible = true; it.p.setGlow(0.4); it.p.setHighlight?.(0); it.blast = null; it.launchT = null; it.g = null; it.trk = false; it.plan = false;
    it.p.root.scale.setScalar(it.scale ?? this.cfg.scale);
    return it;
  }
  _free(it) { it.active = false; it.phase = null; it.trk = false; it.plan = false; it.p.root.visible = false; if (it.hl) { it.hl = 0; it.p.setHighlight?.(0); } if (!this._inUpdate) this._drawPaths(); } // (v1.1: a path disappears the frame its pumpkin goes)
  reset(seed = 1) {
    this._inUpdate = true; for (const it of this.items) this._free(it); this._inUpdate = false; this._drawPaths();
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
    const C = this.cfg; this._inUpdate = true;
    // ---- schedule / windup
    if (this.windup) {
      const w = this.windup, it = w.it; w.t += dt;
      boss.throwPoint(it.pos); it.p.root.position.copy(it.pos);
      it.p.setGlow(0.5 + 0.5 * Math.abs(Math.sin(w.t * 14))); it.p.update(dt); it.p.root.lookAt(chest);
      this.planHeld(it, flightTimeFor(it.pos.distanceTo(chest), C), null, C.gravity, w.t / (C.windup + GREEN_MANIAC_THROW_RELEASE)); // v1.1 path preview
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
      if (it.trk) this._track(it, chest, playerVel, dt); // v1.1 soft tracking (off: the v1.0 ballistic flight, untouched)
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
    this._inUpdate = false;
    this._pChest.copy(chest); this._pVel.copy(playerVel); this._pTime += dt; this._pReady = true;
    this._drawPaths();
  }
  /** v1.1: one step of the soft tracking (src/game/bombPath.js). Once off it stays off (let-go window, passed the player). */
  _track(it, chest, playerVel, dt) {
    const K = this.trackCfg, tRem = it.T - (it.t - dt);
    if (!tracking(tRem, it.pos.distanceTo(chest), passedPlayer(it.pos, it.vel, chest), K)) { it.trk = false; return; }
    trackedAim(it.aim0, chest, playerVel, tRem, it.off, K, it.target);
    steer(it.pos, it.vel, it.target, tRem, it.g ?? this.cfg.gravity, it.kind === 'giant' ? K.accel.giant : K.accel.normal, dt, it.vel);
  }
  /**
   * v1.1 path preview for a pumpkin still in his hand: the flight it would take if released this frame (flight time T,
   * spread offset `offset` or null, gravity g), k = 0 … 1 how far the telegraph is (the path fades in over it).
   */
  planHeld(it, T, offset, g, k) {
    if (!it?.active || it.phase !== 'held') return;
    it.plan = true; it.pT = T; it.pG = g ?? this.cfg.gravity; it.pK = Math.max(0, Math.min(1, k)); if (offset) it.pOff.copy(offset); else it.pOff.set(0, 0, 0);
  }
  /** v1.1: rebuild this chase's paths (every frame at the end of update, and when a pumpkin goes between frames). */
  _drawPaths() {
    const R = this.paths; if (!R || !this._pReady) return;
    const P = this.pathCfg, op = P.opacity; let n = 0;
    if (settings.bombPath !== false) {
      const chest = this._pChest, vel = this._pVel;
      for (const it of this.items) {
        if (!it.active || n >= R.recs.length) continue;
        const rec = R.recs[n];
        if (it.phase === 'fly') {
          const g = it.g ?? this.cfg.gravity, tRem = it.T - it.t; if (!(tRem > 0.02)) continue;
          samplePath(it.pos, it.vel, g, tRem, rec.n, rec.pts);
          rec.alpha = it.relA + (op.flying - it.relA) * Math.min(1, it.t / P.fadeIn);
        } else if (it.phase === 'held' && it.plan) {
          bombAimPoint(chest, vel, it.pT, this.cfg, _pa).add(it.pOff);
          launchVelocity(it.pos, _pa, it.pT, it.pG, _pv);
          samplePath(it.pos, _pv, it.pG, it.pT, rec.n, rec.pts);
          rec.alpha = op.held * it.pK;
        } else continue;
        rec.kind = it.kind === 'giant' ? 'giant' : 'normal'; n++;
      }
    }
    R.count = n;
    const cam = this.app.camera; if (cam?.getWorldPosition) cam.getWorldPosition(this._pHead); else this._pHead.copy(this._pChest).add(_up35);
    this.pathFx.commit(this._pHead, this._pTime);
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
    it.relA = this.pathCfg.opacity.held * (it.plan ? it.pK : 1); it.plan = false; // v1.1: the held path becomes the flying one without a jump
    it.T = T; it.aim0.copy(target); if (opts.offset) it.off.copy(opts.offset); else it.off.set(0, 0, 0); it.trk = settings.bombTracking !== false; // v1.1 tracking state (the release itself is v1.0's)
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
  clear() { this._inUpdate = true; for (const it of this.items) this._free(it); this.windup = null; this._inUpdate = false; this._drawPaths(); }
  /** v0.40 floating origin: flying bombs move with the world. */
  shift(dx, dz) { for (const it of this.items) if (it.active) { it.pos.x += dx; it.pos.z += dz; it.p.root.position.x += dx; it.p.root.position.z += dz; if (it.target) { it.target.x += dx; it.target.z += dz; } it.aim0.x += dx; it.aim0.z += dz; } this._pChest.x += dx; this._pChest.z += dz; } // (v1.1: + the release aim and the last chest of the paths)
}
void _w;
