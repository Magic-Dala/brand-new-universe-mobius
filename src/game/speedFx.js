// v0.45 speed + hand-presence feedback (World Chase; v0.47: also the Story chase while its combat runs; settings.speedFx): a rope-tension tone per web that rises with the
// centripetal load, a near-miss whoosh at a wall passing close at speed, a launch pop on a fast release, and a short flash at
// the hand when it fires a web (the existing web / attach sounds play positionally at the hand) (tracked hands get no vibration). Comfort mode halves all gains.
// Owns the audio listener (head position + right vector) while the chase runs.
import * as THREE from 'three';
import { settings } from '../core/settings.js';
import { audio } from '../core/audio.js';
import { FEEL } from '../data/feel.js';
import { boxToWorld } from '../data/box.js';

const CHEST = 1.3; // = locomotion CHEST: the swing body point above the feet
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _q = new THREE.Quaternion(), _w = [0, 0, 0], _res = { side: 1, dist: 0, point: new THREE.Vector3() }; // (nearMiss returns the shared _res: read it before the next call)

/** Centripetal acceleration (m/s²) of the swing: tangential speed² / rope length. 0 along the rope. */
export function ropeLoad(vel, toAnchor, len) {
  const L = toAnchor.length(); if (L < 1e-6 || len < 1e-6) return 0;
  const radial = vel.dot(toAnchor) / L, t2 = Math.max(0, vel.lengthSq() - radial * radial);
  return t2 / len < 1e-9 ? 0 : t2 / len;
}
/** 0…1 across FEEL.speed.tensionAccel (clamped). */
export function tensionLevel(load, C = FEEL.speed) { const [lo, hi] = C.tensionAccel; return Math.max(0, Math.min(1, (load - lo) / (hi - lo))); }
/** The closest wall face within C.nearDist, to the side of the velocity, at speed ≥ C.nearSpeed; boxes are chaseWorld colliders
 *  ({ x, z, cos, sin, hw, hd, y0, y1 }); boxes whose height range does not contain pos.y (above the roof, below the base) are skipped. */
export function nearMiss(pos, vel, boxes, C = FEEL.speed) {
  const sp = vel.length(); if (sp < C.nearSpeed) return null;
  const fx = vel.x / sp, fy = vel.y / sp, fz = vel.z / sp, hx = Math.hypot(fx, fz);
  let best = null;
  for (const b of boxes) {
    if (pos.y < b.y0 || pos.y > b.y1) continue;
    const ox = pos.x - b.x, oz = pos.z - b.z, bx = ox * b.cos - oz * b.sin, bz = ox * b.sin + oz * b.cos, cx = Math.max(-b.hw, Math.min(b.hw, bx)), cz = Math.max(-b.hd, Math.min(b.hd, bz));
    const p = boxToWorld(b, cx, pos.y, cz, _w), dx = p[0] - pos.x, dy = 0, dz = p[2] - pos.z, d = Math.hypot(dx, dz);
    if (d < 1e-4 || d > C.nearDist || (best && d >= best.dist)) continue;
    const along = dx * fx + dy * fy + dz * fz, lx = dx - along * fx, ly = dy - along * fy, lz = dz - along * fz, lat = Math.hypot(lx, ly, lz);
    if (lat < 0.5 * d) continue; // dead ahead / behind: a wall in the path, not a pass
    const rx = hx > 0.05 ? -fz / hx : 1, rz = hx > 0.05 ? fx / hx : 0; // right of the heading (f × up), xz
    best = _res; _res.side = lx * rx + lz * rz >= 0 ? 1 : -1; _res.dist = d; _res.point.set(p[0], p[1], p[2]);
  }
  return best;
}

export class SpeedFx {
  constructor(app) { this.app = app; this.v = [null, null]; this.gap = 0; this._lp = new THREE.Vector3(); this._lr = new THREE.Vector3(1, 0, 0); this._out = []; }
  /** v0.47: the Story chase / the chase after the factory, while the Story combat loop runs (settings.storyCombat). */
  _story() { const a = this.app, s = a.story; return a.state === 'story' && settings.storyCombat !== false && !!s?.combat?.running && !s.paused; }
  _on() { const a = this.app, w = a.worldChase; if (settings.speedFx === false || a.menus?.open) return false; return (a.state === 'world' && !!w && w.running && !w.paused) || this._story(); }
  _k() { return settings.comfortMode ? FEEL.speed.comfort : 1; }
  update(dt) {
    if (!this._on()) { this.stop(); return; }
    const a = this.app, loco = a.locomotion, C = FEEL.speed, k = this._k();
    a.camera.getWorldPosition(this._lp); this._lr.set(1, 0, 0).applyQuaternion(a.camera.getWorldQuaternion(_q)); audio.setListener(this._lp, this._lr); this._own = true; // owns the listener
    const ropes = loco.ropes, chest = loco.feet(_a); chest.y += CHEST;
    for (let i = 0; i < 2; i++) { // one tension voice per rope
      const r = ropes[i];
      if (!r) { this._stopVoice(i); continue; }
      const lv = tensionLevel(ropeLoad(loco.vel, _b.copy(r.anchor.p).sub(chest), r.len), C);
      if (this.v[i] === null && lv > 0.02) this.v[i] = audio.startTension?.() || 0; // (0: no audio context — not retried until the rope is gone)
      if (this.v[i]) this.v[i].set(lv, C.tensionHz[0] + (C.tensionHz[1] - C.tensionHz[0]) * lv, k); // comfort: k multiplies the gain (halved, not squared)
    }
    this.gap -= dt;
    const w = a.state === 'world' ? a.worldChase.world : a.cityWorld; // (v0.47 Story: Dala City's colliders)
    if (this.gap <= 0 && loco.vel.length() >= C.nearSpeed && w) {
      const h = a.camera.getWorldPosition(_c);
      const m = nearMiss(h, loco.vel, w.collidersNear(h.x, h.z, C.nearDist + 0.5, this._out), C);
      if (m) { this.gap = C.nearGap; audio.play('whoosh', 0, m.point, k); }
    }
    for (const e of a.hub.events) if (e.type === 'web') a.fx?.vfx?.handFlash?.(e.origin); // a web fired (hit or miss): one flash at the hand (its sound is the existing web / attach play, positional)
  }
  /** loco.onRelease (forwarded by World Chase): a fast release pops. */
  onRelease(sp) { if (this._on() && sp >= FEEL.speed.launchSpeed) audio.play('launch', 0, null, this._k()); }
  _stopVoice(i) { const v = this.v[i]; if (v) v.stop(); this.v[i] = null; }
  stop() { this._stopVoice(0); this._stopVoice(1); this.gap = 0; if (this._own) { this._own = false; audio.setListener(null, null); } }
}
