// Canvas-texture world-space panels with ray (pinch/trigger) and fingertip
// poke interaction. Bilingual text via system CJK fonts.
import * as THREE from 'three';
import { audio } from '../core/audio.js';

export const FONT = '"Noto Sans TC","PingFang TC","Microsoft JhengHei","Heiti TC","Noto Sans CJK TC",system-ui,-apple-system,"Segoe UI",sans-serif';
export const COLORS = {
  bg: 'rgba(6,16,34,0.86)', bg2: 'rgba(10,30,60,0.92)', line: '#22d3ff', lineDim: 'rgba(34,211,255,0.35)',
  text: '#e8f7ff', dim: '#8fb6cc', accent: '#22d3ff', warn: '#ffb020', bad: '#ff4d6d', good: '#7dff9a', perfect: '#7ef9ff',
};

export const TAG_YELLOW = '#ffd21f';
/**
 * v0.49: the draw order of every interactive panel (menus, the tutorials), as a group order on the panel's root. Later than
 * anything see-through in the world, so nothing behind a panel is painted over it: the city's far skyline (950) and light
 * shafts (960) were drawn after the menu and showed across its buttons. Earlier than the fade (2000), the loading screen
 * (2001) and the pointer rays (2500), which stay on top as before. A panel is still hidden by solid things in front of it.
 */
export const UI_GROUP_ORDER = 1500;
export function roundRect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h); g.lineTo(x + r, y + h);
  g.quadraticCurveTo(x, y + h, x, y + h - r); g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y); g.closePath();
}
/** Tech-panel frame with chamfered corners. */
export function techFrame(g, x, y, w, h, { fill = COLORS.bg, stroke = COLORS.line, lw = 3, c = 18, glow = true } = {}) {
  g.save();
  g.beginPath(); g.moveTo(x + c, y); g.lineTo(x + w - c, y); g.lineTo(x + w, y + c); g.lineTo(x + w, y + h - c);
  g.lineTo(x + w - c, y + h); g.lineTo(x + c, y + h); g.lineTo(x, y + h - c); g.lineTo(x, y + c); g.closePath();
  g.fillStyle = fill; g.fill();
  if (glow) { g.shadowColor = stroke; g.shadowBlur = 12; }
  g.strokeStyle = stroke; g.lineWidth = lw; g.stroke();
  g.restore();
}
export function fitText(g, text, maxW, size, weight = 600) {
  let s = size;
  g.font = `${weight} ${s}px ${FONT}`;
  while (g.measureText(text).width > maxW && s > 10) { s -= 2; g.font = `${weight} ${s}px ${FONT}`; }
  return s;
}
export function wrapText(g, text, x, y, maxW, lineH, maxLines = 6) {
  // CJK-aware wrap: break anywhere for CJK, at spaces for latin
  const words = /[　-鿿＀-￯]/.test(text) ? Array.from(text) : text.split(/(\s+)/);
  let line = '', lines = 0;
  for (const w of words) {
    const test = line + w;
    if (g.measureText(test).width > maxW && line) {
      g.fillText(line.trim(), x, y); y += lineH; line = w.trimStart(); lines++;
      if (lines >= maxLines) return y;
    } else line = test;
  }
  if (line) { g.fillText(line.trim(), x, y); y += lineH; }
  return y;
}

