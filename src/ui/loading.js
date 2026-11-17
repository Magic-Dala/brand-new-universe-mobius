// In-XR loading screen (black + "Loading factory interior…" + spinner). Rendered by three.js
// INSIDE the immersive session (no DOM overlay, no page reload, the XR session stays alive).
// Drawn on top of the story fade sphere (group render orders 2000 / 2001). No fake percentage:
// an indeterminate spinner only. Error state: zh/en message + Retry + Main Menu (never a
// permanent black screen).
import * as THREE from 'three';
import { t } from '../core/i18n.js';
import { Panel, techFrame, wrapText, COLORS, FONT } from './panel.js';

const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler();

export class LoadingOverlay {
  constructor(app) {
    this.app = app;
    this.state = 'hidden'; // hidden | loading | error
    this.textKey = 'loading.factory'; this.errKey = 'loading.error.factory';
    this.group = new THREE.Group(); this.group.name = 'LoadingOverlay'; this.group.renderOrder = 2001; this.group.visible = false;
    app.world.player.add(this.group); // rig-relative: follows the rig when the player is moved to the interior
    this.panel = new Panel({ width: 0.9, height: 0.36, ppm: 900, name: 'loading', render: (g) => this._draw(g) });
    this.panel.interactive = false;
    this.panel.mat.depthTest = false; this.panel.mesh.renderOrder = 2;
    this.panel.root.position.set(0, 0, -1.4);
    this.anchor = new THREE.Group(); this.anchor.add(this.panel.root); this.group.add(this.anchor);
    this.anchor.renderOrder = 2001; this.panel.root.renderOrder = 2001; // nested Groups reset the group order: keep it on every level
    // spinner: an open ring rotating below the text (indeterminate, no %)
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x22d3ff, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, fog: false });
    this.spinner = new THREE.Mesh(new THREE.RingGeometry(0.035, 0.045, 32, 1, 0, Math.PI * 1.45), ringMat);
    this.spinner.renderOrder = 3; this.spinner.position.set(0, -0.07, -1.395); this.anchor.add(this.spinner);
    app.panels.add(this.panel);
    this._onRetry = null; this._onMain = null;
  }
  get visible() { return this.state !== 'hidden'; }
  show(textKey = 'loading.factory', vars = null) {
    this.textKey = textKey; this.textVars = vars; this.state = 'loading';
    this.panel.interactive = false; this.panel.setButtons([]);
    this.group.visible = true; this.spinner.visible = true; this.panel.dirty = true;
    this._place(true);
  }
  showError(errKey, { onRetry, onMain }) {
    this.errKey = errKey; this.state = 'error';
    this._onRetry = onRetry; this._onMain = onMain;
    const W = this.panel.cw, H = this.panel.ch;
    this.panel.setButtons([
      { id: 'retry', x: 40, y: H - 110, w: (W - 100) / 2, h: 80, style: 'primary', label: () => t('loading.retry'), onClick: () => this._onRetry?.() },
      { id: 'main', x: 60 + (W - 100) / 2, y: H - 110, w: (W - 100) / 2, h: 80, label: () => t('menu.main'), onClick: () => this._onMain?.() },
    ]);
    this.panel.interactive = true; this.spinner.visible = false; this.group.visible = true; this.panel.dirty = true;
    this._place(true);
  }
  hide() { this.state = 'hidden'; this.group.visible = false; this.panel.interactive = false; this.panel.setButtons([]); }
  /** keep the panel in front of the user, following the head yaw lazily (world-stable feel) */
  _place(snap) {
    const cam = this.app.camera, rig = this.app.world.player;
    cam.updateMatrixWorld(true);
    cam.getWorldPosition(_v); rig.worldToLocal(_v);
    cam.getWorldQuaternion(_q); _q.premultiply(rig.getWorldQuaternion(new THREE.Quaternion()).invert());
    _e.setFromQuaternion(_q, 'YXZ');
    const target = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, _e.y, 0, 'YXZ'));
    this.anchor.position.copy(_v);
    if (snap) this.anchor.quaternion.copy(target); else this.anchor.quaternion.slerp(target, this._k);
  }
  update(dt) {
    if (this.state === 'hidden') return;
    this._k = 1 - Math.exp(-dt * 3);
    this._place(false);
    if (this.spinner.visible) this.spinner.rotation.z -= dt * 4.5;
    this.panel.update();
  }
  _draw(g) {
    const W = this.panel.cw, H = this.panel.ch;
    g.clearRect(0, 0, W, H);
    if (this.state === 'error') {
      techFrame(g, 4, 4, W - 8, H - 8, { fill: 'rgba(14,6,12,0.96)', stroke: COLORS.bad, c: 20 });
      g.textAlign = 'center'; g.textBaseline = 'top';
      g.fillStyle = COLORS.bad; g.font = `800 40px ${FONT}`; g.fillText(t('loading.error.title'), W / 2, 30);
      g.fillStyle = COLORS.text; g.font = `500 28px ${FONT}`; g.textAlign = 'left'; wrapText(g, t(this.errKey), 40, 90, W - 80, 34, 2);
      return;
    }
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = COLORS.text; g.font = `700 40px ${FONT}`; g.fillText(t(this.textKey, this.textVars || undefined), W / 2, H * 0.36);
  }
}
