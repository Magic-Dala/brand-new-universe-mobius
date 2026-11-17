// v6 story opening (Mobius still in his room, window CLOSED): Green Maniac rampages over the street outside —
// he flies around at random over the first cross street / the avenue mouth (always in open air: every leg is checked
// against the city colliders) and keeps lobbing pumpkin bombs down at the street and the buildings across it. The
// bombs are scenery: they explode on a facade or on the street (fx + a muffled far boom) and never target or hurt
// the player. Drawn only when the room cull draws the city (window in view, directly or in the mirror).
// When the window is pushed open, the chase fly-by starts from wherever he is (chase.begin()).
import * as THREE from 'three';
import { audio } from '../core/audio.js';
import { createPumpkinBomb, GREEN_MANIAC_THROW_RELEASE } from '../art/enemies.js';
import { launchVelocity } from './chaseBombs.js';
import { mulberry32 } from '../data/box.js';

export const RAMPAGE = {
  // candidate waypoints (world): the cross street in front of tower A (z −16…−32 between the facades at −12 / −36)
  // and the mouth of the avenue to the north; filtered at start (clear of buildings by `pad`)
  xs: [-30, -22, -14, -6, 2, 10, 18, 26, 34, 42], zs: [-18, -24, -30], ys: [72, 77, 82],
  avenue: [[-4, 76, -44], [6, 80, -50], [0, 84, -58], [-6, 78, -66], [8, 74, -40], [4, 79, -76]],
  // only where Mobius can see him through the window: within ±viewDeg (horizontal) of the window normal, seen from
  // `eye` (≈ 1.5 m inside the window, the middle of the room)
  eye: [6, 77.2, -9], viewDeg: 40, viewUp: [-14, 18], // deg (vertical band)
  pad: 4, legPad: 3.2, legMin: 14, legMax: 48, // m (legPad: clearance along a whole leg — the jet is ~7 m wide)
  speed: [9, 16], // m/s (random per leg)
  throwEvery: [2.5, 4.5], // s between throws
  bombT: [1.6, 2.6], gravity: 9.8, life: 7, // s, m/s², s
  scale: 1.6, maxBombs: 4,
  boomSize: 2.6, // fx size (seen from far away)
};

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _f = new THREE.Vector3();