let panelId = 0;
export class Panel {
  /**
   * @param {object} o { width, height (metres), ppm (pixels per metre), name, transparent }
   */
  constructor({ width = 0.9, height = 0.6, ppm = 1000, name = 'panel', render } = {}) {
    this.id = ++panelId;
    this.name = name;
    this.w = width; this.h = height;
    this.cw = Math.round(width * ppm); this.ch = Math.round(height * ppm);
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.cw; this.canvas.height = this.ch;
    this.g = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    this.tex.generateMipmaps = true; this.tex.minFilter = THREE.LinearMipmapLinearFilter;
    this.mat = new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: false, toneMapped: false, fog: false });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), this.mat);
    this.mesh.renderOrder = 10;
    this.mesh.userData.panel = this;
    this.root = new THREE.Group(); this.root.name = name; this.root.add(this.mesh);
    this.buttons = [];
    this.hover = null;
    this.dirty = true;
    this.renderFn = render || null;
    this.interactive = true;
    this.pokeState = new Map();
  }
  get visible() { return this.root.visible; }
  set visible(v) { if (this.root.visible !== v) { this.root.visible = v; if (v) this.dirty = true; } }
  setButtons(list) { this.buttons = list; this.dirty = true; }
  /** button: { id, x,y,w,h (px), label: string|fn, onClick, disabled?, selected?, style? } */
  redraw() {
    const g = this.g;
    g.clearRect(0, 0, this.cw, this.ch);
    this.renderFn?.(g, this);
    for (const b of this.buttons) this.drawButton(b);
    this.tex.needsUpdate = true;
    this.dirty = false;
  }
  drawButton(b) {
    const g = this.g, hov = this.hover === b;
    const label = typeof b.label === 'function' ? b.label() : b.label;
    const sel = typeof b.selected === 'function' ? b.selected() : b.selected;
    const dis = typeof b.disabled === 'function' ? b.disabled() : b.disabled;
    if (b.draw) { b.draw(g, b, { hover: hov, selected: sel, disabled: dis }); return; } // v0.40: custom-drawn buttons (map cards)
    const primary = b.style === 'primary';
    const fill = dis ? 'rgba(30,40,55,0.7)' : primary ? (hov ? '#1aa8e0' : '#0d6fa8') : sel ? 'rgba(20,110,170,0.9)' : hov ? 'rgba(25,80,130,0.95)' : COLORS.bg2;
    techFrame(g, b.x, b.y, b.w, b.h, { fill, stroke: dis ? '#456' : hov || sel || primary ? '#7ef0ff' : COLORS.lineDim, lw: hov ? 4 : 3, c: Math.min(14, b.h / 4), glow: hov || primary });
    g.fillStyle = dis ? '#789' : COLORS.text; g.textAlign = 'center'; g.textBaseline = 'middle';
    const size = fitText(g, label, b.w - 24, b.size || Math.min(44, b.h * 0.42), 700);
    if (b.sub) {
      g.fillText(label, b.x + b.w / 2, b.y + b.h * 0.38);
      g.fillStyle = COLORS.dim; fitText(g, typeof b.sub === 'function' ? b.sub() : b.sub, b.w - 24, size * 0.55, 500);
      g.fillText(typeof b.sub === 'function' ? b.sub() : b.sub, b.x + b.w / 2, b.y + b.h * 0.72);
    } else g.fillText(label, b.x + b.w / 2, b.y + b.h / 2 + 1);
    const tag = typeof b.tag === 'function' ? b.tag() : b.tag; // v0.49: a small yellow label in the button's top right corner ("Recommended")
    if (tag) {
      g.font = `800 24px ${FONT}`; const tw = Math.ceil(g.measureText(tag).width) + 30, th = 38, tx = b.x + b.w - tw - 16, ty = b.y + 12;
      roundRect(g, tx, ty, tw, th, 9); g.fillStyle = TAG_YELLOW; g.fill();
      g.fillStyle = '#231a00'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(tag, tx + tw / 2, ty + th / 2 + 1);
    }
  }
  update() { if (this.dirty && this.root.visible) this.redraw(); }
  uvToPx(uv) { return { x: uv.x * this.cw, y: (1 - uv.y) * this.ch }; }
  buttonAt(px) {
    for (const b of this.buttons) {
      const dis = typeof b.disabled === 'function' ? b.disabled() : b.disabled;
      if (!dis && px.x >= b.x && px.x <= b.x + b.w && px.y >= b.y && px.y <= b.y + b.h) return b;
    }
    return null;
  }
  setHover(b) { if (b !== this.hover) { this.hover = b; this.dirty = true; if (b) audio.play('hover'); } }
  click(b) { audio.play('click'); this.dirty = true; b.onClick?.(); }
}

/**
 * PanelManager: resolves hover/select for all visible interactive panels using
 * hub pointers (ray + select) and fingertip poke. Reports per-hand UI hover so
 * the input hub can suppress attacks on that hand.
 */
