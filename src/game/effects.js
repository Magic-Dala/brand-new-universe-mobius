// Pooled visual effects: grid web beams, web nets, explosions, judgement popups,
// approach rings, aim reticles. Nothing here allocates per frame after warm-up.
import * as THREE from 'three';
import { FONT } from '../ui/panel.js';
import { t, onLangChange } from '../core/i18n.js';
import { VfxKit } from './vfx/vfxKit.js';
import { vfxOn } from './vfx/vfxFlags.js';
import * as fxLight from '../art/fxLight.js';

function gridTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.strokeStyle = 'rgba(120,230,255,1)'; g.lineWidth = 5; g.shadowColor = '#22d3ff'; g.shadowBlur = 8;
  for (let i = -128; i <= 256; i += 32) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 128, 128); g.stroke();
    g.beginPath(); g.moveTo(i + 128, 0); g.lineTo(i, 128); g.stroke();
  }
  const tx = new THREE.CanvasTexture(c); tx.wrapS = tx.wrapT = THREE.RepeatWrapping; tx.colorSpace = THREE.SRGBColorSpace; tx.anisotropy = 8;
  return tx;
}
function radialTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(0,0,0,0)') {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, inner); gr.addColorStop(0.4, inner.replace(/[\d.]+\)$/, '0.6)')); gr.addColorStop(1, outer);
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace; return tx;
}

