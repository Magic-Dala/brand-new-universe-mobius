// v0.23 wind while swinging / wall running / falling: thin light streaks that hang still in WORLD space ahead of the
// player along the direction of travel — flying through them gives real parallax (they rush past in the direction
// you move), never a screen-locked overlay. Kept out of a cone around the view centre and out of arm's reach; fade
// with speed. Plus a filtered-noise wind sound that rises with speed. Comfort mode halves the effect;
// settings.windFx turns it off.
import * as THREE from 'three';
import { settings } from '../core/settings.js';
import { audio } from '../core/audio.js';
import { vfxOn } from './vfx/vfxFlags.js';
import { windStreakTexture } from './vfx/textures.js';

export const WIND = {
  count: 64,
  speed: [5, 17], // m/s: starts / full strength
  ahead: [5, 16], // m ahead (along the velocity) where streaks are spawned
  radius: [1.3, 4.5], // m from the travel axis (never in front of the face)
  viewClear: 0.2, // rad: no streak spawned within this angle of the view centre
  len: [0.35, 0.09], // streak length = len[0] + speed · len[1] (m)
  width: 0.02, // m
  alpha: 0.6, // max brightness (additive)
  comfort: 0.5,
  sound: 0.85,
  // v0.44 web pull: a gust on top of the speed-based wind so a pull is FELT (brighter, longer streaks + louder wind),
  // driven by locomotion.pull.surge (m/s the pulls added recently; decays by itself over ~2 s)
  pullSurgeFull: 5, // m/s of surge for the full gust (one full stroke)
  pullGust: 0.8, // level added at full surge (the normal wind tops out at 1)
  pullFloor: 0.45, // … and the wind is at least this strong during a full gust, even at low speed
  pullLen: 0.7, // streaks up to this much longer during a gust
  pullRise: 12, // 1/s: the gust comes in fast (the normal wind eases at 4/s)
};

const _v = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _s = new THREE.Vector3(), _c = new THREE.Color();
const Z = new THREE.Vector3(0, 0, 1);

