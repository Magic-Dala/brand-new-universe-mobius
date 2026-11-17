// In-VR menus built from canvas Panels.
import * as THREE from 'three';
import { Panel, techFrame, fitText, wrapText, COLORS, FONT } from './panel.js';
import { MODE_MENU, MODE_ROW, MODE_PANEL } from '../data/modeMenu.js';
import { t, getLang, setLang, LANGS, onLangChange } from '../core/i18n.js';
import { settings, getBest, resetSettings } from '../core/settings.js';
import { GESTURE_TUNING } from '../input/gestures.js';
import { CITY_Q_FEATURES } from '../art/cityQuality.js';
import { FACTORY_Q_FEATURES } from '../art/factoryQuality.js';

const _v = new THREE.Vector3(), _q = new THREE.Quaternion();
const fmtLen = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function header(g, W, title, sub) {
  techFrame(g, 6, 6, W - 12, g.canvas.height - 12, { fill: 'rgba(5,16,34,0.9)', c: 28 });
  g.fillStyle = COLORS.accent; g.font = `700 22px ${FONT}`; g.textAlign = 'left'; g.textBaseline = 'top';
  g.fillText('BRAND NEW UNIVERSE · MOBIUS', 40, 30);
  g.fillStyle = COLORS.text; fitText(g, title, W - 80, 50, 800); g.fillText(title, 40, 60);
  if (sub) { g.fillStyle = COLORS.dim; g.font = `500 24px ${FONT}`; g.fillText(sub, 40, 122); }
  g.strokeStyle = COLORS.lineDim; g.lineWidth = 2; g.beginPath(); g.moveTo(40, 158); g.lineTo(W - 40, 158); g.stroke();
}

export class Menus {
  constructor(app) {
    this.app = app;
    this.root = new THREE.Group(); this.root.name = 'menus'; app.scene.add(this.root);
    this.panels = {};
    this.current = null;
    this.ctx = {};
    const mk = (name, w, h, render) => {
      const p = new Panel({ width: w, height: h, ppm: 1000, name, render: (g) => render(g, p) });
      p.visible = false; this.root.add(p.root); app.panels.add(p); this.panels[name] = p; return p;
    };
    mk('mode', MODE_PANEL.width, MODE_PANEL.height, (g, p) => header(g, p.cw, t('mode.title'), t('app.title')));
    mk('select', 1.1, 0.78, (g, p) => this._drawSelect(g, p));
    mk('calib', 0.9, 0.55, (g, p) => this._drawCalib(g, p));
    mk('results', 0.95, 0.72, (g, p) => this._drawResults(g, p));
    mk('pause', 0.62, 0.72, (g, p) => header(g, p.cw, t('menu.title')));
    mk('settings', 1.05, 0.92, (g, p) => this._drawSettings(g, p));
    mk('message', 0.9, 0.42, (g, p) => this._drawMessage(g, p));
    mk('storyEnd', 0.9, 0.45, (g, p) => { header(g, p.cw, t('story.obj.sunset'), t('story.end.subtitle')); });
    this._buildMode(); this._buildPause(); this._buildSettings(); this._buildCalib(); this._buildResults(); this._buildMessage(); this._buildStoryEnd();
    onLangChange(() => { for (const p of Object.values(this.panels)) p.dirty = true; app.hud.dirtyAll(); });
  }

