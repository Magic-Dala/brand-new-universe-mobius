// Green Maniac (綠狂魔) riding the Green Bat Jet (綠魔飛行器).
import * as THREE from 'three';
import { createBatJet, createGreenManiac } from '../art/enemies.js';
import { settings } from '../core/settings.js';

const _v = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _r = new THREE.Quaternion(), _Z = new THREE.Vector3(0, 0, 1);
const FLIP = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);

export class Boss {
  constructor(scene) {
    this.root = new THREE.Group(); this.root.name = 'boss'; scene.add(this.root);
    this.jet = createBatJet();
    this.maniac = createGreenManiac();
    this.root.add(this.jet.root);
    this.jet.root.scale.setScalar(1.35); // readability at 15 m (Quest 3 pixel density)
    this.jet.standPoint.add(this.maniac.root);
    this.maniac.setState('ride');
    this.jet.setThrust(0.7);
    this.vel = new THREE.Vector3();
    this.aim = new THREE.Quaternion(); this.roll = 0; // heading and bank kept apart (bank used to accumulate → wild rolling)
    this.riding = true;
    this.root.visible = false;
    this.resetScale();
  }
  /** v0.31b: story / city size (the arcade and factory battle set their own scale). */
  resetScale() { this.root.scale.setScalar(settings.storyBossScale ?? 0.9); }
  setVisible(v) { this.root.visible = v; }
  /**
   * 'hd' (factory: arcade + story boss fight, light scene) or 'sd' (city chase). Swaps geometry + material on
   * the live skinned meshes (same bones), so poses / attachments / targets are untouched. hd = loadBossModelsHD().
   */
  setDetail(level, hd = null) {
    for (const [part, key] of [[this.maniac, 'maniac'], [this.jet, 'jet']]) {
      const m = part.mesh; if (!m) continue;
      m.userData.sd ??= { geometry: m.geometry, material: m.material };
      const src = level === 'hd' && hd?.[key] ? hd[key] : m.userData.sd;
      m.geometry = src.geometry; m.material = src.material;
    }
    this.detail = level === 'hd' && hd ? 'hd' : 'sd';
  }
  throw() { this.maniac.setState('throw'); }
  throwPoint(out) { this.root.updateMatrixWorld(true); return this.maniac.throwHand.getWorldPosition(out); }
  /** Face a world point with the jet nose (-Z). */
  face(target, k = 1) {
    _m.lookAt(this.root.position, target, new THREE.Vector3(0, 1, 0)); // -Z (nose) toward target
    _q.setFromRotationMatrix(_m);
    this.aim.slerp(_q, k);
    this._apply();
  }
  /** Bank (roll) angle on top of the heading. Absolute — never accumulates frame to frame. */
  bank(angle, k = 1) { this.roll += (angle - this.roll) * k; this._apply(); }
  _apply() { this.root.quaternion.copy(this.aim).multiply(_r.setFromAxisAngle(_Z, this.roll)); }
  /** Arcade hover: figure-8 sway timed to the beat (cosmetic). */
  hoverAt(home, beat, camPos, dt, t) {
    const ph = (beat / 8) * Math.PI * 2; // 2 bars per loop
    this.root.position.set(home.x + Math.sin(ph) * 2.2, home.y + Math.sin(ph * 2) * 0.6, home.z + Math.cos(ph) * 0.8);
    this.face(camPos, 1 - Math.exp(-dt * 4));
    this.bank(Math.sin(ph) * -0.12);
    this.update(dt, t);
  }
  /** Story: steer toward a point with speed limit (no teleporting). */
  flyToward(target, speed, dt, t, lookAt) {
    _v.copy(target).sub(this.root.position);
    const d = _v.length();
    if (d > 0.01) this.root.position.addScaledVector(_v.normalize(), Math.min(d, speed * dt));
    this.face(lookAt || target, 1 - Math.exp(-dt * 3));
    this.update(dt, t);
    return d;
  }
  update(dt, t) { this.jet.update(dt, t); this.maniac.update(dt, t); }
  wingTargets() { return this.jet.wingTargets; }
  /** Green Maniac leaves the jet (v0.21: kicked off onto the factory roof). Keeps his on-screen size. */
  dismount(worldPos, worldYawTarget) {
    if (!this.riding) return;
    this.root.updateMatrixWorld(true);
    const ws = this.maniac.root.getWorldScale(new THREE.Vector3()).x;
    this.jet.standPoint.remove(this.maniac.root);
    this.root.parent.add(this.maniac.root);
    this.maniac.root.scale.setScalar(ws);
    this.maniac.root.position.copy(worldPos);
    this.maniac.root.quaternion.identity();
    if (worldYawTarget) { this.maniac.root.lookAt(worldYawTarget.x, worldPos.y, worldYawTarget.z); }
    this.maniac.setState('stand');
    this.riding = false;
  }
  remount() {
    if (this.riding) { this.maniac.setState('ride'); return; } // (e.g. was stretching / dancing on the jet)
    this.maniac.root.parent?.remove(this.maniac.root);
    this.jet.standPoint.add(this.maniac.root);
    this.maniac.root.position.set(0, 0, 0); this.maniac.root.quaternion.identity(); this.maniac.root.scale.setScalar(1);
    this.maniac.setState('ride'); this.riding = true;
  }
}
void FLIP;
