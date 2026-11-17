// v0.49 Story tutorials — the panel. One canvas panel (title, page count, one line of text, Skip / Back / Next / Done:
// the game's own Panel, so pointing, pinching, poking and both languages work as in the menus) with the page's clips on
// planes just in front of it. What is open and which page comes from the pure model (src/game/tutorial.js, owned by the
// Story); this file only shows it.
//   · two <video> elements (muted, looping) are reused for every page: only the page on screen decodes
//   · the clips are fetched once (blob URLs) when the Story starts, so a page change does not wait for the network
//   · a clip that is not ready (or failed to load) leaves its dark frame showing: a page never blocks
//   · the video material's shader is compiled in preload(), not when the panel first appears
import * as THREE from 'three';
import { Panel, techFrame, wrapText, fitText, roundRect, COLORS, FONT } from './panel.js';
import { TUTORIALS, TUTORIAL_PANEL as TP, TUTORIAL_UI } from '../data/tutorials.js';
import { mediaSlots, fitInto, panelSpot, clipUpload, newClip } from '../game/tutorial.js';
import { ROOM } from '../data/layout.js';
import { t, onLangChange } from '../core/i18n.js';

const BASE = 'tutorials/';
const _v = new THREE.Vector3(), _f = new THREE.Vector3(), _q = new THREE.Quaternion();
/** Mobius's room as a box on the floor plane, world coordinates (the room is not rotated). */
const ROOM_BOX = { minX: ROOM.origin[0] - ROOM.size.w / 2, maxX: ROOM.origin[0] + ROOM.size.w / 2, minZ: ROOM.origin[2] - ROOM.size.d / 2, maxZ: ROOM.origin[2] + ROOM.size.d / 2 };
// the same parameters as Panel's own material: the picture's plane shares its shader program
const planeMat = (map) => new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, toneMapped: false, fog: false });

export class TutorialPanel {
  constructor(app) {
    this.app = app;
    this.panel = new Panel({ width: TP.width, height: TP.height, ppm: TP.ppm, name: 'tutorial', render: (g) => this._draw(g) });
    this.panel.visible = false; app.scene.add(this.panel.root); app.panels.add(this.panel);
    this.vid = [this._videoSlot(), this._videoSlot()];
    this.img = this._imageSlot();
    this._urls = new Map(); // file → blob URL (once fetched)
    this._id = null; this._page = -1; this._media = []; this._loading = null;
    onLangChange(() => { this.panel.dirty = true; });
  }
  /** The Story's page model. */
  get model() { return this.app.story?.tutorials || null; }
  get visible() { return this.panel.visible; }
  /** Resolves when every clip has been fetched (or failed) and the shader is compiled. Starts the fetch on first use. */
  get ready() { return this.preload(); }

