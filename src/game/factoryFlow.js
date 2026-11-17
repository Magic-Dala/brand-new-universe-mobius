// Story: factory roof → bomb → fall → black Loading → separate factory interior → boss → escape.
// Explicit state machine (condition / event driven, never a blind timer chain):
//   Chase ⇄ JetTether → TetherCounter → FactoryRoofApproach → RoofStandoff → RoofWebDash   (chase.js)
//   → KickAndLand → BossBombThrow (giant) → RoofExplosion → ShortFall → FadeToBlack (this file, city world)
//   → LoadingInterior                                         (App.loadFactoryWorld job, black screen)
//   → InteriorArrival → AwaitArenaCircle → BossEncounter      (this file, interior world → arcade)
//   → BossEscape → FollowToDoor → ExitTransition              (v0.20: door break, then the endless city)
// Rules: the roof event fires ONCE per run (guarded, only after a real dash contact), exactly ONE giant bomb, no attacks / webs /
// scoring during the event, the rig origin is the only thing moved (head tracking untouched,
// no roll / rotation / shake), the interior checkpoint makes Boss retries reset the interior only.
import * as THREE from 'three';
import { t } from '../core/i18n.js';
import { audio } from '../core/audio.js';
import { settings } from '../core/settings.js';
import { COLORS } from '../ui/panel.js';
import { KEY_BUILDINGS, FACTORY_EXT, STORY } from '../data/layout.js';
import { INTERIOR } from '../data/factory.js';
import { worldToBox, boxToWorld } from '../data/box.js';
import { canvasTexture, rng } from '../art/toon.js';
import { Billboards } from '../art/particles.js';
import { createPumpkinBomb, GREEN_MANIAC_THROW_RELEASE } from '../art/enemies.js';
import { STORY_COMBAT } from '../data/storyCombat.js';
import { TUTORIAL_PANEL } from '../data/tutorials.js';
const RF = STORY_COMBAT.roof;
import { toonMaterial } from '../art/toon.js';

export const FLOW_STATES = ['Chase', 'JetTether', 'TetherCounter', 'FactoryRoofApproach', 'RoofStandoff', 'RoofWebDash', 'KickAndLand', 'BossBombThrow', 'RoofExplosion', 'ShortFall', 'FadeToBlack', 'LoadingInterior', 'InteriorArrival', 'AwaitArenaCircle', 'BossEncounter', 'BossEscape', 'FollowToDoor', 'ExitTransition', 'EndlessChase', 'EndlessSwing'];
// interior-local door frame (north wall, roll-up door 7 × 7.5 m) and the follow marker in front of it
const DOOR = { x: 0, z: -18, w: 7, h: 7.5 }, DOOR_MARK = { x: 0, z: -15.2, r: 1.5 };
const C = KEY_BUILDINGS[1];
// Green Maniac throw animation release time (s): GREEN_MANIAC_THROW_RELEASE (follows the loaded throw clip)
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4();
const _q2v = new THREE.Vector3(), _q2a = new THREE.Vector3(), _q2b = new THREE.Vector3(), _q2c = new THREE.Vector3();
const ESC_SPIN = 0.62; // s: the turn clip's spin (1.7× speed) — the jet swings round in the same time

/** Is the rig ORIGIN (not just the head) inside a circle (xz)? */
export function rigInside(rigPos, center, radius) { return Math.hypot(rigPos.x - center[0], rigPos.z - center[2]) <= radius; }

