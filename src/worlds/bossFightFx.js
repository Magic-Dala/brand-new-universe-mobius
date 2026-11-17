// v0.42 World Chase boss-fight visuals on the Green Bat Jet: the protective shield (one transparent layer, fresnel +
// hex cells, impact ripple, cracks when low, re-forming after a stagger), the rear power core (vent shutters open, hot
// glow, heat plumes), the threat icon over Green Maniac (single / spread / heavy — shape, not only colour) and the
// counter ring around a heavy pumpkin while destroying it would still counter. Everything is created once and reused
// (no per-frame allocation); all of it is hidden outside the World Chase.
import * as THREE from 'three';

const SHIELD_VS = /* glsl */`
varying vec3 vN; varying vec3 vV; varying vec3 vL;
void main() {
  vL = normalize(position);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
const SHIELD_FS = /* glsl */`
uniform vec3 uColor; uniform float uOpacity; uniform float uHit; uniform vec3 uHitDir; uniform float uTime; uniform float uCrack; uniform float uForm;
varying vec3 vN; varying vec3 vV; varying vec3 vL;
float hexEdge(vec2 p) { p = abs(p); float c = dot(p, normalize(vec2(1.0, 1.732))); c = max(c, p.x); return c; }
void main() {
  float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
  // hex cells on a lat/long projection (cheap, stable)
  vec2 uv = vec2(atan(vL.z, vL.x) * 3.2, vL.y * 5.0);
  vec2 g = vec2(uv.x, uv.y * 1.1547); vec2 a = mod(g, vec2(1.0, 1.732)) - vec2(0.5, 0.866); vec2 b = mod(g - vec2(0.5, 0.866), vec2(1.0, 1.732)) - vec2(0.5, 0.866);
  vec2 h = dot(a, a) < dot(b, b) ? a : b;
  float edge = smoothstep(0.40, 0.47, hexEdge(h));
  // impact ripple around the hit direction
  float d = acos(clamp(dot(vL, uHitDir), -1.0, 1.0));
  float ring = uHit * (smoothstep(0.55, 0.0, abs(d - (1.0 - uHit) * 1.1)) + smoothstep(0.6, 0.0, d) * 0.8);
  // cracks / flicker when low; forming sweep (bottom → top) while it re-forms
  float flick = 1.0 - uCrack * (0.5 + 0.5 * sin(uTime * 23.0 + vL.y * 9.0)) * step(0.55, fract(sin(dot(floor(uv * 2.0), vec2(12.9898, 78.233))) * 43758.5453));
  float form = smoothstep(uForm * 2.2 - 1.2, uForm * 2.2 - 1.0, -vL.y);
  float alpha = (0.22 * fres + 0.55 * edge * (0.35 + fres) + ring) * uOpacity * flick * (1.0 - form);
  gl_FragColor = vec4(uColor * (1.0 + ring * 1.5), alpha);
}`;

function radialTex(stops) {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); for (const [k, col] of stops) gr.addColorStop(k, col);
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
/** Threat icons (shape-coded): 'single' one pumpkin, 'spread' three, 'heavy' a big pumpkin inside a warning triangle. */
function iconTex(kind) {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  const pk = (x, y, r, col) => { g.fillStyle = col; g.beginPath(); g.ellipse(x, y, r, r * 0.85, 0, 0, Math.PI * 2); g.fill(); g.strokeStyle = 'rgba(20,8,0,0.9)'; g.lineWidth = r * 0.16; g.beginPath(); g.moveTo(x, y - r * 0.85); g.lineTo(x, y + r * 0.85); g.stroke(); g.fillStyle = '#2b3a12'; g.fillRect(x - r * 0.12, y - r * 1.15, r * 0.24, r * 0.35); };
  g.lineJoin = 'round';
  if (kind === 'heavy') {
    g.fillStyle = 'rgba(40,0,0,0.75)'; g.strokeStyle = '#ff3b3b'; g.lineWidth = 9; g.beginPath(); g.moveTo(64, 8); g.lineTo(122, 116); g.lineTo(6, 116); g.closePath(); g.fill(); g.stroke();
    pk(64, 78, 28, '#ff7a1a'); g.fillStyle = '#1a0500'; g.beginPath(); g.moveTo(50, 70); g.lineTo(60, 76); g.lineTo(50, 78); g.fill(); g.beginPath(); g.moveTo(78, 70); g.lineTo(68, 76); g.lineTo(78, 78); g.fill(); g.fillRect(50, 88, 28, 5);
  } else {
    g.fillStyle = 'rgba(30,14,0,0.7)'; g.strokeStyle = '#ffb020'; g.lineWidth = 8; g.beginPath(); g.arc(64, 64, 56, 0, Math.PI * 2); g.fill(); g.stroke();
    if (kind === 'spread') { pk(34, 70, 15, '#ffa020'); pk(64, 56, 15, '#ffa020'); pk(94, 70, 15, '#ffa020'); } else pk(64, 66, 24, '#ffa020');
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export const FIGHT_FX = {
  shieldColor: 0x9dff3a, // Green Maniac's tech: lime-green — never the player's cyan
  shieldScale: [4.0, 2.5, 3.7], shieldOffset: [0, 0.75, 0.15], // boss-root local (× boss scale 0.9)
  core: { pos: [0, -0.1, 1.02], r: 0.24, color: 0xffa040, hot: 0xfff2c8 }, // jet local (× jet scale 1.35)
};

export class BossFightFx {
  constructor(app, opts = {}) {
    this.app = app; const boss = app.boss;
    // ---- shield
    this.shieldMat = new THREE.ShaderMaterial({ vertexShader: SHIELD_VS, fragmentShader: SHIELD_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide, fog: false,
      uniforms: { uColor: { value: new THREE.Color(FIGHT_FX.shieldColor) }, uOpacity: { value: 0 }, uHit: { value: 0 }, uHitDir: { value: new THREE.Vector3(0, 0, 1) }, uTime: { value: 0 }, uCrack: { value: 0 }, uForm: { value: 1 } } });
    this.shield = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 16), this.shieldMat);
    this.shield.name = 'bossShield'; this.shield.renderOrder = 12; this.shield.position.set(...FIGHT_FX.shieldOffset); this.shield.scale.set(...FIGHT_FX.shieldScale); this.shield.visible = false;
    boss.root.add(this.shield);
    // ---- power core (rear of the jet, between the nozzles) + vent shutters + heat plumes
    const C = FIGHT_FX.core;
    this.core = new THREE.Group(); this.core.name = 'bossCore'; this.core.position.set(...C.pos); boss.jet.root.add(this.core);
    this.coreMat = new THREE.MeshBasicMaterial({ color: C.color, toneMapped: false, fog: false });
    this.coreBall = new THREE.Mesh(new THREE.IcosahedronGeometry(C.r, 2), this.coreMat); this.core.add(this.coreBall);
    this.coreGlowMat = new THREE.SpriteMaterial({ map: radialTex([[0, 'rgba(255,250,220,1)'], [0.3, 'rgba(255,170,60,0.85)'], [0.7, 'rgba(255,90,20,0.25)'], [1, 'rgba(0,0,0,0)']]), color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false });
    this.coreGlow = new THREE.Sprite(this.coreGlowMat); this.coreGlow.scale.setScalar(C.r * 6); this.coreGlow.renderOrder = 13; this.core.add(this.coreGlow);
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0xfff2c8, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: false, blending: THREE.AdditiveBlending });
    this.coreRing = new THREE.Mesh(new THREE.RingGeometry(C.r * 1.9, C.r * 2.25, 40), this.ringMat); this.coreRing.position.z = 0.02; this.core.add(this.coreRing); // faces +Z (rear) = toward a pursuer
    const plateMat = new THREE.MeshStandardMaterial({ color: 0x1f2a1c, metalness: 0.7, roughness: 0.4, emissive: 0x3a1000, emissiveIntensity: 0 });
    this.plateMat = plateMat; this.plates = [];
    for (let i = 0; i < 4; i++) { const pv = new THREE.Group(), a = (i / 4) * Math.PI * 2 + Math.PI / 4; pv.rotation.z = a; const pl = new THREE.Mesh(new THREE.BoxGeometry(C.r * 1.5, C.r * 1.5, 0.03), plateMat); pl.position.set(C.r * 0.62, 0, 0.12); pv.add(pl); pv.userData.pl = pl; this.core.add(pv); this.plates.push(pv); }
    this.plumeMat = new THREE.MeshBasicMaterial({ color: 0xff7a20, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false });
    this.plumes = [-1, 1].map((s) => { const m = new THREE.Mesh(new THREE.ConeGeometry(0.16, 1.1, 10, 1, true), this.plumeMat); m.position.set(s * 0.32, 0.28, 0.7); m.rotation.x = -0.35; m.visible = false; boss.jet.root.add(m); return m; });
    this.core.visible = false;
    // ---- threat icon over Green Maniac (billboard sprite, scaled with distance so it stays readable)
    this.icons = { single: iconTex('single'), spread: iconTex('spread'), heavy: iconTex('heavy') };
    this.iconMat = new THREE.SpriteMaterial({ map: this.icons.single, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, fog: false });
    this.icon = new THREE.Sprite(this.iconMat); this.icon.renderOrder = 38; this.icon.visible = false; app.scene.add(this.icon);
    // ---- counter ring around the heavy pumpkin (world space, billboard)
    this.cRingMat = new THREE.MeshBasicMaterial({ color: 0x7ef9ff, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: false });
    this.cRing = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.0, 48, 1, 0, Math.PI * 2), this.cRingMat); this.cRing.renderOrder = 39; this.cRing.visible = false; app.scene.add(this.cRing);
    this.cRingArc = new THREE.Mesh(new THREE.RingGeometry(1.08, 1.22, 48, 1, 0, Math.PI * 2), this.cRingMat); this.cRingArc.renderOrder = 39; this.cRingArc.visible = false; app.scene.add(this.cRingArc);
    this._arcK = -1;
    this.reset();
  }
  reset() {
    this.shieldLevel = 0; this.hit = 0; this.form = 1; this.coreOpen = 0; this.heat = 0; this.mode = 'off'; this.iconKind = null;
    this.shield.visible = false; this.core.visible = false; this.icon.visible = false; this.cRing.visible = false; this.cRingArc.visible = false; for (const p of this.plumes) p.visible = false;
  }
  hideAll() { this.reset(); }
  /** A hit on the shield at world point `at` (impact ripple). strength 0..1 */
  shieldHit(at, strength = 1) {
    const s = this.shield; s.updateWorldMatrix(true, false);
    const local = s.worldToLocal(_t.copy(at)); if (local.lengthSq() > 1e-6) this.shieldMat.uniforms.uHitDir.value.copy(local.normalize());
    this.hit = Math.max(this.hit, strength);
  }
  setIcon(kind) {
    this.iconKind = kind; this.icon.visible = !!kind;
    if (kind) { this.iconMat.map = this.icons[kind]; this.iconMat.needsUpdate = true; }
  }
  /** World position of the core centre (out). */
  corePos(out) { this.core.updateWorldMatrix(true, false); return this.core.getWorldPosition(out); }
  /** Rear-facing normal of the core (world): a pursuer sees the open core when it is roughly in front of this. */
  coreNormal(out) { return out.set(0, 0, 1).transformDirection(this.app.boss.jet.root.matrixWorld); }
  /**
   * Per frame. f: BossFight; stab = shield fraction; tNow (s); cam (world pos); heavy: { pos, frac (0..1 left of the
   * counter window) } | null; low (shield crack amount).
   */
  update(dt, f, tNow, cam, heavy = null) {
    const u = this.shieldMat.uniforms, st = f.state;
    // shield: idle faint, brightens on hits, off while staggered / defeated, forms back during recovering
    const target = st === 'staggered' || st === 'defeated' ? 0 : st === 'vent' ? 0.45 : st === 'recovering' ? 1 : 0.7;
    this.shieldLevel += (target - this.shieldLevel) * Math.min(1, dt * (target > this.shieldLevel ? 4 : 10));
    this.form = st === 'recovering' ? Math.min(1, f.t / f.cfg.recover) : st === 'staggered' ? 0 : Math.min(1, this.form + dt * 2);
    this.hit = Math.max(0, this.hit - dt * 2.4);
    u.uOpacity.value = this.shieldLevel * (0.55 + 0.45 * this.hit) + this.hit * 0.5; u.uHit.value = this.hit; u.uTime.value = tNow;
    u.uCrack.value = st === 'protected' || st === 'telegraph' || st === 'attack' ? Math.max(0, 1 - f.shieldFrac / 0.35) : st === 'vent' ? 0.6 : 0;
    u.uForm.value = this.form;
    this.shield.visible = u.uOpacity.value > 0.01;
    // core: shutters open while the core is eligible; hotter + pulsing while staggered
    const open = f.coreOpen ? 1 : 0; this.coreOpen += (open - this.coreOpen) * Math.min(1, dt * (open ? 7 : 4));
    const stag = st === 'staggered' ? 1 : 0; this.heat += (Math.max(open * 0.7, stag) - this.heat) * Math.min(1, dt * 5);
    this.core.visible = this.coreOpen > 0.02 || this.heat > 0.02;
    if (this.core.visible) {
      const k = this.coreOpen, pulse = 0.85 + 0.15 * Math.sin(tNow * (stag ? 16 : 9));
      for (const p of this.plates) { p.userData.pl.position.x = this.cfgR * (0.62 + 1.25 * k); p.userData.pl.rotation.y = k * 1.1; }
      this.coreBall.scale.setScalar(0.35 + 0.65 * k);
      this.coreMat.color.setHex(stag ? FIGHT_FX.core.hot : FIGHT_FX.core.color).multiplyScalar(0.6 + 0.6 * pulse);
      this.coreGlow.scale.setScalar(FIGHT_FX.core.r * (3 + 4 * k) * pulse * (1 + 0.3 * stag)); this.coreGlowMat.opacity = Math.min(1, 0.25 + k);
      this.coreRing.visible = k > 0.4; this.coreRing.scale.setScalar(1 + 0.12 * Math.sin(tNow * 7)); this.ringMat.opacity = 0.5 + 0.4 * pulse;
      this.plateMat.emissiveIntensity = this.heat * 1.4;
    }
    const plume = f.state === 'vent' || (f.attack === 'heavy' && f.coreOpen) ? 1 : stag * 0.5;
    this.plumeMat.opacity = plume * (0.45 + 0.2 * Math.sin(tNow * 21));
    for (const p of this.plumes) { p.visible = plume > 0.02; p.scale.y = 0.8 + 0.4 * Math.sin(tNow * 13 + p.position.x * 9); }
    // threat icon above Green Maniac (hidden during openings)
    if (this.icon.visible) {
      const m = this.app.boss.maniac.root; m.updateWorldMatrix(true, false); m.getWorldPosition(_t); _t.y -= 2.3; // below the jet: the HUD boss bar sits above him
      this.icon.position.copy(_t); const d = cam.distanceTo(_t), s = Math.max(1.4, d * 0.07) * (this.iconKind === 'heavy' ? 1.25 + 0.12 * Math.sin(tNow * 12) : 1 + 0.06 * Math.sin(tNow * 9));
      this.icon.scale.set(s, s, 1);
    }
    // counter ring around the heavy pumpkin (shrinking arc = the time left to counter)
    const on = !!heavy; this.cRing.visible = this.cRingArc.visible = on;
    if (on) {
      const R = heavy.radius || 1.4; this.cRing.position.copy(heavy.pos); this.cRing.lookAt(cam); this.cRing.scale.setScalar(R * (1 + 0.08 * Math.sin(tNow * 14)));
      this.cRingArc.position.copy(heavy.pos); this.cRingArc.quaternion.copy(this.cRing.quaternion); this.cRingArc.scale.setScalar(R);
      const k = Math.round(Math.max(0, Math.min(1, heavy.frac)) * 24);
      if (k !== this._arcK) { this._arcK = k; this._arcGeos ||= []; this.cRingArc.geometry = this._arcGeos[k] ||= new THREE.RingGeometry(1.08, 1.22, 40, 1, Math.PI / 2, Math.PI * 2 * Math.max(0.02, k / 24)); } // (25 cached arcs, built once)
    }
  }
  get cfgR() { return FIGHT_FX.core.r; }
  dispose() {
    this.shield.removeFromParent(); this.core.removeFromParent(); for (const p of this.plumes) p.removeFromParent(); this.icon.removeFromParent(); this.cRing.removeFromParent(); this.cRingArc.removeFromParent();
  }
}
const _t = new THREE.Vector3();