  _videoSlot() {
    const video = document.createElement('video');
    video.muted = true; video.defaultMuted = true; video.loop = true; video.playsInline = true; video.preload = 'auto'; video.crossOrigin = 'anonymous';
    video.setAttribute('muted', ''); video.setAttribute('playsinline', '');
    const tex = new THREE.VideoTexture(video); tex.colorSpace = THREE.SRGBColorSpace; tex.minFilter = tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = false;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), planeMat(tex)); mesh.name = 'tutorialClip'; mesh.renderOrder = 11; mesh.position.z = 0.002; mesh.visible = false;
    this.panel.root.add(mesh);
    return { video, tex, mesh, file: null, want: false, up: newClip() };
  }
  _imageSlot() {
    const tex = new THREE.Texture(); tex.colorSpace = THREE.SRGBColorSpace; tex.minFilter = tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = false;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), planeMat(tex)); mesh.name = 'tutorialPicture'; mesh.renderOrder = 11; mesh.position.z = 0.002; mesh.visible = false;
    this.panel.root.add(mesh);
    return { tex, mesh, file: null, want: false, ok: false, aspect: 16 / 9, images: new Map() };
  }

  /** Fetch every clip once and compile the video plane's shader. Safe to call again: the same promise. */
  preload() {
    if (this._loading) return this._loading;
    const media = Object.values(TUTORIALS).flatMap((tut) => tut.pages.flatMap((p) => p.media));
    const jobs = media.map((m) => m.kind === 'video'
      ? fetch(BASE + m.file).then((r) => { if (!r.ok) throw new Error(`${m.file}: ${r.status}`); return r.blob(); }).then((b) => { this._urls.set(m.file, URL.createObjectURL(b)); })
      : new Promise((res, rej) => { const im = new Image(); im.onload = () => { this.img.images.set(m.file, im); res(); }; im.onerror = () => rej(new Error(m.file)); im.src = BASE + m.file; }));
    this._compile();
    return (this._loading = Promise.allSettled(jobs).then((rs) => { const bad = rs.filter((r) => r.status === 'rejected'); if (bad.length) console.warn('tutorial clips not loaded:', bad.map((r) => r.reason?.message)); return bad.length === 0; }));
  }
  /** The video plane's program (a video texture decodes sRGB in the shader: its own program) built ahead of time. */
  _compile() {
    const r = this.app.renderer, root = this.panel.root, m = this.vid[0].mesh, was = [root.visible, m.visible];
    try { root.visible = true; m.visible = true; r.compile(root, this.app.camera, this.app.scene); } catch (e) { console.warn('compile', e); } finally { root.visible = was[0]; m.visible = was[1]; }
  }

  // ---------------------------------------------------------------- per frame
  update() {
    const app = this.app, T = this.model, id = T && app.state === 'story' ? T.active : null;
    if (id !== this._id || (id && T.page !== this._page)) {
      const opened = !!id && id !== this._id;
      this._id = id; this._page = id ? T.page : -1;
      if (id) { if (opened) this._place(); this._apply(); } else this._clear();
    }
    const vis = !!id && !app.menus.open && !app.story.paused;
    if (vis !== this.panel.visible) { this.panel.visible = vis; for (const s of this.vid) if (s.want) { if (vis) this._run(s); else s.video.pause(); } }
    if (!vis) return;
    for (const s of this.vid) {
      if (!s.want) continue;
      const v = s.video;
      if (v.readyState < 2) { s.mesh.visible = false; continue; } // (its dark frame shows meanwhile)
      s.mesh.visible = true;
      if (v.paused) this._run(s);
      if (clipUpload(s.up, v.currentTime, performance.now(), true)) s.tex.needsUpdate = true; // about once per video frame while it plays
    }
    this.img.mesh.visible = this.img.want && this.img.ok;
  }
  _run(s) { const p = s.video.play(); if (p && p.catch) p.catch(() => {}); }

  /** The panel in front of the player (toward the middle of the room when a wall is in the way), facing them. */
  _place() {
    const cam = this.app.camera, root = this.panel.root;
    cam.getWorldPosition(_v); _f.set(0, 0, -1).applyQuaternion(cam.getWorldQuaternion(_q)); _f.y = 0;
    if (_f.lengthSq() < 1e-4) _f.set(0, 0, -1); _f.normalize();
    const s = panelSpot({ x: _v.x, z: _v.z }, { x: _f.x, z: _f.z }, this.app.story?.inRoom ? ROOM_BOX : null);
    root.position.set(s.x, _v.y + TP.yOff, s.z); root.lookAt(_v.x, root.position.y, _v.z);
  }
  /** A rectangle in panel pixels → the plane's position and size on the panel. */
  _fit(mesh, r) { mesh.position.set((r.x + r.w / 2) / TP.ppm - TP.width / 2, TP.height / 2 - (r.y + r.h / 2) / TP.ppm, 0.002); mesh.scale.set(r.w / TP.ppm, r.h / TP.ppm, 1); }

  /** Show the model's current page: clips into the slots, buttons for this page. */
  _apply() {
    const T = this.model, pg = T.current, slots = mediaSlots(pg.media.length);
    let vi = 0; this.img.want = false; this._media = []; this._slots = slots;
    pg.media.forEach((m, i) => {
      if (m.kind === 'video') {
        const s = this.vid[vi++];
        if (s.file !== m.file) { s.file = m.file; s.up = newClip(); s.mesh.visible = false; s.video.src = this._urls.get(m.file) || BASE + m.file; }
        s.want = true; this._fit(s.mesh, slots[i]); this._run(s);
        this._media.push({ m, s });
      } else {
        const I = this.img, im = I.images.get(m.file);
        I.want = true; I.ok = !!im;
        if (im && I.file !== m.file) { I.file = m.file; I.tex.image = im; I.tex.needsUpdate = true; I.aspect = im.width / im.height; }
        this._fit(I.mesh, fitInto(I.aspect, slots[i]));
        this._media.push({ m, img: I });
      }
    });
    for (; vi < this.vid.length; vi++) { const s = this.vid[vi]; s.want = false; s.video.pause(); s.mesh.visible = false; }
    this.img.mesh.visible = false; // (shown by update() once it is wanted and loaded)
    this._buttons();
    this.panel.dirty = true;
  }
  _clear() {
    for (const s of this.vid) { s.want = false; s.video.pause(); s.mesh.visible = false; }
    this.img.want = false; this.img.mesh.visible = false; this._media = []; this.panel.setButtons([]); this.panel.visible = false;
  }
  _buttons() {
    const T = this.model, B = TP.buttons, W = this.panel.cw, list = [];
    const mk = (id, x, key, onClick, style) => list.push({ id, x, y: B.y, w: B.w, h: B.h, label: () => t(key), onClick, style });
    mk('skip', B.pad, TUTORIAL_UI.skip, () => T.skip());
    if (!T.isFirst) mk('back', W - B.pad - B.w * 2 - 24, TUTORIAL_UI.back, () => T.back());
    if (T.isLast) mk('done', W - B.pad - B.w, TUTORIAL_UI.done, () => T.done(), 'primary');
    else mk('next', W - B.pad - B.w, TUTORIAL_UI.next, () => T.next(), 'primary');
    this.panel.setButtons(list);
  }

  _draw(g) {
    const T = this.model, pg = T?.current, W = this.panel.cw, H = this.panel.ch;
    techFrame(g, 6, 6, W - 12, H - 12, { fill: 'rgba(5,16,34,0.94)', c: 28 });
    if (!pg) return;
    g.textBaseline = 'middle';
    g.fillStyle = COLORS.dim; g.textAlign = 'right'; g.font = `600 34px ${FONT}`; g.fillText(`${T.page + 1} / ${T.pageCount}`, W - 44, TP.titleH / 2 + 8);
    g.fillStyle = COLORS.perfect; g.textAlign = 'left'; fitText(g, t(pg.title), W - 260, 56, 800); g.fillText(t(pg.title), 44, TP.titleH / 2 + 8);
    // a dark frame behind each clip (what shows until the clip is ready)
    for (const s of this._slots || []) { g.save(); roundRect(g, s.x - 3, s.y - 3, s.w + 6, s.h + 6, 10); g.fillStyle = 'rgba(0,6,16,0.9)'; g.fill(); g.strokeStyle = COLORS.lineDim; g.lineWidth = 3; g.stroke(); g.restore(); }
    g.fillStyle = COLORS.text; g.textAlign = 'left'; g.textBaseline = 'top'; g.font = `500 34px ${FONT}`;
    wrapText(g, t(pg.line), TP.caption.x + 4, TP.caption.y + 6, TP.caption.w - 8, 38, 3);
  }

  // ---------------------------------------------------------------- for tests and tools
  /** What the open page shows: one entry per clip / picture. */
  showing() {
    return this._media.map(({ m, s, img }) => s
      ? { file: m.file, kind: 'video', shown: s.mesh.visible, playing: !s.video.paused, muted: s.video.muted, loop: s.video.loop, ready: s.video.readyState, w: s.video.videoWidth, h: s.video.videoHeight, time: s.video.currentTime }
      : { file: m.file, kind: 'image', shown: img.mesh.visible, w: img.tex.image?.width || 0, h: img.tex.image?.height || 0 });
  }
  videos() { return this.vid.map((s) => s.video); }
}