  /** Place a panel ~1.15 m in front of the head, facing it, level. */
  placeInFront(p, dist = 1.15, yOff = -0.05) {
    const cam = this.app.camera;
    cam.getWorldPosition(_v);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.getWorldQuaternion(_q)); fwd.y = 0;
    if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1); fwd.normalize();
    p.root.position.copy(_v).addScaledVector(fwd, dist); p.root.position.y += yOff;
    p.root.lookAt(_v.x, p.root.position.y, _v.z);
  }
  show(name, ctx = {}, { place = true } = {}) {
    for (const [k, p] of Object.entries(this.panels)) if (k !== name) p.visible = false;
    const p = this.panels[name];
    this.ctx = { ...this.ctx, ...ctx };
    if (name === 'select') this._buildSelect();
    if (name === 'results') this._buildResults();
    if (name === 'message') this._buildMessage();
    p.visible = true; p.dirty = true;
    if (place) { this.placeInFront(p); this._pending = { p, frames: 3 }; } // re-place once the XR head pose is live
    this.current = name;
  }
  /** Called every frame: finishes deferred placement (first XR frames have no head pose yet). */
  update() {
    // story showdown results: countdown on the Next button, auto-continue at 0
    if (this.current === 'results' && this.ctx.story && this.ctx.storyNextAt) {
      const left = Math.ceil(this.ctx.storyNextAt - performance.now() / 1000);
      if (left !== this._lastLeft) { this._lastLeft = left; this.panels.results.dirty = true; }
      if (left <= 0) { this.ctx.storyNextAt = 0; this.app.storyArcadeNext(); }
    }
    const pd = this._pending; if (!pd) return;
    if (--pd.frames <= 0) { if (pd.p.visible) this.placeInFront(pd.p); this._pending = null; }
  }
  hide() { this._pending = null; for (const p of Object.values(this.panels)) p.visible = false; this.current = null; }
  get open() { return !!this.current; }

  // ------------------------------------------------------------ mode
  _buildMode() {
    // v0.49: Story first (recommended, the highlighted button), then Arcade; World Chase is added under them by worldMenus.js
    const p = this.panels.mode, W = p.cw, a = this.app, at = (id) => MODE_MENU.find((m) => m.id === id);
    const mode = (id, onClick) => { const m = at(id); return { id, x: 40, y: m.y, w: W - 80, h: m.h, label: () => t(`mode.${id}`), sub: () => t(`mode.${id}.desc`), style: m.primary ? 'primary' : undefined, tag: m.recommended ? () => t('mode.recommended') : undefined, onClick }; };
    p.setButtons([
      mode('story', () => a.go('story')),
      mode('arcade', () => a.go('songSelect')),
      { id: 'lang', x: 40, y: MODE_ROW.y, w: (W - 100) / 2, h: MODE_ROW.h, label: () => `🌐 ${LANGS.find((l) => l.id === getLang()).label} ▾`, onClick: () => this._cycleLang() },
      { id: 'exit', x: 60 + (W - 100) / 2, y: MODE_ROW.y, w: (W - 100) / 2, h: MODE_ROW.h, label: () => t('mode.exit'), onClick: () => a.exitXR() },
    ]);
  }
  _cycleLang() { const i = LANGS.findIndex((l) => l.id === getLang()); setLang(LANGS[(i + 1) % LANGS.length].id); }

  // ------------------------------------------------------------ song select
  _buildSelect() {
    const p = this.panels.select, W = p.cw, a = this.app;
    const songs = this.ctx.songs || [];
    const btns = [];
    songs.slice(0, 4).forEach((s, i) => btns.push({
      id: `song${i}`, x: 40, y: 180 + i * 92, w: W * 0.56, h: 82,
      label: s.title, sub: () => (s.chart ? t('select.bpm', { bpm: s.chart.timing.bpm, len: fmtLen(s.chart.song.durationSec || 0) }) : s.id === 'mobius-boss-01' ? t('select.bpm', { bpm: 125, len: '0:56' }) : ''),
      selected: () => settings.songId === s.id, onClick: () => { settings.songId = s.id; p.dirty = true; },
    }));
    const dx = W * 0.56 + 70, dw = W - dx - 40;
    ['easy', 'normal', 'hard'].forEach((d, i) => btns.push({
      id: `diff-${d}`, x: dx, y: 220 + i * 86, w: dw, h: 74, label: () => t(`diff.${d}`), selected: () => settings.difficulty === d, onClick: () => { settings.difficulty = d; p.dirty = true; },
    }));
    btns.push({ id: 'back', x: 40, y: p.ch - 120, w: 200, h: 84, label: () => t('select.back'), onClick: () => a.go('modeSelect') });
    btns.push({ id: 'calib', x: 260, y: p.ch - 120, w: 260, h: 84, label: () => t('select.calibrate'), onClick: () => a.go('calibrate') });
    btns.push({ id: 'start', x: W - 340, y: p.ch - 120, w: 300, h: 84, label: () => t('select.start'), style: 'primary', onClick: () => a.startArcade() });
    p.setButtons(btns);
  }
  _drawSelect(g, p) {
    const W = p.cw;
    header(g, W, t('select.title'));
    const kind = this.app.hub.inputKind;
    g.textAlign = 'left'; g.textBaseline = 'top';
    g.fillStyle = COLORS.dim; g.font = `600 26px ${FONT}`;
    g.fillText(t('select.difficulty'), W * 0.56 + 70, 180);
    g.fillText(t('select.controls', { input: kind === 'none' ? t('input.none') : t(`input.${kind}`) }), 40, p.ch - 170);
    const best = getBest(settings.songId, settings.difficulty);
    if (best) { g.fillStyle = COLORS.warn; g.fillText(t('select.best', { score: best.score, rank: best.rank }), W * 0.56 + 70, 490); }
    g.fillStyle = COLORS.dim; g.font = `500 22px ${FONT}`;
    g.fillText(`${t('settings.offset')}: ${settings.offsetMs} ${t('common.ms')}`, W * 0.56 + 70, 530);
  }

  // ------------------------------------------------------------ calibration
  _buildCalib() {
    const p = this.panels.calib, W = p.cw, a = this.app;
    p.setButtons([
      { id: 'skip', x: 40, y: p.ch - 110, w: 220, h: 80, label: () => t('calib.skip'), onClick: () => a.go('songSelect') },
      { id: 'retry', x: 280, y: p.ch - 110, w: 220, h: 80, label: () => t('calib.retry'), onClick: () => a.calibration.start() },
      { id: 'apply', x: W - 300, y: p.ch - 110, w: 260, h: 80, label: () => t('calib.apply'), style: 'primary', disabled: () => !a.calibration.done, onClick: () => { a.calibration.apply(); a.go('songSelect'); } },
    ]);
  }
  _drawCalib(g, p) {
    const W = p.cw, c = this.app.calibration;
    header(g, W, t('calib.title'));
    g.fillStyle = COLORS.text; g.font = `500 28px ${FONT}`; g.textAlign = 'left'; g.textBaseline = 'top';
    wrapText(g, t('calib.instr'), 40, 180, W - 80, 36, 2);
    // beat dots
    for (let i = 0; i < c.beats; i++) {
      const x = 60 + i * ((W - 120) / (c.beats - 1)), y = 300;
      g.beginPath(); g.arc(x, y, 18, 0, Math.PI * 2);
      g.fillStyle = i < c.index ? (c.hits[i] != null ? COLORS.perfect : COLORS.bad) : 'rgba(255,255,255,0.15)'; g.fill();
    }
    g.fillStyle = COLORS.warn; g.font = `700 32px ${FONT}`; g.textAlign = 'center';
    g.fillText(c.done ? t('calib.result', { ms: Math.round(c.resultMs) }) : c.index === 0 ? t('calib.waiting') : `${c.index}/${c.beats}`, W / 2, 345);
  }

  // ------------------------------------------------------------ results
  _buildResults() {
    const p = this.panels.results, W = p.cw, a = this.app, c = this.ctx || {};
    if (c.story) {
      // story showdown: cleared → Next (auto after 60 s) → Green Maniac escapes; failed → retry the showdown
      const won = c.result && !c.result.failed;
      p.setButtons(won ? [
        { id: 'next', x: 40, y: p.ch - 120, w: W - 80, h: 86, style: 'primary', label: () => t('result.next', { s: Math.max(0, Math.ceil((c.storyNextAt || 0) - performance.now() / 1000)) }), onClick: () => a.storyArcadeNext() },
      ] : [
        { id: 'retry', x: 40, y: p.ch - 120, w: (W - 100) / 2, h: 86, label: () => t('result.retry'), style: 'primary', onClick: () => a.storyBossRetry() },
        { id: 'main', x: 60 + (W - 100) / 2, y: p.ch - 120, w: (W - 100) / 2, h: 86, label: () => t('menu.main'), onClick: () => a.go('modeSelect') },
      ]);
      return;
    }
    p.setButtons([
      { id: 'retry', x: 40, y: p.ch - 120, w: (W - 100) / 2, h: 86, label: () => t('result.retry'), style: 'primary', onClick: () => a.startArcade() },
      { id: 'select', x: 60 + (W - 100) / 2, y: p.ch - 120, w: (W - 100) / 2, h: 86, label: () => t('result.select'), onClick: () => a.go('songSelect') },
    ]);
  }
  _drawResults(g, p) {
    const W = p.cw, r = this.ctx.result || { score: 0, counts: { perfect: 0, good: 0, miss: 0 }, accuracy: 0, maxCombo: 0, rank: '-' };
    header(g, W, t('result.title'), this.ctx.songTitle || '');
    g.textBaseline = 'middle';
    g.textAlign = 'right'; g.font = `900 italic 150px ${FONT}`;
    g.fillStyle = r.failed ? COLORS.bad : r.rank === 'S' ? COLORS.warn : COLORS.perfect;
    g.shadowColor = g.fillStyle; g.shadowBlur = 30; g.fillText(r.rank, W - 60, 300); g.shadowBlur = 0;
    g.font = `800 34px ${FONT}`; g.fillText(r.failed ? t('result.failed') : t('result.cleared'), W - 60, 400);
    g.textAlign = 'left';
    const rows = [[t('result.score'), String(r.score)], [t('result.maxCombo'), String(r.maxCombo)], [t('result.accuracy'), `${(r.accuracy * 100).toFixed(1)}%`]];
    rows.forEach(([k, v], i) => {
      g.fillStyle = COLORS.dim; g.font = `600 28px ${FONT}`; g.fillText(k, 50, 220 + i * 72);
      g.fillStyle = COLORS.text; g.font = `800 46px ${FONT}`; g.fillText(v, 290, 220 + i * 72);
    });
    g.fillStyle = COLORS.dim; g.font = `500 26px ${FONT}`;
    g.fillText(t('result.counts', { p: r.counts.perfect, g: r.counts.good, m: r.counts.miss }), 50, 450);
    if (this.ctx.newBest) { g.fillStyle = COLORS.warn; g.font = `800 30px ${FONT}`; g.fillText(t('result.newBest'), 50, 500); }
    if (Math.abs(r.meanOffsetMs || 0) > 25) { g.fillStyle = COLORS.dim; g.font = `500 22px ${FONT}`; g.fillText(`avg ${r.meanOffsetMs > 0 ? '+' : ''}${Math.round(r.meanOffsetMs)} ms`, 50, 540); }
  }

  // ------------------------------------------------------------ pause / palm menu
  _buildPause() {
    const p = this.panels.pause, W = p.cw, a = this.app;
    const items = [
      ['resume', 'menu.resume', () => a.menuResume(), 'primary'],
      ['pause', 'menu.pause', () => a.menuStayPaused()],
      ['settings', 'menu.settings', () => this.show('settings', { back: 'pause' }, { place: false })],
      ['restart', 'menu.restart', () => a.menuRestart()],
      ['recenter', 'menu.recenter', () => a.recenter()],
      ['main', 'menu.main', () => a.menuMain()],
    ];
    p.setButtons(items.map(([id, key, fn, style], i) => ({ id, x: 40, y: 180 + i * 84, w: W - 80, h: 72, label: () => t(key), onClick: fn, style })));
  }

  // ------------------------------------------------------------ VR settings
  _buildSettings() {
    const p = this.panels.settings, W = p.cw, a = this.app;
    const rows = [];
    const row = (key, value, dec, inc) => rows.push({ key, value, dec, inc });
    const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
    row(() => t('title.language'), () => LANGS.find((l) => l.id === getLang()).label + ' ▾', () => this._cycleLang(), () => this._cycleLang());
    row(() => t('title.volume'), () => `${Math.round(settings.masterVolume * 100)}%`, () => (settings.masterVolume = clamp(+(settings.masterVolume - 0.1).toFixed(2), 0, 1)), () => (settings.masterVolume = clamp(+(settings.masterVolume + 0.1).toFixed(2), 0, 1)));
    row(() => t('settings.voiceVolume'), () => `${Math.round((settings.voiceVolume ?? 1) * 100)}%`, () => (settings.voiceVolume = clamp(+((settings.voiceVolume ?? 1) - 0.1).toFixed(2), 0, 1)), () => (settings.voiceVolume = clamp(+((settings.voiceVolume ?? 1) + 0.1).toFixed(2), 0, 1)));
    row(() => t('settings.subtitles'), () => t(settings.subtitles !== false ? 'common.on' : 'common.off'), () => (settings.subtitles = settings.subtitles === false), () => (settings.subtitles = settings.subtitles === false));
    row(() => t('settings.offset'), () => `${settings.offsetMs} ${t('common.ms')}`, () => (settings.offsetMs -= 5), () => (settings.offsetMs += 5));
    row(() => t('settings.assist'), () => `${Math.round(settings.assistMargin * 100)}%`, () => (settings.assistMargin = clamp(+(settings.assistMargin - 0.05).toFixed(2), 0, 0.6)), () => (settings.assistMargin = clamp(+(settings.assistMargin + 0.05).toFixed(2), 0, 0.6)));
    row(() => t('settings.aimMode'), () => t(`settings.aimMode.${settings.aimMode}`), () => (settings.aimMode = settings.aimMode === 'palm' ? 'hand' : 'palm'), () => (settings.aimMode = settings.aimMode === 'palm' ? 'hand' : 'palm'));
    row(() => t('settings.anchorAssist'), () => `±${settings.anchorAssistDeg}°`, () => (settings.anchorAssistDeg = clamp(settings.anchorAssistDeg - 2, 2, 20)), () => (settings.anchorAssistDeg = clamp(settings.anchorAssistDeg + 2, 2, 20)));
    row(() => t('settings.snap'), () => `${settings.snapAngle}°`, () => (settings.snapAngle = [30, 45, 60, 90][([30, 45, 60, 90].indexOf(settings.snapAngle) + 3) % 4]), () => (settings.snapAngle = [30, 45, 60, 90][([30, 45, 60, 90].indexOf(settings.snapAngle) + 1) % 4]));
    const tog = (k) => () => (settings[k] = !settings[k]);
    row(() => t('settings.vignette'), () => t(settings.vignette ? 'common.on' : 'common.off'), tog('vignette'), tog('vignette'));
    row(() => t('settings.comfort'), () => t(settings.comfortMode ? 'common.on' : 'common.off'), tog('comfortMode'), tog('comfortMode'));
    row(() => t('settings.shortFall'), () => t(settings.shortFall ? 'common.on' : 'common.off'), tog('shortFall'), tog('shortFall'));
    row(() => t('settings.seated'), () => t(settings.seated ? 'common.on' : 'common.off'), () => { settings.seated = !settings.seated; a.applySeated(); }, () => { settings.seated = !settings.seated; a.applySeated(); });
    row(() => t('settings.hudIntensity'), () => `${Math.round(settings.hudIntensity * 100)}%`, () => (settings.hudIntensity = clamp(+(settings.hudIntensity - 0.15).toFixed(2), 0.25, 1)), () => (settings.hudIntensity = clamp(+(settings.hudIntensity + 0.15).toFixed(2), 0.25, 1)));
    row(() => t('settings.noFail'), () => t(settings.noFail ? 'common.on' : 'common.off'), tog('noFail'), tog('noFail'));
    row(() => t('settings.autoAim'), () => t(settings.arcadeAutoAim ? 'common.on' : 'common.off'), tog('arcadeAutoAim'), tog('arcadeAutoAim'));
    row(() => t('settings.thumbFallback'), () => t(settings.thumbFallback ? 'common.on' : 'common.off'), tog('thumbFallback'), tog('thumbFallback'));
    row(() => t('settings.devTools'), () => t(settings.devTools ? 'common.on' : 'common.off'), () => { settings.devTools = !settings.devTools; this._buildSettings(); }, () => { settings.devTools = !settings.devTools; this._buildSettings(); });
    if (settings.devTools) {
      row(() => 'Perfect ±', () => `${Math.round(settings.perfectWindow * 1000)} ms`, () => (settings.perfectWindow = clamp(+(settings.perfectWindow - 0.005).toFixed(3), 0.02, settings.goodWindow)), () => (settings.perfectWindow = clamp(+(settings.perfectWindow + 0.005).toFixed(3), 0.02, settings.goodWindow)));
      row(() => 'Good ±', () => `${Math.round(settings.goodWindow * 1000)} ms`, () => (settings.goodWindow = clamp(+(settings.goodWindow - 0.01).toFixed(3), settings.perfectWindow, 0.35)), () => (settings.goodWindow = clamp(+(settings.goodWindow + 0.01).toFixed(3), settings.perfectWindow, 0.35)));
      row(() => 'Wall climb', () => t(settings.wallClimb ? 'common.on' : 'common.off'), () => (settings.wallClimb = !settings.wallClimb), () => (settings.wallClimb = !settings.wallClimb));
      row(() => 'Arcade aim ±', () => `${settings.arcadeAssistDeg}°`, () => (settings.arcadeAssistDeg = clamp(settings.arcadeAssistDeg - 1, 0, 20)), () => (settings.arcadeAssistDeg = clamp(settings.arcadeAssistDeg + 1, 0, 20)));
      row(() => 'Web flick re-fire', () => t(settings.webFlick ? 'common.on' : 'common.off'), () => (settings.webFlick = !settings.webFlick), () => (settings.webFlick = !settings.webFlick));
      row(() => 'Wall cling', () => t(settings.wallCling ? 'common.on' : 'common.off'), () => (settings.wallCling = !settings.wallCling), () => (settings.wallCling = !settings.wallCling));
      row(() => 'Wall run', () => t(settings.wallRun ? 'common.on' : 'common.off'), () => (settings.wallRun = !settings.wallRun), () => (settings.wallRun = !settings.wallRun));
      row(() => t('settings.webPull'), () => t(settings.webPull ? 'common.on' : 'common.off'), () => (settings.webPull = !settings.webPull), () => (settings.webPull = !settings.webPull)); // v0.44
      row(() => t('settings.palmShield'), () => t(settings.palmShield ? 'common.on' : 'common.off'), () => (settings.palmShield = !settings.palmShield), () => (settings.palmShield = !settings.palmShield)); // v0.44
      row(() => 'Wind effect', () => t(settings.windFx ? 'common.on' : 'common.off'), () => (settings.windFx = !settings.windFx), () => (settings.windFx = !settings.windFx));
      row(() => 'Designed sound', () => t(settings.designedSfx ? 'common.on' : 'common.off'), () => (settings.designedSfx = !settings.designedSfx), () => (settings.designedSfx = !settings.designedSfx)); // v0.45
      row(() => 'Impact time', () => t(settings.impactTime ? 'common.on' : 'common.off'), () => (settings.impactTime = !settings.impactTime), () => (settings.impactTime = !settings.impactTime)); // v0.45
      row(() => 'Flow meter', () => t(settings.flowMeter ? 'common.on' : 'common.off'), () => (settings.flowMeter = !settings.flowMeter), () => (settings.flowMeter = !settings.flowMeter)); // v0.45
      row(() => 'Speed effects', () => t(settings.speedFx ? 'common.on' : 'common.off'), () => (settings.speedFx = !settings.speedFx), () => (settings.speedFx = !settings.speedFx)); // v0.45
      row(() => 'Finisher', () => t(settings.finisher ? 'common.on' : 'common.off'), () => (settings.finisher = !settings.finisher), () => (settings.finisher = !settings.finisher)); // v0.45
      row(() => 'Close combat', () => t(settings.closeCombat ? 'common.on' : 'common.off'), () => (settings.closeCombat = !settings.closeCombat), () => (settings.closeCombat = !settings.closeCombat)); // v0.46
      row(() => t('settings.storyCombat'), () => t(settings.storyCombat !== false ? 'common.on' : 'common.off'), () => (settings.storyCombat = settings.storyCombat === false), () => (settings.storyCombat = settings.storyCombat === false)); // v0.47
      row(() => t('settings.tutorials'), () => t(settings.tutorials !== false ? 'common.on' : 'common.off'), () => (settings.tutorials = settings.tutorials === false), () => (settings.tutorials = settings.tutorials === false)); // v0.49
      row(() => t('settings.arcadeShow'), () => t(settings.arcadeShow !== false ? 'common.on' : 'common.off'), () => (settings.arcadeShow = settings.arcadeShow === false), () => (settings.arcadeShow = settings.arcadeShow === false)); // v0.47
      row(() => t('settings.arcadeArmored'), () => t(settings.arcadeArmored !== false ? 'common.on' : 'common.off'), () => (settings.arcadeArmored = settings.arcadeArmored === false), () => (settings.arcadeArmored = settings.arcadeArmored === false)); // v0.47
      // v0.16 arcade lanes / arena (Quest tuning)
      const num = (label, key, step, lo, hi, unit = 'm', dp = 2) => row(() => label, () => `${(+settings[key]).toFixed(dp)} ${unit}`, () => (settings[key] = clamp(+(settings[key] - step).toFixed(3), lo, hi)), () => (settings[key] = clamp(+(settings[key] + step).toFixed(3), lo, hi)));
      num('Lane height', 'arcadeLaneHeight', 0.05, 0.7, 1.7);
      num('Lane spacing', 'arcadeLaneSpacing', 0.05, 0.5, 1.6);
      num('Boss distance', 'arcadeBossDistance', 0.5, 12, 20, 'm', 1);
      num('Boss scale', 'arcadeBossScale', 0.05, 0.3, 1.2, '×');
      num('Story boss size', 'storyBossScale', 0.05, 0.5, 1.3, '×');
      num('Roof kick extra', 'roofKnockExtra', 0.25, 0, 3, 'm', 1);
      num('Lane brightness', 'arcadeLaneOpacity', 0.1, 0.2, 1.5, '', 1);
      num('Bomb travel (0 = chart)', 'arcadeTravelSec', 0.1, 0, 4, 's', 1);
      // v0.20 city swinging (Quest tuning) + performance overlay
      row(() => 'Perf overlay', () => t(settings.devPerf ? 'common.on' : 'common.off'), () => (settings.devPerf = !settings.devPerf), () => (settings.devPerf = !settings.devPerf));
      // v0.25 city quality A/B + measurement (stage 0)
      row(() => 'City look', () => (settings.cityQ === 'v0' ? 'v0 original' : 'v1 new'), () => (settings.cityQ = settings.cityQ === 'v0' ? 'v1' : 'v0'), () => (settings.cityQ = settings.cityQ === 'v0' ? 'v1' : 'v0'));
      this._qf = this._qf || 0;
      row(() => `City feature ${CITY_Q_FEATURES[this._qf]} (◀ next, ▶ on/off)`, () => t((settings.cityQOff || []).includes(CITY_Q_FEATURES[this._qf]) ? 'common.off' : 'common.on'),
        () => { this._qf = (this._qf + CITY_Q_FEATURES.length - 1) % CITY_Q_FEATURES.length; },
        () => { const k = CITY_Q_FEATURES[this._qf], off = new Set(settings.cityQOff || []); off.has(k) ? off.delete(k) : off.add(k); settings.cityQOff = [...off]; });
      // v0.31 factory interior A/B: the rebuild vs the v0.30 hall (next factory load) + its features (live where possible)
      row(() => 'Factory look (next load)', () => (settings.factoryQ === 'v0' ? 'v0 (v0.30 hall)' : 'v1 (v0.31 rebuild)'), () => (settings.factoryQ = settings.factoryQ === 'v0' ? 'v1' : 'v0'), () => (settings.factoryQ = settings.factoryQ === 'v0' ? 'v1' : 'v0'));
      this._ff = this._ff || 0;
      row(() => `Factory feature ${FACTORY_Q_FEATURES[this._ff]} (◀ next, ▶ on/off)`, () => t((settings.factoryQOff || []).includes(FACTORY_Q_FEATURES[this._ff]) ? 'common.off' : 'common.on'),
        () => { this._ff = (this._ff + FACTORY_Q_FEATURES.length - 1) % FACTORY_Q_FEATURES.length; },
        () => { const k = FACTORY_Q_FEATURES[this._ff], off = new Set(settings.factoryQOff || []); off.has(k) ? off.delete(k) : off.add(k); settings.factoryQOff = [...off]; });
      { const RS = [1.0, 0.9, 0.85, 0.8], FV = [1, 0.75, 0.5, 0.25, 0], cyc = (arr, v, d) => arr[(Math.max(0, arr.indexOf(v)) + d + arr.length) % arr.length];
        row(() => 'Render scale (next VR entry)', () => `${(settings.renderScale || 1).toFixed(2)}`, () => (settings.renderScale = cyc(RS, settings.renderScale, -1)), () => (settings.renderScale = cyc(RS, settings.renderScale, 1)));
        row(() => 'Foveation (live)', () => `${settings.xrFoveation ?? 1}`, () => (settings.xrFoveation = cyc(FV, settings.xrFoveation ?? 1, -1)), () => (settings.xrFoveation = cyc(FV, settings.xrFoveation ?? 1, 1)));
        row(() => 'Multiview (next VR entry)', () => (settings.xrMultiview === 'off' ? 'off (A/B)' : 'auto'), () => (settings.xrMultiview = settings.xrMultiview === 'off' ? 'auto' : 'off'), () => (settings.xrMultiview = settings.xrMultiview === 'off' ? 'auto' : 'off')); }
      row(() => 'City ambience (sound)', () => t(settings.cityAmbience !== false ? 'common.on' : 'common.off'), () => (settings.cityAmbience = settings.cityAmbience === false), () => (settings.cityAmbience = settings.cityAmbience === false));
      row(() => 'Mirror city lite', () => t(settings.mirrorCityLite !== false ? 'common.on' : 'common.off'), () => (settings.mirrorCityLite = settings.mirrorCityLite === false), () => (settings.mirrorCityLite = settings.mirrorCityLite === false));
      const BENCH = ['views', 'route', 'long'];
      this._bk = this._bk || 0;
      row(() => `City bench (▶ start): ${BENCH[this._bk]}`, () => (a.bench?.active ? 'running' : a.bench?.last ? 'done' : '-'), () => { this._bk = (this._bk + 1) % BENCH.length; }, () => a.bench?.start(BENCH[this._bk]));
      row(() => 'Perf report (▶ export)', () => (a._pendingReport ? 'saved' : ''), () => {}, () => a.exportPerf());
      row(() => 'Fan Web debug', () => t(settings.devFanDebug ? 'common.on' : 'common.off'), () => (settings.devFanDebug = !settings.devFanDebug), () => (settings.devFanDebug = !settings.devFanDebug));
      num(t('settings.swingSpeed'), 'swingSpeedLimit', 1, 8, 32, 'm/s', 0);
      num(t('settings.swingAssist'), 'swingAssist', 0.1, 0, 2, '×', 1);
      num('Swing accel', 'swingAccel', 0.25, 0, 6, 'm/s²', 2);
      num('Air drag', 'swingDrag', 0.01, 0, 0.3, '/s', 2);
      num(t('settings.webLength'), 'webMaxLength', 5, 25, 90, 'm', 0);
      num('Anchor reach', 'anchorMaxDist', 5, 25, 90, 'm', 0);
      num('Release boost', 'releaseBoost', 0.2, 0, 4, 'm/s', 1);
      row(() => 'Thruster assist', () => t(settings.thrusterAssist ? 'common.on' : 'common.off'), () => (settings.thrusterAssist = !settings.thrusterAssist), () => (settings.thrusterAssist = !settings.thrusterAssist));
      row(() => 'Look steering', () => t(settings.swingSteer ? 'common.on' : 'common.off'), () => (settings.swingSteer = !settings.swingSteer), () => (settings.swingSteer = !settings.swingSteer));
      row(() => 'Steer rate', () => `${settings.swingSteerRate}°/s`, () => (settings.swingSteerRate = clamp(settings.swingSteerRate - 10, 20, 240)), () => (settings.swingSteerRate = clamp(settings.swingSteerRate + 10, 20, 240)));
      row(() => 'Reel speed', () => `${settings.swingReelSpeed} m/s`, () => (settings.swingReelSpeed = clamp(settings.swingReelSpeed - 1, 0, 15)), () => (settings.swingReelSpeed = clamp(settings.swingReelSpeed + 1, 0, 15)));
      row(() => 'Web pitch', () => `${settings.webPitchDeg}°`, () => (settings.webPitchDeg = clamp(settings.webPitchDeg - 5, -45, 30)), () => (settings.webPitchDeg = clamp(settings.webPitchDeg + 5, -45, 30)));
      row(() => 'Web pose enter', () => GESTURE_TUNING.webEnter.toFixed(2), () => (GESTURE_TUNING.webEnter = clamp(+(GESTURE_TUNING.webEnter - 0.05).toFixed(2), 0.3, 0.95)), () => (GESTURE_TUNING.webEnter = clamp(+(GESTURE_TUNING.webEnter + 0.05).toFixed(2), 0.3, 0.95)));
      row(() => 'Web: middle/ring curl', () => GESTURE_TUNING.webCurlLo.toFixed(2), () => { GESTURE_TUNING.webCurlLo = clamp(+(GESTURE_TUNING.webCurlLo - 0.04).toFixed(2), 0.5, 0.9); GESTURE_TUNING.webCurlHi = Math.min(0.99, GESTURE_TUNING.webCurlLo + 0.15); }, () => { GESTURE_TUNING.webCurlLo = clamp(+(GESTURE_TUNING.webCurlLo + 0.04).toFixed(2), 0.5, 0.9); GESTURE_TUNING.webCurlHi = Math.min(0.99, GESTURE_TUNING.webCurlLo + 0.15); }); // v0.24
      row(() => 'Throw min speed', () => `${GESTURE_TUNING.throwMinSpeed.toFixed(1)} m/s`, () => (GESTURE_TUNING.throwMinSpeed = clamp(+(GESTURE_TUNING.throwMinSpeed - 0.1).toFixed(1), 0.5, 3)), () => (GESTURE_TUNING.throwMinSpeed = clamp(+(GESTURE_TUNING.throwMinSpeed + 0.1).toFixed(1), 0.5, 3)));
      row(() => 'Autoplay (test)', () => t(a.arcade.debug.autoplay ? 'common.on' : 'common.off'), () => (a.arcade.debug.autoplay = !a.arcade.debug.autoplay), () => (a.arcade.debug.autoplay = !a.arcade.debug.autoplay));
    }
    // v0.27: pages of ≤ 14 rows (the dev list grew to ~50 rows: ~12 px each on one page was unreadable in VR)
    const PER = 14, pages = Math.max(1, Math.ceil(rows.length / PER));
    this._setPage = Math.min(this._setPage || 0, pages - 1);
    const shown = rows.slice(this._setPage * PER, this._setPage * PER + PER);
    this.settingRows = shown;
    const rh = Math.min(48, (p.ch - 300) / shown.length), btns = [];
    if (pages > 1) {
      btns.push({ id: 'pgPrev', x: 370, y: p.ch - 105, w: 90, h: 76, label: '◀', onClick: () => { this._setPage = (this._setPage + pages - 1) % pages; this._buildSettings(); p.dirty = true; } });
      btns.push({ id: 'pgLbl', x: 470, y: p.ch - 105, w: 120, h: 76, label: () => `${this._setPage + 1} / ${pages}`, onClick: () => {} });
      btns.push({ id: 'pgNext', x: 600, y: p.ch - 105, w: 90, h: 76, label: '▶', onClick: () => { this._setPage = (this._setPage + 1) % pages; this._buildSettings(); p.dirty = true; } });
    }
    shown.forEach((r, i) => {
      const y = 175 + i * rh;
      btns.push({ id: `dec${i}`, x: W - 330, y, w: 60, h: rh - 6, label: '◀', onClick: () => { r.dec(); p.dirty = true; } });
      btns.push({ id: `inc${i}`, x: W - 100, y, w: 60, h: rh - 6, label: '▶', onClick: () => { r.inc(); p.dirty = true; } });
    });
    btns.push({ id: 'reset', x: 40, y: p.ch - 105, w: 300, h: 76, label: () => t('settings.reset'), onClick: () => { resetSettings(); this._buildSettings(); } });
    btns.push({ id: 'back', x: W - 300, y: p.ch - 105, w: 260, h: 76, label: () => t('vrset.back'), style: 'primary', onClick: () => this.show(this.ctx.back || 'pause', {}, { place: false }) });
    p.setButtons(btns);
    this._rowH = rh;
  }
  _drawSettings(g, p) {
    const W = p.cw;
    header(g, W, t('vrset.title'));
    g.textBaseline = 'middle';
    this.settingRows.forEach((r, i) => {
      const y = 175 + i * this._rowH + (this._rowH - 6) / 2;
      g.textAlign = 'left'; g.fillStyle = COLORS.text; fitText(g, r.key(), W - 420, 24, 600); g.fillText(r.key(), 40, y);
      g.textAlign = 'center'; g.fillStyle = COLORS.accent; fitText(g, r.value(), 150, 24, 700); g.fillText(r.value(), W - 185, y);
    });
  }

  // ------------------------------------------------------------ message
  _buildMessage() {
    const p = this.panels.message, W = p.cw, c = this.ctx.message || {};
    const btns = (c.buttons || []).map((b, i, arr) => ({ id: `m${i}`, x: 40 + i * ((W - 80) / arr.length), y: p.ch - 110, w: (W - 80) / arr.length - 20, h: 80, label: b.label, onClick: b.onClick, style: i === 0 ? 'primary' : undefined }));
    p.setButtons(btns);
  }
  _drawMessage(g, p) {
    const c = this.ctx.message || {};
    header(g, p.cw, c.title ? c.title() : '');
    g.fillStyle = COLORS.text; g.font = `500 28px ${FONT}`; g.textAlign = 'left'; g.textBaseline = 'top';
    wrapText(g, c.text ? c.text() : '', 40, 180, p.cw - 80, 36, 3);
  }
  showMessage(title, text, buttons) { this.show('message', { message: { title, text, buttons } }); }

  _buildStoryEnd() {
    const p = this.panels.storyEnd, W = p.cw, a = this.app;
    p.setButtons([{ id: 'end', x: 40, y: p.ch - 130, w: W - 80, h: 90, label: () => t('story.end'), style: 'primary', onClick: () => a.go('modeSelect') }]);
  }
}