class Pool {
  constructor(make, n) { this.items = []; this.make = make; for (let i = 0; i < n; i++) this.items.push(make()); }
  get() { let it = this.items.find((x) => !x.active); if (!it) { it = this.make(); this.items.push(it); } it.active = true; return it; }
  each(f) { for (const it of this.items) if (it.active) f(it); }
}

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group(); this.root.name = 'effects'; scene.add(this.root);
    this.grid = gridTexture();
    this.glowTex = radialTexture();
    const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true).translate(0, 0.5, 0).rotateX(Math.PI / 2); // along +Z, length 1
    const beamMat = () => new THREE.MeshBasicMaterial({ map: this.grid.clone(), color: 0x9af4ff, transparent: true, opacity: 1.0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: false });
    const coreMat = new THREE.MeshBasicMaterial({ color: 0x3a8cff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false });
    this.beams = new Pool(() => {
      const g = new THREE.Group();
      const m = beamMat(); m.map.needsUpdate = true;
      const shell = new THREE.Mesh(beamGeo, m); const core = new THREE.Mesh(beamGeo, coreMat);
      core.scale.set(0.35, 0.35, 1);
      g.add(shell, core); g.visible = false; this.root.add(g);
      return { g, shell, core, mat: m, active: false, t: 0, life: 0, from: new THREE.Vector3(), to: new THREE.Vector3(), hold: false, follow: null };
    }, 10);
    const netGeo = new THREE.IcosahedronGeometry(1, 2);
    this.nets = new Pool(() => {
      const m = new THREE.MeshBasicMaterial({ map: this.grid, color: 0x8ff0ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
      const mesh = new THREE.Mesh(netGeo, m); mesh.visible = false; this.root.add(mesh);
      return { mesh, mat: m, active: false, t: 0, life: 0.45, r: 0.3, follow: null };
    }, 12);
    // explosions: flash sprite + shock ring + spark points
    const ringGeo = new THREE.RingGeometry(0.85, 1, 40);
    const sparkCount = 16;
    this.booms = new Pool(() => {
      const g = new THREE.Group();
      const flashMat = new THREE.SpriteMaterial({ map: this.glowTex, color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false, fog: false });
      const flash = new THREE.Sprite(flashMat);
      const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: false });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      const pg = new THREE.BufferGeometry();
      const pos = new Float32Array(sparkCount * 3); pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const pm = new THREE.PointsMaterial({ size: 0.06, map: this.glowTex, color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false });
      const pts = new THREE.Points(pg, pm); pts.frustumCulled = false;
      g.add(flash, ring, pts); g.visible = false; this.root.add(g);
      const vel = new Float32Array(sparkCount * 3);
      return { g, flash, ring, pts, vel, active: false, t: 0, life: 0.6, size: 1 };
    }, 16);
    // judgement popups (sprites with cached textures per key+lang)
    this.popTex = new Map();
    onLangChange(() => this.popTex.clear());
    this.pops = new Pool(() => {
      // map set from the start (placeholder) → swapping popup textures never changes the shader program
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, fog: false }));
      s.renderOrder = 40; s.visible = false; this.root.add(s);
      return { s, active: false, t: 0, life: 0.7, base: new THREE.Vector3() };
    }, 24);
    // approach rings
    const arGeo = new THREE.RingGeometry(0.92, 1, 48);
    this.rings = new Pool(() => {
      const m = new THREE.MeshBasicMaterial({ color: 0x7ef0ff, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: false });
      const mesh = new THREE.Mesh(arGeo, m); mesh.visible = false; this.root.add(mesh);
      return { mesh, mat: m, active: false };
    }, 32);
    // reticles (per hand)
    const retGeo = new THREE.RingGeometry(0.05, 0.065, 32);
    const mkRet = (color) => {
      const m = new THREE.Mesh(retGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthTest: false, depthWrite: false, toneMapped: false, fog: false }));
      const dot = new THREE.Mesh(new THREE.CircleGeometry(0.012, 16), m.material); m.add(dot);
      m.renderOrder = 35; m.visible = false; this.root.add(m); return m;
    };
    this.reticles = { left: mkRet(0x9ad8ff), right: mkRet(0x7ef0ff) };
    const lg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]);
    const mkLine = () => { const l = new THREE.Line(lg.clone(), new THREE.LineBasicMaterial({ color: 0x22d3ff, transparent: true, opacity: 0.35, toneMapped: false, fog: false })); l.frustumCulled = false; l.visible = false; this.root.add(l); return l; };
    this.aimLines = { left: mkLine(), right: mkLine() };
    this._v = new THREE.Vector3();
    this.vfx = new VfxKit(scene); // v0.30 GPU VFX kit (per-family flags: ./vfx/vfxFlags.js)
    this.flowLevel = 0; this.vfx.host = this; // v0.45: World Chase Flow level 0–3 (set by worldChase; read by VfxKit.beam)
  }

  // ------------------------------------------------------------- web beam
  /** Grid web beam. `hold` keeps it alive (swinging) until release(); follow = fn returning start pos. */
  web(from, to, { hold = false, life = 0.28, follow = null } = {}) {
    const b = this.beams.get();
    b.from.copy(from); b.to.copy(to); b.t = 0; b.life = life; b.hold = hold; b.follow = follow; b.g.visible = true;
    b.pulse = 0; // v0.44 web pull: brief brightening of a held strand (set to 1 by locomotion, decays here)
    b.vfx = vfxOn(hold ? 'swingRope' : 'webShot'); b.vfxRope = hold; b._vfxInit = false; // v0.30: drawn by the kit (old meshes hidden)
    if (b.vfx) b.g.visible = false;
    this._layBeam(b, 0.001);
    return b;
  }
  releaseBeam(b) { if (b) { b.hold = false; b.t = Math.max(b.t, 0); b.life = b.t + 0.15; } }
  _layBeam(b, frac) {
    if (b.follow) b.follow(b.from);
    const len = b.from.distanceTo(b.to);
    b.g.position.copy(b.from); b.g.lookAt(b.to);
    const r = 0.03 + Math.min(0.03, len * 0.002);
    b.g.scale.set(r, r, Math.max(0.001, len * frac));
    b.mat.map.repeat.set(1, Math.max(1, len * 1.6)); // coarser grid: no shimmering / moiré along thin beams
  }
  // ------------------------------------------------------------- net
  net(pos, r = 0.3, follow = null, life = 0.45) {
    const n = this.nets.get(); n.t = 0; n.r = r; n.life = life; n.follow = follow; n.mesh.position.copy(pos); n.mesh.visible = true;
    n.vfxSlot = vfxOn('webShot') ? this.vfx.net(pos, r, life) : -1; // v0.30 hex web net
    if (n.vfxSlot >= 0) n.mesh.visible = false;
    return n;
  }
  // ------------------------------------------------------------- boom
  boom(pos, { color = 0x5fd8ff, size = 1, life = 0.6 } = {}) {
    if (this.vfx.routeBoom(pos, color, size, life)) return null; // v0.30: routed by colour family when its flag is on
    const e = this.booms.get(); e.t = 0; e.life = life; e.size = size; e.g.visible = true; e.g.position.copy(pos);
    e.flash.material.color.set(color); e.ring.material.color.set(color); e.pts.material.color.set(color);
    const p = e.pts.geometry.attributes.position.array;
    for (let i = 0; i < p.length; i += 3) {
      p[i] = p[i + 1] = p[i + 2] = 0;
      const th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1), sp = (2 + Math.random() * 4) * size;
      e.vel[i] = Math.sin(ph) * Math.cos(th) * sp; e.vel[i + 1] = Math.cos(ph) * sp; e.vel[i + 2] = Math.sin(ph) * Math.sin(th) * sp;
    }
    e.pts.geometry.attributes.position.needsUpdate = true;
    return e;
  }
  // ------------------------------------------------------------- popup
  popup(key, pos, color) {
    const k = `${key}|${color}`;
    let tex = this.popTex.get(k);
    if (!tex) {
      const c = document.createElement('canvas'); c.width = 512; c.height = 128;
      const g = c.getContext('2d'); g.textAlign = 'center'; g.textBaseline = 'middle';
      let fs = 84; g.font = `900 italic ${fs}px ${FONT}`;
      while (fs > 40 && g.measureText(t(key)).width > 470) { fs -= 4; g.font = `900 italic ${fs}px ${FONT}`; } // long words fit (e.g. TRIPLE BREAK)
      g.lineWidth = 12; g.strokeStyle = 'rgba(0,10,30,0.9)'; g.strokeText(t(key), 256, 66);
      g.shadowColor = color; g.shadowBlur = 20; g.fillStyle = color; g.fillText(t(key), 256, 66);
      tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; this.popTex.set(k, tex);
    }
    const p = this.pops.get(); p.t = 0; p.s.material.map = tex; p.s.visible = true;
    p.base.copy(pos); p.s.position.copy(pos);
    return p;
  }
  ring() { const r = this.rings.get(); r.mesh.visible = true; return r; }
  /** Create the judgement popup textures ahead of time (no canvas work during play). */
  preloadPopups(entries) { for (const [key, color] of entries) { const p = this.popup(key, new THREE.Vector3(0, -1000, 0), color); p.active = false; p.s.visible = false; } }
  /**
   * Shader / texture warm-up: show every pooled effect for a few frames at `pos` (hidden under
   * the platform roof, still inside the view) with ~zero opacity, so the GPU programs and textures
   * are created during the "Ready" lead-in instead of on the first hits (that caused hitches).
   */
  prewarm(pos, frames = 3) {
    this._warm = { frames, items: [] };
    const show = (o) => { o.visible = true; o.position.copy(pos); this._warm.items.push(o); };
    for (const pool of [this.beams, this.nets, this.booms, this.pops, this.rings]) for (const it of pool.items) if (!it.active) show(it.g || it.mesh || it.s);
    for (const b of this.beams.items) if (!b.active) b.g.scale.set(0.05, 0.05, 0.3);
    for (const p of this.pops.items) if (!p.active) p.s.material.opacity = 0; // popups ignore depth: keep them invisible
    this.vfx.prewarm(frames + 1);
  }
  /** v0.30: compile the VFX kit programs during a lead-in (story start). */
  prewarmVfx(frames = 4) { this.vfx.prewarm(frames); }
  freeRing(r) { r.active = false; r.mesh.visible = false; }

  update(dt, camera) {
    const camPos = camera.getWorldPosition(this._v);
    this.vfx.preUpdate();
    if (this._warm && --this._warm.frames <= 0) { for (const o of this._warm.items) o.visible = false; this._warm = null; }
    this.beams.each((b) => {
      b.t += dt;
      const grow = Math.min(1, b.t / 0.06);
      this._layBeam(b, grow);
      b.mat.map.offset.y -= dt * 1.5;
      const fade = b.hold ? 1 : Math.max(0, 1 - Math.max(0, b.t - b.life * 0.5) / (b.life * 0.5));
      b.mat.opacity = 0.95 * fade;
      if (b.pulse > 0) { b.pulse = Math.max(0, b.pulse - dt * 3.5); if (!b.vfx) { const r = b.g.scale.x * (1 + 0.5 * b.pulse); b.g.scale.x = b.g.scale.y = r; } }
      if (b.vfx) { b.g.visible = false; this.vfx.beam(b, grow, fade); }
      if (!b.hold && b.t >= b.life) { b.active = false; b.g.visible = false; b.follow = null; }
    });
    this.nets.each((n) => {
      n.t += dt; const k = n.t / n.life;
      if (n.follow) { n.follow(n.mesh.position); if (n.vfxSlot >= 0) this.vfx.shells.setPos(n.vfxSlot, n.mesh.position); }
      n.mesh.scale.setScalar(n.r * (0.4 + 0.8 * Math.min(1, k * 3)));
      n.mesh.rotation.y += dt * 2;
      n.mat.opacity = 0.9 * (1 - k);
      if (k >= 1) { n.active = false; n.mesh.visible = false; n.follow = null; }
    });
    this.booms.each((e) => {
      e.t += dt; const k = e.t / e.life;
      e.flash.scale.setScalar(e.size * (0.5 + 0.9 * Math.min(1, k * 4))); // smaller additive flash: far less overdraw on Quest
      e.flash.material.opacity = Math.max(0, 0.85 - k * 1.5);
      e.ring.scale.setScalar(e.size * (0.2 + 1.8 * k)); e.ring.lookAt(camPos);
      e.ring.material.opacity = Math.max(0, 0.9 * (1 - k));
      const p = e.pts.geometry.attributes.position.array;
      for (let i = 0; i < p.length; i += 3) { p[i] += e.vel[i] * dt; p[i + 1] += e.vel[i + 1] * dt; p[i + 2] += e.vel[i + 2] * dt; e.vel[i + 1] -= 6 * dt; }
      e.pts.geometry.attributes.position.needsUpdate = true;
      e.pts.material.opacity = 1 - k;
      if (k >= 1) { e.active = false; e.g.visible = false; }
    });
    this.pops.each((p) => {
      p.t += dt; const k = p.t / p.life;
      const d = p.base.distanceTo(camPos);
      const sc = 0.09 * Math.max(1.5, d) * (k < 0.15 ? 0.7 + 2 * k : 1);
      p.s.scale.set(sc * 4, sc, 1);
      p.s.position.copy(p.base); p.s.position.y += 0.25 * k;
      p.s.material.opacity = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
      if (k >= 1) { p.active = false; p.s.visible = false; }
    });
    this.vfx.update(dt, camera); fxLight.update(dt); // v0.30
  }
  clear() {
    for (const pool of [this.beams, this.nets, this.booms, this.pops, this.rings]) pool.items.forEach((x) => {
      x.active = false; (x.g || x.mesh || x.s).visible = false; x.follow = null; x.hold = false;
    });
    for (const h of ['left', 'right']) { this.reticles[h].visible = false; this.aimLines[h].visible = false; }
    this.vfx.clear(); fxLight.clear();
  }
  setAimLine(h, from, to, opacity = 0.35) {
    const l = this.aimLines[h]; const a = l.geometry.attributes.position;
    a.setXYZ(0, from.x, from.y, from.z); a.setXYZ(1, to.x, to.y, to.z); a.needsUpdate = true;
    l.material.opacity = opacity; l.visible = true;
  }
  /** Origin rebase (endless city): shift every active effect by (dx, 0, dz) so nothing jumps. */
  shift(dx, dz) {
    const d = new THREE.Vector3(dx, 0, dz);
    this.beams.each((b) => { b.from.add(d); b.to.add(d); });
    this.nets.each((n) => n.mesh.position.add(d));
    this.booms.each((e) => e.g.position.add(d));
    this.pops.each((p) => { p.base.add(d); p.s.position.add(d); });
    this.rings.each((r) => r.mesh.position.add(d));
    this.vfx.shift(dx, dz); fxLight.shift(dx, dz);
  }
  activeCount() { let n = 0; for (const pool of [this.beams, this.nets, this.booms, this.pops, this.rings]) pool.each(() => n++); return n; }
}