export class WindFx {
  constructor(app, cfg = WIND) {
    this.app = app; this.cfg = cfg;
    let geo = new THREE.BoxGeometry(1, 1, 1);
    let mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false });
    this.v30 = typeof document !== 'undefined' && vfxOn('wind');
    if (this.v30) { // v0.30 vfx: soft tapered streaks (two crossed quads along the travel axis, faded at both ends) instead of hard boxes
      const a = new THREE.PlaneGeometry(1, 1).rotateX(Math.PI / 2), b = new THREE.PlaneGeometry(1, 1).rotateX(Math.PI / 2).rotateZ(Math.PI / 2);
      for (const g of [a, b]) { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i), uv.getY(i)); }
      geo = new THREE.BufferGeometry(); const pa = [...a.attributes.position.array, ...b.attributes.position.array], ua = [...a.attributes.uv.array, ...b.attributes.uv.array];
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pa, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(ua, 2)); geo.setIndex([0, 2, 1, 2, 3, 1, 4, 6, 5, 6, 7, 5]);
      mat = new THREE.MeshBasicMaterial({ color: 0xffffff, alphaMap: windStreakTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false, side: THREE.DoubleSide });
      cfg = { ...cfg, viewClear: 0.3, width: 0.05, alpha: 0.5 }; this.cfg = cfg;
    }
    this.mesh = new THREE.InstancedMesh(geo, mat, cfg.count); this.mesh.name = 'wind-streaks';
    this.mesh.frustumCulled = false; this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < cfg.count; i++) this.mesh.setColorAt(i, _c.set(0x000000));
    app.scene.add(this.mesh);
    if (this.v30) app.fx?.vfx?.registerWarm(this.mesh); // v0.30 vfx: compiled during the prewarm
    this.p = Array.from({ length: cfg.count }, () => ({ pos: new THREE.Vector3(), live: false, k: Math.random() }));
    this.level = 0; this.dir = new THREE.Vector3(0, 0, -1);
    this.flowTint = 0; // v0.45: World Chase Flow tint 0 (cool white) … 1 (cyan)
    this.snd = null;
  }
  _active() {
    const a = this.app, L = a.locomotion;
    if (settings.windFx === false) return false;
    if (L.mode !== 'city' || L.grounded || L.cling || a.story?.inRoom) return false;
    if (a.state === 'world') { const w = a.worldChase; return !!w && w.running && !w.paused && !a.menus?.open; } // World Chase: same wind as the story swing (not when paused / resolved)
    return a.state === 'story';
  }
  update(dt) {
    const C = this.cfg, a = this.app, vel = a.locomotion.vel, sp = vel.length();
    let want = 0;
    let gust = 0;
    if (this._active() && sp > 0.1) {
      gust = Math.min(1, (a.locomotion.pull?.surge || 0) / C.pullSurgeFull); // v0.44: 0…1 while a web pull's surge lasts
      want = (Math.max(THREE.MathUtils.smoothstep(sp, C.speed[0], C.speed[1]), gust * C.pullFloor) + gust * C.pullGust) * (settings.comfortMode ? C.comfort : 1);
    }
    this.gust = gust;
    this.level += (want - this.level) * Math.min(1, dt * (want > this.level && gust > 0 ? C.pullRise : 4));
    // sound
    if (audio.running) {
      if (!this.snd && this.level > 0.02) this.snd = audio.startWind?.();
      this.snd?.setLevel(this.level * C.sound);
    }
    if (this.level < 0.01) { if (this.mesh.visible) { this.mesh.visible = false; for (const p of this.p) p.live = false; } return; }
    this.mesh.visible = true;
    const head = a.camera.getWorldPosition(_a), fwd = _b.set(0, 0, -1).applyQuaternion(a.camera.getWorldQuaternion(_q));
    if (sp > 0.5) this.dir.copy(vel).divideScalar(sp);
    const d = this.dir, len = (C.len[0] + sp * C.len[1]) * (1 + C.pullLen * gust);
    // two axes perpendicular to the travel direction
    const u = new THREE.Vector3().crossVectors(d, Math.abs(d.y) < 0.9 ? THREE.Object3D.DEFAULT_UP : Z).normalize(), w = new THREE.Vector3().crossVectors(d, u);
    _q.setFromUnitVectors(Z, d);
    for (let i = 0; i < C.count; i++) {
      const p = this.p[i];
      _v.copy(p.pos).sub(head);
      const along = _v.dot(d);
      if (!p.live || along < -2 || _v.length() > C.ahead[1] + 6) { // (re)spawn ahead, off the view centre
        for (let tries = 0; tries < 4; tries++) {
          const r = C.radius[0] + Math.random() * (C.radius[1] - C.radius[0]), th = Math.random() * Math.PI * 2;
          const ah = C.ahead[0] + Math.random() * (C.ahead[1] - C.ahead[0]);
          p.pos.copy(head).addScaledVector(d, p.live ? C.ahead[1] : ah).addScaledVector(u, Math.cos(th) * r).addScaledVector(w, Math.sin(th) * r);
          _v.copy(p.pos).sub(head).normalize();
          if (Math.acos(THREE.MathUtils.clamp(_v.dot(fwd), -1, 1)) > C.viewClear) break;
        }
        p.live = true; p.k = 0.6 + Math.random() * 0.4;
      }
      // brightness: speed level × fade in from far / out when passing the head
      _v.copy(p.pos).sub(head); const al = _v.dot(d);
      const fade = THREE.MathUtils.clamp((C.ahead[1] + 2 - al) / 5, 0, 1) * THREE.MathUtils.clamp((al + 2) / 3, 0, 1);
      const b = C.alpha * this.level * p.k * fade, tr = 1 - 0.65 * this.flowTint, tg = 1 - 0.1 * this.flowTint; // v0.45: Flow → cyan
      if (this.v30) this.mesh.setColorAt(i, _c.setRGB(b * 0.8 * tr, b * 0.92 * tg, b)); // (tint: cool white, alphaMap tapers it)
      else this.mesh.setColorAt(i, _c.setRGB(b * 0.85 * tr, b * 0.95 * tg, b));
      this.mesh.setMatrixAt(i, _m.compose(p.pos, _q, _s.set(C.width, C.width, len * p.k)));
    }
    this.mesh.instanceMatrix.needsUpdate = true; this.mesh.instanceColor.needsUpdate = true;
  }
  stop() { this.level = 0; this.mesh.visible = false; for (const p of this.p) p.live = false; this.snd?.setLevel(0); }
}
