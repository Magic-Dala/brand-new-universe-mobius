// v0.41 World Chase Light Bomb (藍光炸彈) — the Arcade skill in free (beat-less) chase combat.
// Input is the one shared implementation in src/input/hub.js + gestures.js (hands: fist → forward throw → open;
// controllers: squeeze hold → swing → release; desktop: hold / release Space). The cooldown is enforced there too
// (hub context `bombLocked`: no charge can start while cooling down, and a held fist never re-throws — the gesture
// machine re-arms only after the hand opens). Same cyan model (createLightBomb), sounds and VFX as the Arcade.
// Flights: homing toward a locked target (assist cone around the throw) or a free ballistic throw that carries the
// player's velocity. Contact is swept every frame (pumpkins, Green Maniac, buildings); each bomb explodes once and
// its blast applies damage once (no double counting from contact + explosion).
import * as THREE from 'three';
import { audio } from '../core/audio.js';
import { createLightBomb } from '../art/enemies.js';
import { CHASE_COMBAT, selectTarget, sweptHit } from './chaseCombat.js';

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _d = new THREE.Vector3();
const LB = CHASE_COMBAT.lightBomb;

export class ChaseLightBombs {
  constructor(app) {
    this.app = app;
    this.root = new THREE.Group(); this.root.name = 'chaseLightBombs'; app.scene.add(this.root);
    this.pool = [];
    for (let i = 0; i < 4; i++) { const lb = createLightBomb(); lb.root.visible = false; this.root.add(lb.root); this.pool.push({ lb, active: false, pos: new THREE.Vector3(), prev: new THREE.Vector3(), vel: new THREE.Vector3(), target: null, t: 0, id: 0 }); }
    this.orbs = { left: createLightBomb(), right: createLightBomb() };
    for (const h of ['left', 'right']) { this.orbs[h].root.visible = false; this.root.add(this.orbs[h].root); }
    this.reset();
  }
  reset() { for (const f of this.pool) this._free(f); this.readyAt = 0; this.clock = 0; this.seq = 0; this.stats = { thrown: 0, hitsBoss: 0, pumpkins: 0, fizzles: 0 }; this.hideOrbs(); }
  get ready() { return this.clock >= this.readyAt; }
  /** 0 … 1 (1 = ready) for the HUD. */
  get readiness() { return this.ready ? 1 : 1 - (this.readyAt - this.clock) / LB.cooldown; }
  hideOrbs() { for (const h of ['left', 'right']) this.orbs[h].root.visible = false; }
  _free(f) { f.active = false; f.lb.root.visible = false; f.target = null; }
  get active() { return this.pool.filter((f) => f.active); }