export class StreetRampage {
  constructor(app, cfg = RAMPAGE) {
    this.app = app; this.cfg = cfg;
    this.root = new THREE.Group(); this.root.name = 'streetRampage'; app.scene.add(this.root);
    this.bombs = [];
    this.active = false; this.rand = mulberry32(0x9a3e);
    this.stats = { legs: 0, throws: 0, booms: 0 };
  }
  _points() {
    const C = this.cfg, w = this.app.cityWorld, out = [];
    for (const x of C.xs) for (const z of C.zs) for (const y of C.ys) out.push(new THREE.Vector3(x, y, z));
    for (const p of C.avenue) out.push(new THREE.Vector3(...p));
    const [ex, ey, ez] = C.eye;
    const inView = (p) => { const dx = p.x - ex, dz = p.z - ez, h = Math.hypot(dx, dz); if (dz > -2) return false; const yaw = Math.abs(Math.atan2(dx, -dz)) * 180 / Math.PI, pit = Math.atan2(p.y - ey, h) * 180 / Math.PI; return yaw <= C.viewDeg && pit >= C.viewUp[0] && pit <= C.viewUp[1]; };
    return out.filter((p) => inView(p) && !w?.pointBlocked(p.x, p.y, p.z, C.pad));
  }
  start() {
    const boss = this.app.boss;
    this.pts = this._points();
    this.active = true; this.t = 0;
    this.throwAt = 1.2 + this.rand() * 1.5; this.pending = null;
    boss.remount(); boss.jet.setDamage(0); boss.jet.setThrust(0.8); boss.resetScale();
    if (!this._placed || boss.root.position.distanceTo(_v.set(0, 78, -26)) > 120) { // first start: somewhere in view
      const p = this.pts[Math.floor(this.rand() * this.pts.length)] || _v.set(-4, 78, -26); boss.root.position.copy(p); this._placed = true;
    }
    this.target = null; this._pickLeg();
    this._yaw = null;
  }
  stop() { this.active = false; this.pending = null; } // flying bombs finish on their own (update keeps draining them)
  get busy() { return this.active || this.bombs.some((b) => b.active); }
  _clear(a, b) { // every 2 m along the leg: no collider within legPad
    const w = this.app.cityWorld; if (!w) return true;
    const n = Math.max(1, Math.ceil(a.distanceTo(b) / 2));
    for (let i = 0; i <= n; i++) { _v.lerpVectors(a, b, i / n); if (w.pointBlocked(_v.x, _v.y, _v.z, this.cfg.legPad)) return false; }
    return true;
  }
  _pickLeg() {
    const C = this.cfg, from = this.app.boss.root.position.clone();
    const ok = this.pts.filter((p) => { const d = p.distanceTo(from); return d > C.legMin && d < C.legMax && this._clear(from, p); });
    const list = ok.length ? ok : this.pts.filter((p) => this._clear(from, p));
    this.target = (list.length ? list[Math.floor(this.rand() * list.length)] : this.pts[0]).clone();
    this.legSpeed = C.speed[0] + this.rand() * (C.speed[1] - C.speed[0]);
    this.stats.legs++;
  }
  _bomb() {
    let b = this.bombs.find((x) => !x.active);
    if (!b) { if (this.bombs.length >= this.cfg.maxBombs) return null; const p = createPumpkinBomb({ model: 'normal' }); p.root.scale.setScalar(this.cfg.scale); this.root.add(p.root); b = { p, active: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), t: 0 }; this.bombs.push(b); }
    b.active = true; b.t = 0; b.p.root.visible = true; b.p.setGlow(0.6); return b;
  }
  update(dt, tNow, show = true) {
    const C = this.cfg, app = this.app, boss = app.boss, w = app.cityWorld;
    this.root.visible = show;
    if (this.active) {
      this.t += dt;
      boss.setVisible(show);
      // fly the leg (speed-limited, never through a building: legs are checked), bank into the turn
      const p = boss.root.position;
      if (!this.target || p.distanceTo(this.target) < 2.5) this._pickLeg();
      _f.copy(this.target).sub(p).setY(0);
      const yaw = Math.atan2(_f.x, _f.z); const dy = this._yaw == null ? 0 : Math.atan2(Math.sin(yaw - this._yaw), Math.cos(yaw - this._yaw)); this._yaw = yaw;
      boss.flyToward(this.target, this.legSpeed, dt, tNow, _v.copy(this.target).addScaledVector(_f.normalize(), 6));
      boss.bank(THREE.MathUtils.clamp(-dy / Math.max(dt, 1e-3) * 0.25, -0.6, 0.6), 1 - Math.exp(-dt * 3));
      // throws: plain throw (forward / down at the street), bomb leaves the hand at the clip's release
      if (!this.pending && this.t >= this.throwAt) { boss.throw(); this.pending = { t: 0 }; }
      if (this.pending) {
        this.pending.t += dt;
        if (this.pending.t >= GREEN_MANIAC_THROW_RELEASE) {
          const b = this._bomb();
          if (b) {
            boss.throwPoint(b.pos);
            const fwd = _w.set(0, 0, -1).applyQuaternion(boss.root.quaternion).setY(0); if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1); fwd.normalize(); // jet nose = −Z
            const side = _v.set(-fwd.z, 0, fwd.x).multiplyScalar((this.rand() - 0.5) * 16);
            const tgt = _f.copy(b.pos).addScaledVector(fwd, 16 + this.rand() * 16).add(side); tgt.y = b.pos.y - (8 + this.rand() * 55);
            const T = C.bombT[0] + this.rand() * (C.bombT[1] - C.bombT[0]);
            launchVelocity(b.pos, tgt, T, C.gravity, b.vel);
            this.stats.throws++;
          }
          this.pending = null; this.throwAt = this.t + C.throwEvery[0] + this.rand() * (C.throwEvery[1] - C.throwEvery[0]);
        }
      }
    }
    // bombs (keep draining after stop(): the ones in the air still land)
    for (const b of this.bombs) {
      if (!b.active) continue;
      b.t += dt; b.vel.y -= C.gravity * dt; b.pos.addScaledVector(b.vel, dt);
      b.p.root.position.copy(b.pos); b.p.root.rotation.y += dt * 5; b.p.update(dt);
      if (b.pos.y < 0.4 || w?.pointBlocked(b.pos.x, b.pos.y, b.pos.z, 0.2) || b.t > C.life) {
        if (show) app.fx.boom(b.pos, { color: 0xffa020, size: C.boomSize, life: 0.8 });
        audio.play('boomFar'); this.stats.booms++;
        b.active = false; b.p.root.visible = false;
      }
    }
  }
  clear() { this.active = false; this.pending = null; for (const b of this.bombs) { b.active = false; b.p.root.visible = false; } }
}