export class FactoryFlow {
  constructor(story) {
    this.story = story; this.app = story.app;
    this.root = new THREE.Group(); this.root.name = 'factoryFlow'; this.app.scene.add(this.root);
    // roof blast particles (city world) — one draw call each
    this.smoke = new Billboards(40, { color: 0x4a4048, gravity: -0.6, drag: 0.6, name: 'RoofSmoke' });
    this.sparks = new Billboards(48, { color: 0xffb050, additive: true, gravity: 7, drag: 0.3, name: 'RoofSparks' });
    this.root.add(this.smoke.mesh, this.sparks.mesh);
    const debrisMat = toonMaterial({ color: 0x4a4c58 }); debrisMat.name = 'roof-debris';
    this.debris = [];
    for (let i = 0; i < 8; i++) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.6 + (i % 3) * 0.35, 0.06, 0.45 + (i % 2) * 0.4), debrisMat); m.visible = false; this.root.add(m); this.debris.push({ m, v: new THREE.Vector3(), w: new THREE.Vector3(), on: false }); }
    // roll-up door slats (escape): pre-made pieces, short ballistic animation (no real-time destruction)
    const slatMat = toonMaterial({ color: 0x4a4c56 }); slatMat.name = 'door-slats';
    this.slats = [];
    for (let i = 0; i < 10; i++) { const m = new THREE.Mesh(new THREE.BoxGeometry(1.4 + (i % 3) * 0.9, 0.08, 0.32), slatMat); m.visible = false; this.root.add(m); this.slats.push({ m, v: new THREE.Vector3(), w: new THREE.Vector3(), on: false }); }
    this._buildArenaCircle();
    this.reset();
  }
  reset() {
    this.state = null; this.stateTime = 0; this.roofFired = false; this.bombsThrown = 0; this.explosions = 0;
    this.checkpoint = null; this.dwell = 0; this.countdown = null; this._tutWait = false; this._released = false; this._pausedFade = false;
    this.bomb = null; this.fall = null; this.kick = null; this.phase = null; this.pickup = null;
    if (this.giant) this.giant.root.visible = false;
    this.smoke.clear(); this.sparks.clear(); for (const d of this.debris) { d.on = false; d.m.visible = false; }
    this.arena.visible = false;
    this.hum?.stop(); this.hum = null;
    for (const d of this.slats || []) { d.on = false; d.m.visible = false; }
    if (this.outside) this.outside.visible = false;
    this.doorMarkerPos = null;
    this.setRoof('intact');
    this.app.city?.factory?.setDoorState?.('closed');
  }
  get active() { return !!this.state; }
  setState(s) {
    this.state = s; this.stateTime = 0;
    if (s === 'AwaitArenaCircle') this.app.boss?.maniac.setState('stretch'); // v4: stretches while waiting for the player
  }
  setRoof(s) {
    const app = this.app, B = FACTORY_EXT.breach;
    app.city.factory?.setRoofState(s);
    // controlled destruction: ONLY the blown section loses its collision (the rest of the roof stays solid)
    app.locomotion.setRoofHole('C', s === 'broken' ? { x0: B.local[0] - B.hw, x1: B.local[0] + B.hw, z0: B.local[1] - B.hd, z1: B.local[1] + B.hd } : null);
  }

  // =============================================================== roof event (city world)
  /**
   * v0.21: called ONCE by Story.onChaseComplete after the web dash really touched Green Maniac (chase.js).
   * kick = { point, vel } at contact. Repeated calls are ignored.
   *   KickAndLand: he is kicked off the jet and falls onto the roof; Mobius glides down onto the circle;
   *   the empty jet wobbles aside → BossBombThrow: he recovers, pulls the GIANT pumpkin bomb (story prop,
   *   not part of the chase bomb pool), tosses it between them → RoofExplosion → ShortFall → FadeToBlack.
   */
  startRoofEvent(kick = null) {
    if (this.roofFired || this.state || !kick) return false; // only a real dash contact starts it
    this.roofFired = true;
    const app = this.app, loco = app.locomotion, boss = app.boss, R = RF;
    this.story.allowAttack = false; this.story.allowLocomotion = false;
    loco.detach(true); loco.off(); loco.scripted = false; app.fx.clear();
    app.boss.setVisible(true); app.boss.jet.setThrust(0.9);
    this.hum = this.hum || audio.startJetHum?.();
    const c = STORY.circle.pos, B = FACTORY_EXT.breach;
    const feet = loco.feet(new THREE.Vector3());
    const kv = kick?.vel ? kick.vel.clone().setY(0) : _v.set(c[0], 0, c[2]).sub(feet).setY(0);
    if (kv.lengthSq() < 1e-4) kv.set(1, 0, 0); kv.normalize();
    // landing spots: Mobius on the circle (the breakable section); Green Maniac KNOCKED BACK along the kick — v6: at least
    // R.knockback m from where he was hit and always OUTSIDE the breakable section (+R.breachClear), on the roof, off the
    // equipment: the blast only takes Mobius down, never Green Maniac (his jet picks him up afterwards)
    boss.root.updateMatrixWorld(true);
    const mStart = boss.maniac.root.getWorldPosition(new THREE.Vector3());
    this.landP = new THREE.Vector3(c[0], C.h, c[2]);
    const okLand = (x, z) => {
      const [lx, lz] = worldToBox(C, x, z);
      if (Math.abs(lx) > C.hw - R.roofEdge || Math.abs(lz) > C.hd - R.roofEdge) return false; // on the roof
      if (Math.abs(lx - B.local[0]) < B.hw + R.breachClear && Math.abs(lz - B.local[1]) < B.hd + R.breachClear) return false; // not on / next to the section
      return !FACTORY_EXT.equipment.some((q) => lx > q.x0 - 0.6 && lx < q.x1 + 0.6 && lz > q.z0 - 0.6 && lz < q.z1 + 0.6);
    };
    let found = null;
    for (const da of [0, 0.35, -0.35, 0.7, -0.7, 1.05, -1.05, 1.4, -1.4]) { // prefer the kick direction, turn as little as needed
      const dir = _w.copy(kv).applyAxisAngle(THREE.Object3D.DEFAULT_UP, da);
      const kx = settings.roofKnockExtra ?? 1; /* v0.31b: he lands kx m further from Mobius (first clear spot + kx along the kick) */
      for (let d = R.knockback; d <= R.knockbackMax && !found; d += 0.25) if (okLand(mStart.x + dir.x * d, mStart.z + dir.z * d)) {
        let dd = d + kx; while (dd > d && !okLand(mStart.x + dir.x * dd, mStart.z + dir.z * dd)) dd -= 0.25; // stay on the roof / off equipment
        found = new THREE.Vector3(mStart.x + dir.x * dd, C.h, mStart.z + dir.z * dd); }
      if (found) break;
    }
    this.landM = found || new THREE.Vector3(...boxToWorld(C, B.local[0] + B.hw + R.breachClear + 0.5, C.h, B.local[1])); // (fallback: just off the section)
    const kb = new THREE.Vector3(this.landM.x - mStart.x, 0, this.landM.z - mStart.z), kbLen = kb.length(); if (kbLen > 1e-4) kb.divideScalar(kbLen); else kb.copy(kv);
    this.touchM = this.landM.clone().addScaledVector(kb, -Math.min(R.maniacSlide, kbLen * 0.4)); // touch-down, then he slides to landM
    this.knockDist = kbLen;
    // the giant bomb lands just in front of Mobius (toward Green Maniac), inside the breakable section
    { const tm = _v.set(this.landM.x - this.landP.x, 0, this.landM.z - this.landP.z); if (tm.lengthSq() > 1e-4) tm.normalize();
      const [ix, iz] = worldToBox(C, this.landP.x + tm.x * R.bombAhead, this.landP.z + tm.z * R.bombAhead);
      this.impact = new THREE.Vector3(...boxToWorld(C, THREE.MathUtils.clamp(ix, B.local[0] - B.hw + 1, B.local[0] + B.hw - 1), C.h + 0.3, THREE.MathUtils.clamp(iz, B.local[1] - B.hd + 1, B.local[1] + B.hd - 1))); }
    this.pickup = null;
    // the kick: Green Maniac off the jet (keeps his size), the empty jet loses balance and drifts aside
    boss.dismount(mStart, feet);
    boss.maniac.setState('fall'); // fall clip: ground contact at 0.85 s = maniacFallTime (head away from the kick)
    const side = new THREE.Vector3(-kv.z, 0, kv.x);
    this.jetFrom = boss.root.position.clone();
    this.jetTo = boss.root.position.clone().addScaledVector(side, R.jetDrift[0]).add(_v.set(0, R.jetDrift[1], 0));
    this.kick = { t: 0, pFrom: feet.clone(), pMid: feet.clone().addScaledVector(kick?.vel || kv, 0.18).setY(Math.min(feet.y + 1.2, Math.max(feet.y, this.landP.y + 1.5))), mFrom: mStart, landedP: false, landedM: false, recoverT: 0, slideT: 0, gettingUp: false, up: false };
    this.giantThrows = 0; this.bombsThrown = 0;
    this.phase = 'kick';
    this.setState('KickAndLand');
    this.story.objective(t('story.roof.watch'));
    app.hud.showBanner(t('story.roof.kick'), 1.8, COLORS.perfect, t('char.hero'));
    return true;
  }
  /** Pause menu → Restart during the roof event: back to the roof standoff (Green Maniac on the jet over the circle). */
  restartRoofEvent() {
    this.hum?.stop(); this.hum = null;
    this.story.restartRoofFinale();
  }
  _giantBomb() {
    if (!this.giant) { this.giant = createPumpkinBomb({ model: 'giant' }); this.giant.root.scale.setScalar(RF.giantScale); this.giant.root.visible = false; this.root.add(this.giant.root); }
    return this.giant;
  }

  _updateRoof(dt, tNow) {
    const app = this.app, boss = app.boss, head = app.camera.getWorldPosition(_w).clone(), R = RF;
    switch (this.state) {
      case 'KickAndLand': {
        const K = this.kick; K.t += dt;
        // Mobius: decelerated glide from the contact point onto the circle (rig origin only; no rotation)
        const k = Math.min(1, K.t / R.landTime), e = 1 - (1 - k) * (1 - k);
        const p = _v.copy(K.pFrom).multiplyScalar((1 - e) * (1 - e)).addScaledVector(K.pMid, 2 * (1 - e) * e).addScaledVector(this.landP, e * e);
        const feet = app.locomotion.feet(new THREE.Vector3());
        app.world.player.position.add(p.sub(feet)); app.world.player.updateMatrixWorld(true);
        if (k >= 1 && !K.landedP) { K.landedP = true; audio.play('land'); app.locomotion.grounded = true; app.locomotion.vel.set(0, 0, 0); }
        // Green Maniac (v5): knocked back off the jet → flies along the kick, touches down, slides to a stop, lies a
        // moment, gets up (getup clip) — facing the player — and only then the giant bomb (BossBombThrow)
        const mk = Math.min(1, K.t / R.maniacFallTime), m = boss.maniac.root;
        if (!K.landedM) {
          const e = 1 - (1 - mk) * (1 - mk * 0.35); // fast off the kick, slowing toward the roof
          m.position.lerpVectors(K.mFrom, this.touchM, e); m.position.y += Math.sin(mk * Math.PI) * 1.2 * (1 - mk * 0.3);
          m.lookAt(head.x, m.position.y, head.z); // root +Z → player: the fall clip drops him head-away from the kick
          if (mk >= 1) { K.landedM = true; m.position.copy(this.touchM); audio.play('land'); audio.play('debris'); this.smoke.spawn(_v.copy(this.touchM).add(_w.set(0, 0.3, 0)), _w.set(0, 0.8, 0), { life: 1.4, size: [0.8, 2.2], alpha: 0.5 }); }
        } else if (K.slideT < R.slideTime) { // skids across the roof (decelerating)
          K.slideT = Math.min(R.slideTime, K.slideT + dt); const s = K.slideT / R.slideTime;
          m.position.lerpVectors(this.touchM, this.landM, 1 - (1 - s) * (1 - s));
          if (Math.random() < dt * 25) this.smoke.spawn(_v.copy(m.position).add(_w.set((Math.random() - 0.5) * 0.6, 0.15, (Math.random() - 0.5) * 0.6)), _w.set(0, 0.5, 0), { life: 0.9, size: [0.4, 1.2], alpha: 0.4 });
        } else {
          K.recoverT += dt;
          if (!K.gettingUp && K.recoverT >= R.recoverTime) { K.gettingUp = true; boss.maniac.setState('getup'); }
          if (K.gettingUp) { // he turns his head/body toward the player while getting up (lying: no spinning on the ground)
            _q.setFromRotationMatrix(_m.lookAt(_v.set(head.x, m.position.y, head.z), m.position, _w.set(0, 1, 0)));
            m.quaternion.slerp(_q, 1 - Math.exp(-dt * 1.5));
            if (boss.maniac.state !== 'getup') K.up = true; // clip done (fading back to wait)
          }
        }
        // the empty jet: wobbles, drifts aside (out of the line of sight and the landing)
        const jk = Math.min(1, K.t / 1.4);
        boss.root.position.lerpVectors(this.jetFrom, this.jetTo, 1 - (1 - jk) * (1 - jk));
        boss.face(head, 1 - Math.exp(-dt * 2)); boss.bank(Math.sin(K.t * 7) * 0.5 * (1 - jk), 1); boss.update(dt, tNow);
        this.hum?.setLevel(0.5);
        // v7: up again → an angry fit first (angry clip), THEN he pulls the giant bomb from behind his back and throws
        if (K.landedP && K.up && !K.angry) { K.angry = true; boss.maniac.setState('angry'); }
        if (K.landedP && K.angry && boss.maniac.state !== 'angry') {
          boss.maniac.setState('stand');
          this.phase = 'draw'; this.phaseT = 0;
          const g = this._giantBomb(); g.root.visible = false; g.root.scale.setScalar(RF.giantScale * 0.55); g.setGlow(0.3); this._backPoint(g.root.position, 0.35); /* v0.31b: hidden behind his back until he reaches for it */
          app.fx.vfx?.giantCharge(g); // v0.30 vfx: grinning face brightens, embers sucked in (until the blast hides it)
          this.bombsThrown = 1; this.giantThrows = 1;
          app.hud.showBanner(t('story.roof.giant'), 2.4, COLORS.bad, t('char.boss')); audio.play('alarm');
          this.setState('BossBombThrow');
        }
        break;
      }
      case 'BossBombThrow': { // the GIANT pumpkin: readable wind-up, short toss between them, fuse, blast
        const g = this._giantBomb(), m = boss.maniac.root;
        this.phaseT += dt;
        m.lookAt(head.x, m.position.y, head.z); boss.update(dt, tNow);
        if (!this.bomb && !this.pickup) boss.flyToward(this.jetTo, 3, dt, tNow, head); // the jet idles aside
        else this._pickupManiac(dt, tNow, head); // v6: bomb away → his jet comes back for him (he never falls in)
        if (this.phase === 'draw') { // v7: from behind his back over his shoulder into the throwing hand, then the throw
          const k = Math.min(1, this.phaseT / R.drawTime), e = k * k * (3 - 2 * k);
          // v0.31b: the first 30% it stays out of sight behind his back, then it comes up over his shoulder (growing to full size)
          const show = THREE.MathUtils.smoothstep(k, 0.3, 0.65); g.root.visible = k >= 0.3; g.root.scale.setScalar(RF.giantScale * (0.55 + 0.45 * show));
          this._backPoint(_q2a, 0.35 * (1 - show)); boss.maniac.throwHand.getWorldPosition(_v).add(_w.set(0, 0.25, 0));
          const ee = THREE.MathUtils.smoothstep(k, 0.3, 1.0);
          g.root.position.lerpVectors(_q2a, _v, ee); g.root.position.y += Math.sin(Math.PI * ee) * 0.45; g.root.lookAt(head);
          g.setGlow(0.5 + 0.5 * Math.abs(Math.sin(this.phaseT * 9))); g.update(dt);
          if (k >= 1) { boss.maniac.setState('throw'); this.phase = 'throw'; this.phaseT = 0; }
        } else if (this.phase === 'throw') {
          if (!this.bomb && this.phaseT >= GREEN_MANIAC_THROW_RELEASE) { this.bomb = { from: g.root.position.clone(), t: 0, landed: 0 }; audio.play('throwEnemy'); }
          if (!this.bomb) { boss.maniac.throwHand.getWorldPosition(_v); g.root.position.copy(_v).add(_w.set(0, 0.25, 0)); }
          else {
            const b = this.bomb;
            if (b.t < R.tossTime) { b.t = Math.min(R.tossTime, b.t + dt); const kk = b.t / R.tossTime; g.root.position.lerpVectors(b.from, this.impact, kk); g.root.position.y += Math.sin(Math.PI * kk) * 1.2; g.root.rotation.y += dt * 3; }
            else { b.landed += dt; g.setGlow(0.5 + 0.5 * Math.sin(b.landed * 30)); if (b.landed >= R.fuse) this._explode(); }
          }
          g.update(dt);
        }
        break;
      }
      case 'RoofExplosion':
        this._pickupManiac(dt, tNow, head);
        if (this.stateTime >= 0.45) this._startFall(); // the player sees the blast before falling
        break;
      case 'ShortFall':
      case 'FadeToBlack': {
        const F = this.fall, rig = app.world.player;
        // move ONLY the rig origin (gentle ease-in, capped speed); head tracking untouched
        F.v = Math.min(F.vMax, F.v + 8 * dt); F.y = Math.min(F.depth, F.y + F.v * dt);
        rig.position.y = F.y0 - F.y; rig.updateMatrixWorld(true);
        // v6: Green Maniac is NOT in the blast: his jet picks him up off the roof and he hovers over the hole, watching
        // Mobius fall (inside, he flies in through the breach on the jet — InteriorArrival)
        this._pickupManiac(dt, tNow, head);
        if (Math.random() < dt * 12) this.smoke.spawn(_v.set(this.impact.x + (Math.random() - 0.5) * 3, C.h + 0.4, this.impact.z + (Math.random() - 0.5) * 3), _w.set(0, 1.4, 0), { life: 2.2, size: [1, 3], alpha: 0.6 });
        if (this.state === 'ShortFall' && F.y >= F.depth * 0.45) {
          this.setState('FadeToBlack');
          this.story.fadeTo(1, 1.6, () => { this._fadeDone = true; });
          this._fadeDone = false;
        }
        if (this.state === 'FadeToBlack' && this._fadeDone && F.y >= F.depth - 1e-3) {
          this.hum?.stop(); this.hum = null;
          this.story.enterStage('loadingInterior');
        }
        break;
      }
      default: break;
    }
    this._updateParticles(dt);
  }
  /** v7: a point just behind Green Maniac's back at chest height (where the giant bomb is pulled from). */
  _backPoint(out, extra = 0) {
    const m = this.app.boss.maniac; m.root.updateMatrixWorld(true); m.hitCenter.getWorldPosition(out);
    const back = _q2b.set(0, 0, -1).applyQuaternion(m.root.getWorldQuaternion(_q)).setY(0).normalize(); // root +Z faces Mobius
    return out.addScaledVector(back, RF.drawBack + extra).add(_q2c.set(0, 0.15 - extra * 0.6, 0));
  }
  /**
   * v6: after the giant bomb leaves his hand the empty jet flies back over Green Maniac; once its deck is right above
   * him he hops on (short arc, then remount) and the jet rises over the hole, facing down at Mobius.
   */
  _pickupManiac(dt, tNow, head) {
    const boss = this.app.boss, R = RF;
    if (boss.riding) { // aboard: hover above the hole, looking down at it
      const p = this.pickup?.hover || (this.pickup = { hover: new THREE.Vector3() }).hover;
      p.set(this.impact.x, C.h + 7.5, this.impact.z).addScaledVector(_v.set(this.landM.x - this.impact.x, 0, this.landM.z - this.impact.z).normalize(), 4);
      boss.flyToward(p, 4, dt, tNow, _w.set(this.impact.x, p.y - 2.5, this.impact.z)); // nose (gently) down at the hole
      return;
    }
    const P = this.pickup || (this.pickup = { hop: null, over: false }), m = boss.maniac.root;
    const want = _v.copy(m.position).add(_w.set(0, R.hopUp, 0)); // where the jet's deck (stand point) should be
    if (!P.hop) {
      boss.root.updateMatrixWorld(true);
      const deck = boss.jet.standPoint.getWorldPosition(_w);
      // approach from ABOVE him on the far side from Mobius (never across the player's face), then straight down
      const away = _q2a.set(m.position.x - head.x, 0, m.position.z - head.z); if (away.lengthSq() > 1e-4) away.normalize();
      if (!P.over) { const above = _q2b.copy(want).addScaledVector(away, 1.5).add(_q2c.set(0, 3.5, 0)); if (deck.distanceTo(above) < 1.5) P.over = true; else want.copy(above); }
      boss.flyToward(_q2v.copy(boss.root.position).add(want).sub(deck), R.pickupSpeed, dt, tNow, _q2c.copy(head).setY(boss.root.position.y));
      want.set(m.position.x, m.position.y + R.hopUp, m.position.z);
      boss.root.updateMatrixWorld(true);
      if (boss.jet.standPoint.getWorldPosition(_w).distanceTo(want) < 0.8) { P.hop = { t: 0, from: m.position.clone() }; audio.play('land'); }
    } else {
      P.hop.t += dt; const k = Math.min(1, P.hop.t / R.hopTime);
      boss.root.updateMatrixWorld(true); const deck = boss.jet.standPoint.getWorldPosition(_w);
      m.position.lerpVectors(P.hop.from, deck, k); m.position.y += Math.sin(Math.PI * k) * 0.7;
      boss.update(dt, tNow);
      if (k >= 1) { boss.remount(); boss.jet.setThrust(1); P.hop = null; }
    }
  }
  _explode() {
    if (this.state !== 'BossBombThrow') return; // repeated calls never re-explode
    const app = this.app, p = this.impact;
    this.explosions++;
    if (this.giant) this.giant.root.visible = false; this.bomb = null;
    const v30 = !!app.fx.vfx?.roofExplosion(p); // v0.30 vfx: staged dust → fire → debris → smoke column → embers
    if (!v30) { app.fx.boom(p, { color: 0xffb020, size: 2.8, life: 0.8 }); app.fx.boom(p.clone().add(_v.set(0, 0.6, 0)), { color: 0xff6a20, size: 1.8, life: 1.0 }); }
    audio.play('roofBlast'); audio.play('debris');
    for (const h of ['left', 'right']) app.hub.haptic?.(h, 0.8, 120);
    this.setRoof('broken'); // swap to the broken section, its collision removed (rest of the roof stays)
    if (!v30) for (let i = 0; i < 26; i++) { const a = Math.random() * Math.PI * 2; this.sparks.spawn(p, _v.set(Math.cos(a) * (2 + Math.random() * 4), 3 + Math.random() * 5, Math.sin(a) * (2 + Math.random() * 4)), { life: 0.8 + Math.random() * 0.6, size: [0.12, 0.04], alpha: 1 }); }
    if (!v30) for (let i = 0; i < 12; i++) this.smoke.spawn(_v.set(p.x + (Math.random() - 0.5) * 2, p.y + 0.3, p.z + (Math.random() - 0.5) * 2), _w.set((Math.random() - 0.5) * 1.5, 1.5 + Math.random() * 1.5, (Math.random() - 0.5) * 1.5), { life: 3, size: [1.2, 4], alpha: 0.7 });
    this.debris.forEach((d, i) => { // a few roof panels thrown up, then falling (into the hole or onto the roof)
      const a = (i / this.debris.length) * Math.PI * 2;
      d.on = true; d.m.visible = true; d.m.position.copy(p).add(_v.set(Math.cos(a) * 0.8, 0.2, Math.sin(a) * 0.8));
      d.v.set(Math.cos(a) * (1.5 + Math.random() * 2.5), 4 + Math.random() * 4, Math.sin(a) * (1.5 + Math.random() * 2.5)); d.w.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    });
    this.setState('RoofExplosion');
  }
  _startFall() {
    const app = this.app;
    this.fall = { y0: app.world.player.position.y, y: 0, v: 0, depth: settings.shortFall ? 2.0 : 6.0, vMax: settings.shortFall ? 3.5 : 6.0 };
    audio.play('creak');
    this.setState('ShortFall');
  }
  _updateParticles(dt) {
    this.smoke.update(dt); this.sparks.update(dt);
    const B = FACTORY_EXT.breach;
    for (const d of this.debris) {
      if (!d.on) continue;
      d.v.y -= 9.8 * dt; d.m.position.addScaledVector(d.v, dt); d.m.rotation.x += d.w.x * dt; d.m.rotation.y += d.w.y * dt; d.m.rotation.z += d.w.z * dt;
      const [bx, bz] = worldToBox(C, d.m.position.x, d.m.position.z), inHole = Math.abs(bx - B.local[0]) < B.hw && Math.abs(bz - B.local[1]) < B.hd;
      if (!inHole && d.m.position.y < C.h + 0.05 && Math.abs(bx) < C.hw && Math.abs(bz) < C.hd) { d.m.position.y = C.h + 0.05; d.v.set(0, 0, 0); d.w.set(0, 0, 0); d.on = false; } // rests on the intact roof
      if (d.m.position.y < C.h - 6.5) { d.on = false; d.m.visible = false; } // lost in the dark shaft
    }
  }
  /** Pausing during the fade: lift the black so the pause menu is visible; resume re-fades. */
  onPause() { if (this.state === 'FadeToBlack' || this.state === 'ShortFall') { this._pausedFade = true; this.story.fadeTo(0, 10); } this.hum?.setLevel(0); }
  onResume() { if (this._pausedFade) { this._pausedFade = false; if (this.state === 'FadeToBlack') this.story.fadeTo(1, 1.6, () => { this._fadeDone = true; }); } }

  // =============================================================== interior world
  /** Loading done: the interior is set up and ready → fade in and run the arrival. */
  beginInterior({ checkpoint = false } = {}) {
    const app = this.app, F = INTERIOR, interior = app.interior;
    this.checkpoint = { at: performance.now() };
    const sp = interior.toWorld(...F.spawn.pos);
    app.locomotion.setInteriorMode(app.interiorSurface, F.origin, F.size.h);
    app.locomotion.placeAt(sp, F.spawn.yaw);
    this.story.allowAttack = false; this.story.allowLocomotion = false; // no input until we fade in
    app.boss.remount(); app.boss.setVisible(true); app.boss.jet.setDamage(0); app.boss.jet.setThrust(1);
    app.boss.root.scale.setScalar(settings.arcadeBossScale); // indoor scale = the battle scale (no pop when the fight starts)
    if (this._door) this._door.visible = true; if (this.outside) this.outside.visible = false;
    this.dwell = 0; this.countdown = null; this._tutWait = false;
    this.arena.position.copy(interior.toWorld(...F.arenaCircle.pos)).add(_v.set(0, 0.03, 0));
    this.arena.visible = false;
    if (checkpoint) { // Boss retry / restart: the interior only (no city reload, no chase, no blast)
      app.boss.root.position.copy(interior.toWorld(...F.bossHover)); app.boss.face(app.camera.getWorldPosition(_w), 1);
      this.setState('AwaitArenaCircle'); this._promptArena();
      this.story.fadeTo(0, 2.5);
      app.hud.showBanner(t('story.factory.checkpoint'), 1.8, COLORS.text);
      this.story.allowLocomotion = true;
      return;
    }
    // arrival: engine overhead, a short entry through the breach, then the far-north hover
    this.entry = new THREE.CatmullRomCurve3(F.bossEntry.map((p) => interior.toWorld(...p)));
    app.boss.root.position.copy(this.entry.getPointAt(0));
    this.hum = audio.startJetHum?.();
    this.setState('InteriorArrival'); this._entryK = 0; this._landed = false;
    this.story.fadeTo(0, 0.9, () => { this._fadedIn = true; });
    this._fadedIn = false;
    audio.play('land'); interior.landingDust(sp.x, sp.z);
    app.hud.showBanner(t('story.factory.arrive'), 2.6, COLORS.warn, t('place.factory'));
  }
  /** Boss battle retry → back to the interior checkpoint (arena circle), boss at the north hover. */
  retryBoss() {
    const app = this.app;
    app.arcade.stop(); app.menus.hide(); app.hud.hideBanner(); app.fx.clear();
    app.state = 'story'; this.story.stage = 'factory'; this.story.paused = false;
    app.hud.setMode('story');
    this.story.fadeTo(1, 10);
    this.beginInterior({ checkpoint: true });
    // stand IN the circle again: the battle still needs a stable dwell + countdown to start
    const F = INTERIOR; app.locomotion.placeAt(app.interior.toWorld(...F.arenaCircle.pos), null);
  }
  _promptArena() {
    this.arena.visible = true;
    this.story.objective(t('story.obj.arenaCircle'), [t('tut.teleport')]);
    this.app.hud.showBanner(t('story.obj.arenaCircle'), 2.4, COLORS.perfect);
  }
  _updateInterior(dt, tNow) {
    const app = this.app, boss = app.boss, F = INTERIOR, head = app.camera.getWorldPosition(_w).clone();
    switch (this.state) {
      case 'InteriorArrival': {
        if (this._fadedIn && !this.story.allowLocomotion) this.story.allowLocomotion = true; // teleport allowed once visible (no attacks yet)
        // entry along the curve: banked through the hole, short "landing" hover, then north
        const hoverAt = 0.42;
        if (this.stateTime > 1.0) {
          if (!this._landed && this._entryK >= hoverAt) { this._landed = true; this._landT = 0; }
          if (this._landed && this._landT < 0.9) this._landT += dt;
          else this._entryK = Math.min(1, this._entryK + dt / 5.5);
        }
        const p = this.entry.getPointAt(this._entryK), ahead = this.entry.getPointAt(Math.min(1, this._entryK + 0.05));
        boss.root.position.copy(p); boss.face(this._entryK > 0.9 ? head : ahead.setY(p.y), 1 - Math.exp(-dt * 3));
        boss.bank(this._entryK < 0.3 ? -0.95 : 0, 1 - Math.exp(-dt * 2.5)); boss.update(dt, tNow);
        this.hum?.setLevel(0.55 + 0.45 * (1 - Math.min(1, p.distanceTo(head) / 25)));
        if (this._entryK >= 1 && this._fadedIn) { this.setState('AwaitArenaCircle'); this._promptArena(); }
        break;
      }
      case 'AwaitArenaCircle': {
        if (boss.maniac.state !== 'stretch' && boss.maniac.state !== 'throw') boss.maniac.setState('stretch'); // (menus / retries may have reset him)
        const hv = interior(app).toWorld(...F.bossHover);
        boss.flyToward(hv.add(_v.set(Math.sin(tNow * 0.5) * 1.2, Math.sin(tNow * 1.1) * 0.25, 0)), 3, dt, tNow, head);
        boss.bank(Math.sin(tNow * 0.5) * -0.08, 0.2);
        this.hum?.setLevel(0.45);
        const loco = app.locomotion, c = interior(app).toWorld(...F.arenaCircle.pos);
        const inside = rigInside(app.world.player.position, [c.x, 0, c.z], F.arenaCircle.radius);
        const stable = loco.grounded && !loco.attach && loco.vel.length() < 0.5;
        if (this.countdown === null) {
          this.dwell = inside && stable ? this.dwell + dt : 0;
          if (this.dwell >= 0.6) { this.countdown = 3; this._lastCount = 4; audio.play('perfect'); this.story.allowLocomotion = false; }
        } else {
          if (this._tutWait) break; // v0.49: tutorial 3 is open (the countdown has finished): the song waits
          if (!inside) { this.countdown = null; this.dwell = 0; this.story.allowLocomotion = true; this._promptArena(); break; } // stepped out: cancel
          const n = Math.ceil(this.countdown);
          if (n !== this._lastCount && n > 0) { this._lastCount = n; audio.play('countdown'); app.hud.showBanner(`${n}`, 0.9, COLORS.warn, t('story.factory.ready')); }
          this.countdown -= dt;
          if (this.countdown <= 0) {
            // v0.49: the arcade tutorial first (once per Story run); when it closes, a short get-ready count, then the song
            if (this.story.tutorial('arcade', () => { this._tutWait = false; this.countdown = TUTORIAL_PANEL.countdown; this._lastCount = TUTORIAL_PANEL.countdown + 1; })) { this._tutWait = true; break; }
            audio.play('go'); this.arena.visible = false; this.hum?.stop(); this.hum = null; this.setState('BossEncounter'); this.story.enterStage('arcadeBattle');
          }
        }
        break;
      }
      default: break;
    }
    this._updateArenaCircle(dt, tNow);
  }
  // =============================================================== escape (v0.20 ending)
  /** Story battle won → Green Maniac turns to the roll-up door, crashes out through it; Mobius follows. */
  beginEscape() {
    const app = this.app, interior = app.interior; if (!interior) return;
    app.arcade.stop(); app.fx.clear();
    this.story.allowAttack = false; this.story.allowLocomotion = true;
    app.locomotion.setInteriorMode(app.interiorSurface, INTERIOR.origin, INTERIOR.size.h);
    app.boss.remount(); app.boss.setVisible(true); app.boss.jet.setDamage(0.35); app.boss.jet.setThrust(1);
    app.boss.root.scale.setScalar(settings.arcadeBossScale); // fits through the 7 m door
    app.boss.root.position.copy(interior.toWorld(...INTERIOR.bossHover));
    this._door = this._door || null;
    interior.root.traverse((o) => { if (o.isMesh && /rolldoor/.test(o.material?.name || '')) { this._door = o; } });
    if (this._door) this._door.visible = true;
    for (const d of this.slats) { d.on = false; d.m.visible = false; }
    this._buildOutside(); this.outside.visible = false;
    this.outside.position.copy(interior.toWorld(DOOR.x, DOOR.h / 2, DOOR.z - 3.5));
    this.arena.visible = false; this.doorMarkerPos = interior.toWorld(DOOR_MARK.x, 0, DOOR_MARK.z);
    this.hum = this.hum || audio.startJetHum?.();
    this.escape = { phase: 'angry', t: 0, broke: false, dwell: 0 }; // v7: angry fit → turn → surf out through the door
    app.boss.face(app.camera.getWorldPosition(_w), 1); app.boss.maniac.setState('angry');
    this.setState('BossEscape');
    this.story.objective(t('story.escape.watch'));
    app.hud.showBanner(t('story.escape.banner'), 2.6, COLORS.bad, t('char.boss'));
  }
  _breakDoor() {
    const app = this.app, interior = app.interior, E = this.escape;
    if (E.broke) return; E.broke = true;
    if (this._door) this._door.visible = false;
    this.outside.visible = true;
    const c = interior.toWorld(DOOR.x, DOOR.h * 0.45, DOOR.z);
    app.fx.boom(c, { color: 0xffb020, size: 2.2, life: 0.7 });
    audio.play('doorBreak'); audio.play('debris');
    for (const h of ['left', 'right']) app.hub.haptic?.(h, 0.7, 110);
    this.slats.forEach((d, i) => {
      d.on = true; d.m.visible = true;
      d.m.position.copy(c).add(_v.set((Math.random() - 0.5) * DOOR.w * 0.8, (Math.random() - 0.2) * DOOR.h * 0.6, 0));
      d.m.rotation.set(Math.random() * 0.4, Math.random() * 3, Math.random() * 0.4);
      d.v.set((Math.random() - 0.5) * 7, 2 + Math.random() * 4, -(5 + Math.random() * 7)); // outward (north)
      d.w.set(Math.random() * 7, Math.random() * 7, Math.random() * 7); d.floor = interior.toWorld(0, 0, 0).y; void i;
    });
    for (let i = 0; i < 28; i++) { const a = Math.random() * Math.PI * 2; this.sparks.spawn(c, _v.set(Math.cos(a) * (2 + Math.random() * 3), 2 + Math.random() * 4, -2 - Math.random() * 5), { life: 0.7 + Math.random() * 0.5, size: [0.12, 0.04], alpha: 1 }); }
    for (let i = 0; i < 10; i++) this.smoke.spawn(_v.set(c.x + (Math.random() - 0.5) * 5, c.y - 2 + Math.random() * 3, c.z + 0.5), _w.set((Math.random() - 0.5) * 1.2, 0.8 + Math.random(), 0.6 + Math.random()), { life: 2.6, size: [1, 3.4], alpha: 0.55 });
  }
  _updateEscape(dt, tNow) {
    const app = this.app, boss = app.boss, interior = app.interior, E = this.escape; if (!interior || !E) return;
    const head = app.camera.getWorldPosition(_w).clone();
    E.t += dt;
    const door = interior.toWorld(DOOR.x, 3.6, DOOR.z + 1.2), out = interior.toWorld(DOOR.x, 6, DOOR.z - 30);
    if (this.state === 'BossEscape') {
      // v7: angry fit facing Mobius → he turns round on the jet to face the door (turn clip, the jet still faces Mobius) →
      // the jet swings round under him while he turns back to the front (the two spins cancel: he keeps facing the
      // door) → surf, full thrust, through the door
      if (E.phase === 'angry') {
        boss.face(head, 1 - Math.exp(-dt * 3)); boss.bank(0, 0.2); boss.update(dt, tNow);
        if (E.t > 0.2 && boss.maniac.state !== 'angry') { E.phase = 'turnA'; E.t = 0; boss.maniac.setState('faceBack'); }
      } else if (E.phase === 'turnA') {
        boss.update(dt, tNow);
        if (E.t >= ESC_SPIN) { E.phase = 'turnB'; E.t = 0; E.q0 = boss.aim.clone(); E.q1 = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(boss.root.position, door, THREE.Object3D.DEFAULT_UP)); boss.maniac.setState('faceFront'); audio.play('thrust'); }
      } else if (E.phase === 'turnB') {
        const k = Math.min(1, E.t / ESC_SPIN), e = k * k * (3 - 2 * k);
        boss.aim.copy(E.q0).slerp(E.q1, e); boss.bank(0, 0.2); boss.update(dt, tNow);
        if (k >= 1) { E.phase = 'charge'; E.t = 0; boss.jet.setThrust(1); audio.play('jetFlyby'); }
      } else if (E.phase === 'turn') { boss.face(door, 1 - Math.exp(-dt * 3)); boss.update(dt, tNow); boss.bank(0, 0.2); if (E.t > 0.9) { E.phase = 'charge'; E.t = 0; boss.jet.setThrust(1); audio.play('jetFlyby'); } }
      else if (E.phase === 'charge') { const d = boss.flyToward(door, 16, dt, tNow, out); if (d < 1.4) { this._breakDoor(); E.phase = 'out'; E.t = 0; } }
      else if (E.phase === 'out') {
        boss.flyToward(out, 22, dt, tNow, out.clone().add(_v.set(0, 0, -10)));
        this.hum?.setLevel(Math.max(0, 0.9 - E.t * 0.35));
        if (E.t > 2.2) { boss.setVisible(false); this.hum?.stop(); this.hum = null; this.setState('FollowToDoor'); this.arena.position.copy(this.doorMarkerPos).add(_v.set(0, 0.03, 0)); this.arena.visible = true; this.story.objective(t('story.escape.follow'), [t('tut.teleport')]); app.hud.showBanner(t('story.escape.follow'), 2.4, COLORS.perfect); }
      }
    } else if (this.state === 'FollowToDoor') {
      const inside = rigInside(app.world.player.position, [this.doorMarkerPos.x, 0, this.doorMarkerPos.z], DOOR_MARK.r);
      const loco = app.locomotion;
      E.dwell = inside && loco.grounded ? E.dwell + dt : 0;
      this.dwell = E.dwell; // circle highlight
      if (E.dwell >= 0.35) {
        this.setState('ExitTransition'); this.story.allowLocomotion = false; this.arena.visible = false;
        audio.play('go');
        this.story.fadeTo(1, 1.6, () => app.exitFactoryToCity());
      }
    }
    void head;
    this._updateSlats(dt);
  }
  _updateSlats(dt) {
    for (const d of this.slats) {
      if (!d.on) continue;
      d.v.y -= 9.8 * dt; d.m.position.addScaledVector(d.v, dt); d.m.rotation.x += d.w.x * dt; d.m.rotation.y += d.w.y * dt; d.m.rotation.z += d.w.z * dt;
      if (d.m.position.y < d.floor + 0.05) { d.m.position.y = d.floor + 0.05; d.v.multiplyScalar(0.3); d.v.y = Math.abs(d.v.y) * 0.2; d.w.multiplyScalar(0.5); if (d.v.length() < 0.3) d.on = false; }
    }
  }
  /** Warm street light seen through the broken door (the interior is a separate scene: a painted backdrop). */
  _buildOutside() {
    if (this.outside) return;
    const tex = canvasTexture(512, 512, (ctx, S) => {
      const r = rng(88);
      const g = ctx.createLinearGradient(0, 0, 0, S); g.addColorStop(0, '#f6b27a'); g.addColorStop(0.55, '#e48a6a'); g.addColorStop(0.8, '#7a5a6a'); g.addColorStop(1, '#3a3440');
      ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
      for (let k = 0; k < 14; k++) { const x = r() * S, w = 30 + r() * 70, h = 120 + r() * 260; ctx.fillStyle = `rgba(${80 + r() * 40},${50 + r() * 30},${60 + r() * 30},0.85)`; ctx.fillRect(x, S * 0.8 - h, w, h); ctx.fillStyle = 'rgba(255,200,120,0.5)'; for (let y = S * 0.8 - h + 10; y < S * 0.8 - 10; y += 16) for (let xx = x + 6; xx < x + w - 6; xx += 12) if (r() < 0.3) ctx.fillRect(xx, y, 5, 7); }
      ctx.fillStyle = '#2e2a30'; ctx.fillRect(0, S * 0.8, S, S * 0.2);
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(DOOR.w + 2, DOOR.h + 2), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, fog: false }));
    m.name = 'DoorOutside'; m.visible = false; this.outside = m; this.root.add(m);
  }

  /** Arena for the arcade battle: the circle, facing the north hover zone. */
  arenaFrame() { return this.app.factoryArena(); } // same arena as Arcade Mode (circle → boss in front of the door)

  // =============================================================== visuals
  _buildArenaCircle() {
    const r = INTERIOR.arenaCircle.radius;
    const g = new THREE.Group(); g.name = 'arena-circle';
    const mk = (geo, color, opacity) => { const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, toneMapped: false, fog: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide })); m.rotation.x = -Math.PI / 2; m.renderOrder = 12; return m; };
    this.arenaRing = mk(new THREE.RingGeometry(r - 0.14, r, 64), 0x22d3ff, 0.95);
    this.arenaFill = mk(new THREE.CircleGeometry(r - 0.14, 48), 0x1a6bff, 0.18);
    this.arenaInner = mk(new THREE.RingGeometry(r * 0.55, r * 0.62, 48), 0x7ef0ff, 0.6);
    g.add(this.arenaFill, this.arenaInner, this.arenaRing);
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.95, r * 0.95, 4, 32, 1, true), new THREE.MeshBasicMaterial({ color: 0x22d3ff, transparent: true, opacity: 0.08, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: false }));
    pillar.position.y = 2; g.add(pillar); this.arenaPillar = pillar;
    g.visible = false; this.arena = g; this.root.add(g);
  }
  _updateArenaCircle(dt, tNow) {
    if (!this.arena.visible) return;
    const pulse = 0.5 + 0.5 * Math.sin(tNow * 3.2);
    const on = this.countdown !== null || this.dwell > 0;
    this.arenaRing.material.color.set(on ? 0x7dff9a : 0x22d3ff);
    this.arenaFill.material.opacity = 0.1 + 0.1 * pulse + (on ? 0.25 : 0);
    this.arenaInner.scale.setScalar(1 + 0.25 * pulse);
    this.arenaPillar.material.opacity = 0.05 + 0.05 * pulse;
  }

  // =============================================================== frame
  update(dt, tNow) {
    if (!this.state) { this._updateParticles(dt); return; }
    if (['KickAndLand', 'BossBombThrow', 'RoofExplosion', 'ShortFall', 'FadeToBlack'].includes(this.state)) this._updateRoof(dt, tNow);
    else if (['InteriorArrival', 'AwaitArenaCircle'].includes(this.state)) this._updateInterior(dt, tNow);
    else if (['BossEscape', 'FollowToDoor', 'ExitTransition'].includes(this.state)) { this._updateEscape(dt, tNow); this._updateParticles(dt); this._updateArenaCircle(dt, tNow); }
    else this._updateParticles(dt);
    this.stateTime += dt;
  }
  stopAudio() { this.hum?.stop(); this.hum = null; }
}
const interior = (app) => app.interior;