export class PanelManager {
  constructor() {
    this.panels = new Set();
    this.ray = new THREE.Raycaster();
    this.cursor = { left: makeCursor(), right: makeCursor() };
    this.rayLines = { left: makeRayLine(), right: makeRayLine() };
    this.hoverHand = { left: false, right: false };
    this.poke = { left: { armed: true }, right: { armed: true } };
  }
  add(p) { if (!p.root.renderOrder) p.root.renderOrder = UI_GROUP_ORDER; this.panels.add(p); return p; } // (a panel with its own group order, like the loading screen's, keeps it)
  attach(scene) {
    // own group drawn last (above the fade / loading screen too: the error buttons stay pointable)
    const g = new THREE.Group(); g.name = 'UIPointers'; g.renderOrder = 2500; scene.add(g);
    for (const h of ['left', 'right']) { g.add(this.cursor[h]); g.add(this.rayLines[h]); }
  }
  activePanels() { return [...this.panels].filter((p) => p.interactive && isVisible(p.root)); }

  update(hub, { showRays = true } = {}) {
    const active = this.activePanels();
    for (const p of this.panels) p.update();
    for (const h of ['left', 'right']) {
      const ptr = hub.pointers[h];
      const cur = this.cursor[h], line = this.rayLines[h];
      cur.visible = false; line.visible = false; this.hoverHand[h] = false;
      if (!active.length) continue;
      // 1) poke with fingertip (hands/controllers) – direct touch wins
      let poked = false;
      if (ptr.tipValid && hub.mode[h] !== 'desktop') {
        for (const p of active) {
          const local = p.mesh.worldToLocal(ptr.tip.clone());
          const inside = Math.abs(local.x) <= p.w / 2 && Math.abs(local.y) <= p.h / 2;
          if (!inside || local.z > 0.06 || local.z < -0.05) continue;
          const px = p.uvToPx({ x: local.x / p.w + 0.5, y: local.y / p.h + 0.5 });
          const b = p.buttonAt(px);
          p.setHover(b); this.hoverHand[h] = true; poked = true;
          const st = this.poke[h];
          if (local.z > 0.02) st.armed = true;
          if (st.armed && local.z < 0.004 && b) { st.armed = false; p.click(b); hub.haptic(h, 0.4, 25); }
          break;
        }
      }
      if (poked || !ptr.valid) continue;
      // 2) ray
      this.ray.set(ptr.origin, ptr.dir); this.ray.far = 6;
      const hits = this.ray.intersectObjects(active.map((p) => p.mesh), false);
      if (!hits.length) { if (showRays && hub.mode[h] === 'controller') { line.visible = true; setRay(line, ptr.origin, ptr.dir, 2.5); } continue; }
      const hit = hits[0], p = hit.object.userData.panel;
      const b = p.buttonAt(p.uvToPx(hit.uv));
      p.setHover(b);
      this.hoverHand[h] = true;
      if (hub.mode[h] !== 'desktop') {
        cur.visible = true; cur.position.copy(hit.point).addScaledVector(ptr.dir, -0.004);
        cur.scale.setScalar(b ? 1.4 : 1);
        if (showRays) { line.visible = true; setRay(line, ptr.origin, ptr.dir, hit.distance); }
      }
      if (ptr.selectDown && b) { p.click(b); hub.haptic(h, 0.35, 20); }
    }
    // clear hover on panels no hand touches
    for (const p of active) {
      const touched = ['left', 'right'].some((h) => this.hoverHand[h]);
      if (!touched && p.hover) p.setHover(null);
    }
  }
}
function isVisible(o) { while (o) { if (!o.visible) return false; o = o.parent; } return true; }
function makeCursor() {
  const m = new THREE.Mesh(new THREE.RingGeometry(0.006, 0.011, 24), new THREE.MeshBasicMaterial({ color: 0x7ef0ff, depthTest: false, transparent: true, toneMapped: false }));
  m.renderOrder = 30; m.visible = false;
  m.onBeforeRender = (r, s, cam) => { m.quaternion.copy(cam.getWorldQuaternion(new THREE.Quaternion())); };
  return m;
}
function makeRayLine() {
  const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]);
  const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0x22d3ff, transparent: true, opacity: 0.7, toneMapped: false }));
  l.visible = false; l.frustumCulled = false; l.renderOrder = 29;
  return l;
}
function setRay(line, o, d, len) {
  const a = line.geometry.attributes.position;
  a.setXYZ(0, o.x, o.y, o.z); a.setXYZ(1, o.x + d.x * len, o.y + d.y * len, o.z + d.z * len); a.needsUpdate = true;
}