  /**
   * ctx: { events, clock, allowThrow, bombs (ChaseBombs), boss: { pos, radius, valid }, playerVel, world, onBossHit(dmg, at, id),
   *        onPumpkin(it) }
   */
  update(dt, ctx) {
    this.clock = ctx.clock;
    const hub = this.app.hub;
    for (const e of ctx.events) {
      if (e.type === 'bombCharge') { if (ctx.allowThrow && this.ready) audio.play('charge'); }
      else if (e.type === 'bombFizzle') audio.play('fizzle');
      else if (e.type === 'bombThrow') { if (ctx.allowThrow && this.ready) this._throw(e, ctx); else audio.play('fizzle'); }
    }
    // charge orbs in the hand (same as the Arcade)
    for (const h of ['left', 'right']) {
      const o = this.orbs[h], c = ctx.allowThrow ? hub.bombCharge[h] : 0;
      o.root.visible = c > 0 && hub.grip[h].valid;
      if (o.root.visible) { o.root.position.copy(hub.grip[h].pos); o.setCharge(c); o.root.scale.setScalar(0.5 + 0.6 * c); o.update(dt); }
    }
    for (const f of this.pool) if (f.active) this._fly(f, dt, ctx);
  }
  /** Assisted target for a throw along dir (pumpkins that threaten first, then Green Maniac). */
  pick(origin, dir, ctx) {
    const cands = [];
    for (const it of ctx.bombs.items) if (it.active && it.phase === 'fly') cands.push({ pos: it.pos, vel: it.vel, radius: it.kind === 'giant' ? (ctx.heavyRadius ?? 1.7) : LB.pumpkinRadius, key: `p${it.id}`, it });
    if (ctx.core?.valid) cands.push({ pos: ctx.core.pos, radius: ctx.core.radius + 0.4, key: 'core', boss: true, core: true }); // v0.42: the open power core replaces the body as the target
    else if (ctx.boss?.valid) cands.push({ pos: ctx.boss.pos, radius: ctx.boss.radius, key: 'boss', boss: true });
    const head = this.app.camera.getWorldPosition(_w), fwd = _d.set(0, 0, -1).applyQuaternion(this.app.camera.getWorldQuaternion(new THREE.Quaternion()));
    const w = ctx.world;
    return selectTarget(origin, dir, cands, { coneDeg: LB.lockDeg, maxRange: LB.lockRange, minRange: 0.5, head, headFwd: fwd, chest: ctx.chest, imminent: CHASE_COMBAT.aim.imminent,
      occluded: (o, p) => !!w?.segmentBlocked(o.x, o.y, o.z, p.x, p.y, p.z) });
  }
  _throw(e, ctx) {
    const f = this.pool.find((x) => !x.active); if (!f) return;
    const vel = (e.worldVelocity || e.dir.clone().multiplyScalar(3)).clone();
    const vdir = vel.lengthSq() > 1e-6 ? vel.clone().normalize() : e.dir.clone();
    const pick = this.pick(e.origin, vdir, ctx) || this.pick(e.origin, e.dir, ctx); // throw direction first, then the wrist aim
    this.readyAt = this.clock + LB.cooldown;
    f.active = true; f.t = 0; f.id = ++this.seq; f.done = false;
    f.pos.copy(e.origin); f.prev.copy(e.origin);
    f.target = pick ? pick.cand : null;
    if (f.target) f.vel.copy(f.target.pos).sub(e.origin).setLength(LB.homingSpeed);
    else f.vel.copy(e.dir.clone().lerp(vdir, 0.5).normalize()).multiplyScalar(LB.speed).add(ctx.playerVel || _v.set(0, 0, 0));
    f.lb.root.visible = true; f.lb.setCharge(1); f.lb.root.position.copy(f.pos); f.lb.root.scale.setScalar(1.3);
    this.app.fx.vfx?.blueTrail(f.lb.root);
    audio.play('throw'); this.app.hub.haptic?.(e.hand, 0.6, 40);
    this.stats.thrown++;
    this.lastPick = pick ? (pick.cand.core ? 'core' : pick.cand.boss ? 'boss' : 'pumpkin') : 'free';
  }
  _fly(f, dt, ctx) {
    f.t += dt; f.prev.copy(f.pos);
    const tg = f.target;
    if (tg && (tg.core ? ctx.core?.valid : tg.boss ? ctx.boss?.valid : tg.it?.active && tg.it.phase === 'fly')) { // homing: re-read the moving target
      const sp = Math.max(LB.homingSpeed, (ctx.playerVel?.length() || 0) + 14);
      _v.copy(tg.pos).sub(f.pos); const L = _v.length();
      f.vel.lerp(_v.multiplyScalar(sp / Math.max(L, 1e-3)), Math.min(1, dt * 10));
    } else { if (tg) f.target = null; f.vel.y -= LB.gravity * dt; }
    f.pos.addScaledVector(f.vel, dt);
    f.lb.root.position.copy(f.pos); f.lb.update(dt);
    // swept contact: pumpkins, Green Maniac, buildings (first contact wins)
    let hitAt = -1;
    for (const it of ctx.bombs.items) {
      if (!it.active || it.phase !== 'fly') continue;
      const k = sweptHit(f.prev, f.pos, it.prev, it.pos, it.kind === 'giant' ? (ctx.heavyRadius ?? 1.7) : LB.pumpkinRadius); if (k >= 0 && (hitAt < 0 || k < hitAt)) hitAt = k;
    }
    if (ctx.boss?.valid) { const k = sweptHit(f.prev, f.pos, ctx.boss.prev || ctx.boss.pos, ctx.boss.pos, ctx.boss.radius); if (k >= 0 && (hitAt < 0 || k < hitAt)) hitAt = k; }
    if (ctx.core?.valid) { const k = sweptHit(f.prev, f.pos, ctx.core.pos, ctx.core.pos, ctx.core.radius); if (k >= 0 && (hitAt < 0 || k < hitAt)) hitAt = k; }
    const w = ctx.world;
    if (w && (w.segmentBlocked(f.prev.x, f.prev.y, f.prev.z, f.pos.x, f.pos.y, f.pos.z, null, null, 0) || w.pointBlocked(f.pos.x, f.pos.y, f.pos.z, 0.1))) hitAt = hitAt < 0 ? 0.999 : hitAt;
    if (hitAt >= 0) { f.pos.lerpVectors(f.prev, f.pos, hitAt); this._explode(f, ctx); return; }
    if (f.t >= LB.life || f.pos.y < 0.2) this._explode(f, ctx);
  }
  /** One blast per bomb: pumpkins in the radius with a clear line are destroyed; Green Maniac is damaged once. */
  _explode(f, ctx) {
    if (f.done) return; f.done = true;
    const at = f.pos, fx = this.app.fx, w = ctx.world, R = LB.blastRadius;
    fx.vfx?.blueBomb(at, { size: 1.15 }) || fx.boom(at, { color: 0x5fd8ff, size: 1.6 });
    audio.play('boomBlue');
    const clear = (p) => !w || !w.segmentBlocked(at.x, at.y, at.z, p.x, p.y, p.z);
    let n = 0;
    for (const it of ctx.bombs.items) if (it.active && it.phase === 'fly' && it.pos.distanceTo(at) <= R + (it.kind === 'giant' ? (ctx.heavyRadius ?? 1.7) : LB.pumpkinRadius) && clear(it.pos)) { ctx.bombs.shootDown(it, at, 'bomb'); ctx.onPumpkin?.(it); n++; }
    this.stats.pumpkins += n;
    // v0.42: one boss hit per bomb; 'core' when the blast reaches the open core, else 'body' (the fight decides the effect)
    const onCore = ctx.core?.valid && ctx.core.pos.distanceTo(at) <= R * 0.75 + ctx.core.radius && clear(ctx.core.pos);
    if (ctx.boss?.valid && (onCore || (ctx.boss.pos.distanceTo(at) <= R + ctx.boss.radius && clear(ctx.boss.pos)))) { this.stats.hitsBoss++; if (onCore) this.stats.hitsCore = (this.stats.hitsCore || 0) + 1; ctx.onBossHit?.(CHASE_COMBAT.boss.lightBombDamage, at.clone(), `lb${f.id}`, onCore ? 'core' : 'body'); }
    else if (!n) this.stats.fizzles++;
    this._free(f);
  }
  clear() { for (const f of this.pool) this._free(f); this.hideOrbs(); }
  shift(dx, dz) { for (const f of this.pool) if (f.active) { f.pos.x += dx; f.pos.z += dz; f.prev.x += dx; f.prev.z += dz; f.lb.root.position.copy(f.pos); } }
}
