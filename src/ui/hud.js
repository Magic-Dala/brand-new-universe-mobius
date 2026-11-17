// Armor HUD: lazy-follow head HUD with minimap (top-left), status (top),
// objective/tutorial (bottom) and a centre banner. Canvas textures redrawn
// only when content changes (throttled).
import * as THREE from 'three';
import { Panel, techFrame, fitText, wrapText, COLORS, FONT } from './panel.js';
import { t } from '../core/i18n.js';
import { settings } from '../core/settings.js';

const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _r = new THREE.Vector3();
const fmtTime = (s) => { const v = Math.max(0, Math.floor((s || 0) + 1e-6)), h = Math.floor(v / 3600), m = Math.floor((v % 3600) / 60), r = v % 60, p = (n) => String(n).padStart(2, '0'); return h ? `${h}:${p(m)}:${p(r)}` : `${p(m)}:${p(r)}`; }; // (= formatChaseTime)

export class HUD {
  constructor(scene) {
    this.root = new THREE.Group(); this.root.name = 'hud'; scene.add(this.root);
    this.mode = 'off';
    this.map = new Panel({ width: 0.26, height: 0.26, ppm: 1150, name: 'hud-map', render: (g) => this._drawMap(g) });
    this.status = new Panel({ width: 0.5, height: 0.105, ppm: 1426, name: 'hud-status', render: (g) => this._drawStatus(g) });
    this.obj = new Panel({ width: 0.78, height: 0.15, ppm: 1150, name: 'hud-obj', render: (g) => this._drawObj(g) });
    this.ban = new Panel({ width: 0.7, height: 0.2, ppm: 1150, name: 'hud-banner', render: (g) => this._drawBanner(g) });
    // v0.16 arcade: Green Maniac HP (top centre) + song / progress / BPM strip (bottom)
    this.boss = new Panel({ width: 0.5, height: 0.062, ppm: 1300, name: 'hud-boss', render: (g) => this._drawBoss(g) });
    this.song = new Panel({ width: 0.56, height: 0.095, ppm: 1200, name: 'hud-song', render: (g) => this._drawSong(g) });
    // v0.23 story: collected coins (top right, where the arcade status sits)
    this.coin = new Panel({ width: 0.2, height: 0.075, ppm: 1400, name: 'hud-coins', render: (g) => this._drawCoins(g) });
    // v0.41 World Chase: Mobius HP + chase time + Light Bomb readiness (upper right, under the Bitcoin counter)
    this.vit = new Panel({ width: 0.3, height: 0.115, ppm: 1400, name: 'hud-vitals', render: (g) => this._drawVitals(g) });
    // v0.42 World Chase boss fight: shield / opening meter + a short state label under the boss bar (text + icon, not colour only)
    this.fightP = new Panel({ width: 0.5, height: 0.05, ppm: 1300, name: 'hud-fight', render: (g) => this._drawFight(g) });
    this.chase = { bossHp: 1, bossLag: 1, hp: 1, hpLag: 1, time: 0, bomb: 1, bombReady: true, hurt: false, fight: null };
    // v0.47 Story chase combat: Light Bomb ring + Flow pips (under the Bitcoin counter) and the run summary. No health, no boss bar.
    this.storyP = new Panel({ width: 0.3, height: 0.075, ppm: 1400, name: 'hud-story', render: (g) => this._drawStory(g) });
    this.sumP = new Panel({ width: 0.44, height: 0.2, ppm: 1000, name: 'hud-summary', render: (g) => this._drawSummary(g) });
    this.story = null; this.summary = null;
    this._pulse = { boss: 0, player: 0 };
    for (const p of [this.map, this.status, this.obj, this.ban, this.boss, this.song, this.coin, this.vit, this.fightP, this.storyP, this.sumP]) { p.interactive = false; p.mesh.renderOrder = 50; p.mat.depthTest = false; this.root.add(p.root); }
    this.coins = { n: 0, show: false, pulse: 0 };
    // placement on a ~1.4 m sphere; minimap upper-left
    this._place(this.map.root, -0.44, 0.25, -1.25, 0.32);
    this._place(this.status.root, 0.42, 0.27, -1.25, 0); // upper-right: keeps the boss (≈+20°) and strike lanes clear
    this._place(this.obj.root, 0, -0.36, -1.35, 0);
    this._place(this.ban.root, 0, 0.05, -1.3, 0);
    this._place(this.boss.root, 0, 0.36, -1.32, 0); // above Green Maniac (≈ +10° at 16 m), never over the lanes
    this._place(this.song.root, 0, -0.5, -1.36, 0); // low: below the judgement rings
    this._place(this.coin.root, 0.5, 0.29, -1.25, 0); // upper right (story)
    this._place(this.vit.root, 0.47, 0.17, -1.25, 0); // v0.41 chase: right side, well outside the central aim area
    this._place(this.storyP.root, 0.47, 0.2, -1.25, 0); // v0.47 story: under the Bitcoin counter, outside the central aim area
    this._place(this.sumP.root, 0, 0.25, -1.3, 0); // v0.47 story: the run summary, above the banner line
    this.ban.visible = false;
    this.data = { score: 0, combo: 0, acc: 1, progress: 0, shield: 100, weapons: {}, status: '' };
    this.mapData = { center: new THREE.Vector3(), heading: 0, radius: 60, buildings: [], markers: [] };
    this.objective = ''; this.tutorial = []; this.banner = { text: '', until: 0, color: COLORS.text, sub: '' };
    this._nextStatus = 0; this._nextMap = 0; this._now = 0;
    this.setMode('off');
  }
  _place(o, x, y, z) { o.position.set(x, y, z); o.lookAt(0, y * 0.4, 0); } // +Z (front) faces the eye; root is identity at construction

  setMode(m) {
    this.mode = m;
    const on = m !== 'off';
    this.root.visible = on;
    this.map.visible = on; this.status.visible = m === 'arcade'; this.obj.visible = on;
    this.boss.visible = m === 'arcade' || m === 'chase'; this.song.visible = m === 'arcade';
    this.coin.visible = (m === 'story' || m === 'chase') && this.coins?.show;
    this.vit.visible = m === 'chase'; this.fightP.visible = m === 'chase';
    this.storyP.visible = m === 'story' && !!this.story; this.sumP.visible = m === 'story' && !!this.summary; // v0.47
    this._place(this.fightP.root, 0, 0.485, -1.32); // above the boss bar (keeps the view below the bar — Green Maniac — clear)
    this._place(this.boss.root, 0, m === 'chase' ? 0.43 : 0.36, -1.32); // chase: higher — Green Maniac flies ahead and above, keep the bar off him
    this.dirtyAll();
  }
  dirtyAll() { for (const p of [this.map, this.status, this.obj, this.ban, this.boss, this.song, this.coin, this.vit, this.fightP, this.storyP, this.sumP]) p.dirty = true; }
  /** v0.47 Story chase combat: { bomb (0 … 1), bombReady, flow: { level, frac } | null }, or null to hide the panel. Redrawn at most 15×/s, only on a visible change. */
  setStory(d) {
    if (!d) { if (this.story) { this.story = null; this.storyP.visible = false; this._storyKey = ''; } return; }
    const key = `${Math.round(d.bomb * 40)}|${d.bombReady}|${d.flow ? `${d.flow.level}|${Math.round(d.flow.frac * 12)}` : '-'}`;
    const first = !this.story; this.story = d; this.storyP.visible = this.mode === 'story';
    if (first || key !== this._storyKey) { this._storyKey = key; if (first) this.storyP.dirty = true; else this._statusDirty = true; }
  }
  /** v0.47: the Story run summary (style, punches, pumpkins destroyed, peak Flow) for `dur` seconds. Not interactive; hides itself. */
  showSummary(stats, dur = 5) { this.summary = { ...stats, until: this._now + dur }; this.sumP.visible = this.mode === 'story'; this.sumP.dirty = true; }
  hideSummary() { this.summary = null; this.sumP.visible = false; }
  /** v0.41 World Chase numbers (redrawn at most 15×/s, only when something visible changed). */
  setChase(d, force) {
    const c = this.chase, r = (x) => Math.round(x * 200) / 200;
    const F = d.fight, key = `${r(d.bossHp)}|${r(d.bossLag)}|${r(d.hp)}|${r(d.hpLag)}|${Math.floor(d.time)}|${r(d.bomb)}|${d.bombReady}|${d.hurt}|${F ? `${F.state}|${F.attack}|${Math.round(F.shield * 60)}|${Math.round(F.window * 40)}|${F.phase}` : '-'}|${d.flow ? `${d.flow.level}|${Math.round(d.flow.frac * 12)}` : '-'}`; // v0.45: + Flow pips
    Object.assign(c, d);
    if (force || key !== this._chaseKey) { this._chaseKey = key; this._statusDirty = true; if (force) { this.boss.dirty = true; this.vit.dirty = true; this.fightP.dirty = true; } }
  }
  /** Damage feedback: the bar shakes / brightens briefly. */
  pulse(which) { this._pulse[which] = 1; this._statusDirty = true; }
  /** v0.23: coin counter (story). pulse = a coin was just collected. */
  setCoins(n, show = true, pulse = false) {
    const c = this.coins; if (c.n !== n || c.show !== show) this.coin.dirty = true;
    c.n = n; c.show = show; if (pulse) c.pulse = 1;
    this.coin.visible = (this.mode === 'story' || this.mode === 'chase') && show;
  }
  _drawCoins(g) {
    const W = this.coin.cw, H = this.coin.ch, c = this.coins;
    techFrame(g, 4, 4, W - 8, H - 8, { fill: 'rgba(4,20,40,0.66)', c: 16 });
    const r = H * 0.27, cx = 26 + r, cy = H / 2;
    const grd = g.createRadialGradient(cx - r * 0.3, cy - r * 0.3, 2, cx, cy, r); grd.addColorStop(0, '#ffc266'); grd.addColorStop(0.6, '#f7931a'); grd.addColorStop(1, '#c46a00'); // v0.24 Bitcoin
    g.fillStyle = grd; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
    g.save(); g.translate(cx, cy); g.rotate(0.24); g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `900 ${Math.round(r * 1.35)}px system-ui, sans-serif`; g.fillText('\u20bf', 0, 1); g.restore();
    g.textBaseline = 'middle'; g.textAlign = 'left';
    g.fillStyle = COLORS.dim; g.font = `600 20px ${FONT}`; g.fillText(t('hud.coins'), cx + r + 14, cy - 18);
    g.fillStyle = '#ffb347'; g.font = `800 40px ${FONT}`; g.fillText(`× ${c.n}`, cx + r + 14, cy + 14);
  }
  /** Hide the tutorial / objective panel (arcade: after the opening bars it would sit over the lanes). */
  setObjectiveVisible(v) { this.obj.visible = v && this.mode !== 'off'; }
  setObjective(text, tutorial = []) { this.objective = text; this.tutorial = tutorial; this.obj.dirty = true; }
  showBanner(text, dur = 1.2, color = COLORS.text, sub = '') { this.banner = { text, until: this._now + dur, color, sub }; this.ban.visible = true; this.ban.dirty = true; }
  hideBanner() { this.banner.until = 0; this.ban.visible = false; }
  setStats(d) {
    const changed = Object.keys(d).some((k) => JSON.stringify(this.data[k]) !== JSON.stringify(d[k]));
    if (changed) { Object.assign(this.data, d); this._statusDirty = true; }
  }
  setMap(d) { Object.assign(this.mapData, d); this._mapDirty = true; }
  /** Dev-only performance overlay (settings.devTools + devPerf): lines of text, null hides it. */
  setDevStats(lines) { this.devLines = lines; if (this.dev) { this.dev.root.visible = !!lines; this.dev.dirty = true; } }
  _ensureDev(camera) {
    if (this.dev || !this.devLines) return;
    this.dev = new Panel({ width: 0.7, height: 0.27, ppm: 1300, name: 'hud-dev', render: (g) => this._drawDev(g) });
    this.dev.interactive = false; this.dev.mesh.renderOrder = 55; this.dev.mat.depthTest = false;
    this.dev.root.position.set(0, -0.22, -0.95); camera.add(this.dev.root);
  }
  _drawDev(g) {
    const W = this.dev.cw, H = this.dev.ch;
    g.fillStyle = 'rgba(2,8,16,0.72)'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#7ef0ff'; g.font = `600 22px monospace`; g.textAlign = 'left'; g.textBaseline = 'top';
    (this.devLines || []).forEach((l, i) => { g.fillStyle = i === 0 ? '#ffe08a' : '#9ad8ff'; g.fillText(l, 14, 10 + i * 33, W - 28); });
  }

  update(dt, camera, now) {
    this._now = now;
    this._ensureDev(camera); if (this.dev) this.dev.update();
    if (this.mode === 'off') return;
    // lazy follow: yaw + clamped pitch
    camera.getWorldPosition(_p); camera.getWorldQuaternion(_q);
    _e.setFromQuaternion(_q, 'YXZ');
    const pitch = THREE.MathUtils.clamp(_e.x, -0.5, 0.5);
    const target = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch * 0.6, _e.y, 0, 'YXZ'));
    const k = 1 - Math.exp(-dt * 5);
    // v0.23: lazy follow of the HEAD relative to the rig (the player's body), so swinging at 18 m/s never leaves the
    // HUD behind — only head motion inside the rig is smoothed
    const rig = camera.parent; const rp = rig ? rig.getWorldPosition(_r) : _r.set(0, 0, 0);
    if (!this._rel || this._relRig !== rig) { this._rel = _p.clone().sub(rp); this._relRig = rig; }
    this._rel.lerp(_p.sub(rp), Math.min(1, k * 3));
    this.root.position.copy(rp).add(this._rel);
    this.root.quaternion.slerp(target, k);
    const op = settings.hudIntensity;
    for (const p of [this.map, this.status, this.obj, this.boss, this.song, this.coin, this.vit, this.fightP, this.storyP, this.sumP]) p.mat.opacity = op;
    for (const [k, panel] of [['boss', this.boss], ['player', this.vit]]) { // v0.41 hit pulse (scale, no camera motion)
      if (this._pulse[k] > 0) { this._pulse[k] = Math.max(0, this._pulse[k] - dt * 3.5); panel.root.scale.setScalar(1 + 0.08 * Math.sin(Math.PI * this._pulse[k])); if (!this._pulse[k]) panel.dirty = true; }
    }
    if (this.coins.pulse > 0) { this.coins.pulse = Math.max(0, this.coins.pulse - dt * 4); this.coin.root.scale.setScalar(1 + 0.18 * Math.sin(Math.PI * this.coins.pulse)); }
    this.ban.mat.opacity = 1;
    if (this.banner.until && now > this.banner.until) this.hideBanner();
    if (this.summary && now > this.summary.until) this.hideSummary(); // v0.47
    if (this._statusDirty && now >= this._nextStatus) { this.status.dirty = true; this.boss.dirty = true; this.song.dirty = true; this.vit.dirty = true; this.fightP.dirty = true; if (this.story) this.storyP.dirty = true; this._statusDirty = false; this._nextStatus = now + 1 / 15; }
    if (this._mapDirty && now >= this._nextMap) { this.map.dirty = true; this._mapDirty = false; this._nextMap = now + 1 / 10; }
    for (const p of [this.map, this.status, this.obj, this.ban, this.boss, this.song, this.coin, this.vit, this.fightP, this.storyP, this.sumP]) p.update();
  }

  // ------------------------------------------------------------ drawing
  _drawMap(g) {
    const W = this.map.cw, H = this.map.ch, cx = W / 2, cy = H / 2;
    techFrame(g, 4, 4, W - 8, H - 8, { fill: 'rgba(4,20,40,0.72)', c: 26 });
    const m = this.mapData, R = m.radius, s = (W / 2 - 18) / R;
    g.save();
    g.beginPath(); g.arc(cx, cy, W / 2 - 16, 0, Math.PI * 2); g.clip();
    // grid
    g.strokeStyle = 'rgba(34,211,255,0.12)'; g.lineWidth = 1;
    for (let r = 1; r <= 3; r++) { g.beginPath(); g.arc(cx, cy, (W / 2 - 18) * r / 3, 0, Math.PI * 2); g.stroke(); }
    g.translate(cx, cy); g.rotate(m.heading); // heading-up
    for (const pass of [1, 0]) for (const b of m.buildings) { // upper deck (outlines) first, lower deck on top
      if (!!b.upper !== !!pass) continue;
      const x = (b.x - m.center.x) * s, y = (b.z - m.center.z) * s;
      if (Math.abs(x) > W || Math.abs(y) > H) continue;
      g.save(); g.translate(x, y); g.rotate(-(b.yaw || 0)); // ring buildings follow the corridor
      if (b.upper) { g.strokeStyle = 'rgba(190,150,255,0.35)'; g.lineWidth = 1.5; g.strokeRect(-(b.w * s) / 2, -(b.d * s) / 2, b.w * s, b.d * s); g.restore(); continue; }
      g.fillStyle = b.highlight ? 'rgba(34,211,255,0.45)' : 'rgba(120,170,200,0.28)';
      g.strokeStyle = b.highlight ? '#7ef0ff' : 'rgba(140,200,230,0.5)'; g.lineWidth = 2;
      g.fillRect(-(b.w * s) / 2, -(b.d * s) / 2, b.w * s, b.d * s);
      g.strokeRect(-(b.w * s) / 2, -(b.d * s) / 2, b.w * s, b.d * s);
      g.restore();
    }
    for (const mk of m.markers) {
      let x = (mk.pos.x - m.center.x) * s, y = (mk.pos.z - m.center.z) * s;
      const d = Math.hypot(x, y), lim = W / 2 - 30;
      const clamped = d > lim; if (clamped) { x *= lim / d; y *= lim / d; }
      g.save(); g.translate(x, y); g.rotate(-m.heading);
      if (mk.kind === 'boss') { g.fillStyle = '#ff5050'; g.beginPath(); g.moveTo(0, -12); g.lineTo(10, 8); g.lineTo(-10, 8); g.closePath(); g.fill(); }
      else if (mk.kind === 'objective') { g.strokeStyle = '#ffb020'; g.lineWidth = 4; g.beginPath(); g.arc(0, 0, clamped ? 8 : 11, 0, Math.PI * 2); g.stroke(); }
      else if (mk.kind === 'route') { g.fillStyle = 'rgba(34,211,255,0.75)'; g.beginPath(); g.arc(0, 0, 3.2, 0, Math.PI * 2); g.fill(); }
      else if (mk.kind === 'anchor') { g.fillStyle = mk.active ? '#7ef0ff' : 'rgba(126,240,255,0.5)'; g.fillRect(-3, -3, 6, 6); }
      g.restore();
    }
    g.restore();
    // player arrow (always up)
    g.fillStyle = '#e8f7ff'; g.beginPath(); g.moveTo(cx, cy - 14); g.lineTo(cx + 10, cy + 10); g.lineTo(cx, cy + 4); g.lineTo(cx - 10, cy + 10); g.closePath(); g.fill();
    // north indicator
    const nx = cx + Math.sin(-m.heading) * (W / 2 - 26) * -1, ny = cy - Math.cos(m.heading) * (W / 2 - 26);
    g.fillStyle = '#ffb020'; g.font = `800 22px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('N', nx, ny);
  }
  _drawStatus(g) {
    const W = this.status.cw, H = this.status.ch, d = this.data;
    techFrame(g, 4, 4, W - 8, H - 8, { fill: 'rgba(4,20,40,0.66)', c: 20 });
    g.textBaseline = 'middle';
    g.fillStyle = COLORS.dim; g.font = `600 22px ${FONT}`; g.textAlign = 'left';
    g.fillText(t('game.score'), 26, 34); g.fillText(t('game.combo'), W * 0.42, 34); g.fillText(t('game.acc'), W * 0.66, 34);
    g.fillStyle = COLORS.text; g.font = `800 44px ${FONT}`;
    g.fillText(String(d.score).padStart(7, '0'), 26, 78);
    g.fillStyle = d.combo >= 10 ? COLORS.perfect : COLORS.text; g.fillText(`${d.combo}×`, W * 0.42, 78);
    g.fillStyle = COLORS.text; g.fillText(`${(d.acc * 100).toFixed(1)}%`, W * 0.66, 78);
    // shield bar + progress bar
    const bx = 26, bw = W - 52;
    g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(bx, H - 34, bw, 8); g.fillRect(bx, H - 20, bw, 6);
    g.fillStyle = d.shield > 30 ? '#22d3ff' : '#ff4d6d'; g.fillRect(bx, H - 34, bw * d.shield / 100, 8);
    g.fillStyle = '#ffb020'; g.fillRect(bx, H - 20, bw * d.progress, 6);
    // weapon pips
    const wp = d.weapons || {};
    let x = W - 30; g.textAlign = 'right'; g.font = `700 20px ${FONT}`;
    for (const h of d.status ? [] : ['right', 'left']) { // while a status shows, it takes the pips' place
      const w = wp[h]; if (!w) continue;
      g.fillStyle = w.bomb >= 1 ? '#5fd8ff' : 'rgba(95,216,255,0.35)';
      g.fillText(`${h === 'left' ? 'L' : 'R'} ${w.lost ? '⚠' : w.bomb >= 1 ? '●' : '○'}`, x, 34); x -= 60;
    }
    // status (e.g. OVERHEAT) replaces the weapon pips in the label row — never on top of the accuracy value
    if (d.status) { g.fillStyle = COLORS.warn; g.textAlign = 'right'; g.font = `800 22px ${FONT}`; const accEnd = W * 0.66 + g.measureText(t('game.acc')).width + 16; fitText(g, d.status, W - 26 - accEnd, 22, 800); g.fillText(d.status, W - 26, 34); }
  }
  _drawBoss(g) {
    const W = this.boss.cw, H = this.boss.ch, chase = this.mode === 'chase', d = chase ? this.chase : this.data, hp = d.bossHp ?? 1;
    g.clearRect(0, 0, W, H);
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = COLORS.text; g.font = `800 24px ${FONT}`;
    g.fillText(t('char.boss').toUpperCase(), W / 2, 17);
    if (chase && d.bossMax) { g.textAlign = 'right'; g.font = `700 20px ${FONT}`; g.fillStyle = COLORS.dim; g.fillText(`${d.bossHpN}/${d.bossMax}`, W - 40, 17); g.textAlign = 'center'; }
    const x = 40, y = 38, w = W - 80, h = 16;
    techFrame(g, x - 10, y - 6, w + 20, h + 12, { fill: 'rgba(4,14,30,0.7)', c: 10, lw: 2 });
    g.fillStyle = 'rgba(255,255,255,0.1)'; g.fillRect(x, y, w, h);
    if (chase && d.bossLag > hp) { g.fillStyle = 'rgba(255,240,200,0.85)'; g.fillRect(x + w * hp, y, w * (d.bossLag - hp), h); } // recent damage
    const gr = g.createLinearGradient(x, 0, x + w, 0); gr.addColorStop(0, '#ff2e55'); gr.addColorStop(1, '#ff6a6a');
    g.fillStyle = gr; g.fillRect(x, y, w * hp, h);
  }
  /** v0.42 boss fight strip: a state label (with a small icon) + the shield meter, or the opening timer while he is open. */
  _drawFight(g) {
    const W = this.fightP.cw, H = this.fightP.ch, F = this.chase.fight;
    g.clearRect(0, 0, W, H); if (!F) return;
    const st = F.state, heavy = F.attack === 'heavy';
    const lab = st === 'telegraph' ? (heavy ? 'fight.hud.heavy' : 'fight.hud.attack') : st === 'vent' ? 'fight.hud.core' : st === 'staggered' ? 'fight.hud.stagger' : st === 'recovering' ? 'fight.hud.recover' : st === 'defeated' ? 'fight.hud.down' : 'fight.hud.shield';
    const col = st === 'staggered' || st === 'vent' ? '#ffd27a' : st === 'telegraph' ? (heavy ? '#ff5a5a' : '#ffb020') : st === 'recovering' ? '#d8f8a0' : '#b6ff6a';
    const x = 40, y = 34, w = W - 80, h = 12;
    // icon: hexagon = shield, diamond = core open, burst = staggered, triangle = attack
    const ix = x + 6, iy = 15; g.fillStyle = col; g.beginPath();
    if (st === 'vent' || st === 'staggered') { g.moveTo(ix, iy - 10); g.lineTo(ix + 10, iy); g.lineTo(ix, iy + 10); g.lineTo(ix - 10, iy); }
    else if (st === 'telegraph') { g.moveTo(ix, iy - 10); g.lineTo(ix + 11, iy + 9); g.lineTo(ix - 11, iy + 9); }
    else for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + (i * Math.PI) / 3; g[i ? 'lineTo' : 'moveTo'](ix + Math.cos(a) * 10, iy + Math.sin(a) * 10); }
    g.closePath(); g.fill();
    g.textAlign = 'left'; g.textBaseline = 'middle'; g.font = `800 20px ${FONT}`; g.fillStyle = col; g.fillText(t(lab), ix + 20, iy + 1);
    g.textAlign = 'right'; g.font = `700 16px ${FONT}`; g.fillStyle = COLORS.dim; g.fillText(t('fight.hud.phase', { n: F.phase }), x + w, iy + 1);
    g.fillStyle = 'rgba(255,255,255,0.1)'; g.fillRect(x, y, w, h);
    const open = st === 'staggered' || st === 'vent';
    if (open) { g.fillStyle = '#ffd27a'; g.fillRect(x, y, w * F.window, h); }
    else { // segmented shield meter (6 cells)
      const v = st === 'recovering' ? 1 : F.shield; g.fillStyle = st === 'recovering' ? 'rgba(216,248,160,0.55)' : '#9dff3a'; g.fillRect(x, y, w * v, h);
      g.fillStyle = 'rgba(4,14,30,0.9)'; for (let i = 1; i < 6; i++) g.fillRect(x + (w * i) / 6 - 1, y, 2, h);
    }
  }
  /** v0.41 chase vitals: Mobius HP (shield icon + bar + number), chase time, Light Bomb readiness ring. */
  _drawVitals(g) {
    const W = this.vit.cw, H = this.vit.ch, d = this.chase;
    techFrame(g, 4, 4, W - 8, H - 8, { fill: 'rgba(4,20,40,0.68)', c: 18 });
    g.textBaseline = 'middle'; g.textAlign = 'left';
    // shield icon
    const ix = 34, iy = 44, low = d.hp <= 0.3;
    g.fillStyle = low ? '#ff4d6d' : '#22d3ff'; g.beginPath(); g.moveTo(ix, iy - 20); g.lineTo(ix + 17, iy - 13); g.lineTo(ix + 14, iy + 8); g.lineTo(ix, iy + 20); g.lineTo(ix - 14, iy + 8); g.lineTo(ix - 17, iy - 13); g.closePath(); g.fill();
    g.fillStyle = 'rgba(4,20,40,0.9)'; g.font = `900 18px ${FONT}`; g.textAlign = 'center'; g.fillText('M', ix, iy + 1); g.textAlign = 'left';
    g.fillStyle = COLORS.dim; g.font = `700 19px ${FONT}`; g.fillText(t('hud.mobiusHp'), 62, 26);
    g.fillStyle = d.hurt ? '#ffffff' : low ? '#ff4d6d' : COLORS.text; g.font = `800 22px ${FONT}`; g.textAlign = 'right'; g.fillText(`${d.hpN ?? 100}`, 300, 26); g.textAlign = 'left';
    const bx = 62, by = 44, bw = 238, bh = 14;
    g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(bx, by, bw, bh);
    if (d.hpLag > d.hp) { g.fillStyle = 'rgba(255,220,220,0.8)'; g.fillRect(bx + bw * d.hp, by, bw * (d.hpLag - d.hp), bh); }
    g.fillStyle = low ? '#ff4d6d' : '#22d3ff'; g.fillRect(bx, by, bw * Math.max(0, d.hp), bh);
    // chase time
    g.fillStyle = COLORS.dim; g.font = `600 19px ${FONT}`; g.fillText(t('hud.chaseTime'), 24, 98);
    g.fillStyle = COLORS.text; g.font = `800 30px ${FONT}`; g.fillText(fmtTime(d.time), 24, 128);
    if (d.flow) this._drawFlowPips(g, d.flow, 32, 150); // v0.45 Flow meter (World Chase, settings.flowMeter)
    // Light Bomb readiness
    const cx = W - 62, cy = 108, R = 30;
    g.lineWidth = 7; g.strokeStyle = 'rgba(95,216,255,0.2)'; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = d.bombReady ? '#7ef0ff' : 'rgba(95,216,255,0.75)'; g.beginPath(); g.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0, Math.min(1, d.bomb))); g.stroke();
    g.fillStyle = d.bombReady ? '#5fd8ff' : 'rgba(95,216,255,0.35)'; g.beginPath(); g.arc(cx, cy, R * 0.55, 0, Math.PI * 2); g.fill();
    if (d.bombReady) { g.shadowColor = '#5fd8ff'; g.shadowBlur = 16; g.fillStyle = '#e8fbff'; g.beginPath(); g.arc(cx, cy, R * 0.22, 0, Math.PI * 2); g.fill(); g.shadowBlur = 0; }
    g.textAlign = 'right'; g.fillStyle = d.bombReady ? '#7ef0ff' : COLORS.dim; g.font = `700 18px ${FONT}`;
    g.fillText(d.bombReady ? t('hud.bombReady') : t('hud.bombCharging'), cx - R - 12, cy - 12);
    g.fillStyle = COLORS.dim; g.font = `600 16px ${FONT}`; g.fillText(t('hud.lightBomb'), cx - R - 12, cy + 14);
  }
  /** v0.47 Story chase combat: Flow pips (left) and the Light Bomb readiness ring (right). Nothing else: no health, no boss bar. */
  _drawStory(g) {
    const W = this.storyP.cw, H = this.storyP.ch, d = this.story; if (!d) return;
    techFrame(g, 4, 4, W - 8, H - 8, { fill: 'rgba(4,20,40,0.68)', c: 16 });
    g.textBaseline = 'middle'; g.textAlign = 'left';
    if (d.flow) { g.fillStyle = COLORS.dim; g.font = `600 17px ${FONT}`; g.fillText(t('hud.flow'), 24, 30); this._drawFlowPips(g, d.flow, 32, H - 36); }
    const R = 24, cx = W - 24 - R, cy = H / 2;
    g.lineWidth = 6; g.strokeStyle = 'rgba(95,216,255,0.2)'; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = d.bombReady ? '#7ef0ff' : 'rgba(95,216,255,0.75)'; g.beginPath(); g.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0, Math.min(1, d.bomb))); g.stroke();
    g.fillStyle = d.bombReady ? '#5fd8ff' : 'rgba(95,216,255,0.35)'; g.beginPath(); g.arc(cx, cy, R * 0.55, 0, Math.PI * 2); g.fill();
    if (d.bombReady) { g.shadowColor = '#5fd8ff'; g.shadowBlur = 14; g.fillStyle = '#e8fbff'; g.beginPath(); g.arc(cx, cy, R * 0.22, 0, Math.PI * 2); g.fill(); g.shadowBlur = 0; }
    g.textAlign = 'right'; g.fillStyle = d.bombReady ? '#7ef0ff' : COLORS.dim; g.font = `700 18px ${FONT}`;
    g.fillText(d.bombReady ? t('hud.bombReady') : t('hud.bombCharging'), cx - R - 12, cy - 12);
    g.fillStyle = COLORS.dim; g.font = `600 16px ${FONT}`; g.fillText(t('hud.lightBomb'), cx - R - 12, cy + 14);
  }
  /** v0.47: the Story run summary shown as free swinging starts (four numbers; nothing is saved). */
  _drawSummary(g) {
    const d = this.summary; if (!d) return;
    const W = 528, H = 240, k = this.sumP.cw / W; // laid out on a 528 × 240 grid, drawn at the panel's own resolution (1000 px per metre: 440 × 200)
    g.save(); g.scale(k, k);
    techFrame(g, 4, 4, W - 8, H - 8, { fill: 'rgba(4,20,40,0.78)', c: 22 });
    g.textBaseline = 'middle'; g.textAlign = 'center'; g.fillStyle = COLORS.perfect; g.font = `800 30px ${FONT}`; g.fillText(t('story.summary.title'), W / 2, 36);
    const rows = [['story.summary.style', Number(d.style || 0).toLocaleString()], ['story.summary.punches', String(d.punches || 0)], ['story.summary.pumpkins', String(d.pumpkins || 0)], ['story.summary.flow', `${d.peakFlow || 0} / 3`]];
    rows.forEach(([k, v], i) => {
      const y = 82 + i * 40;
      g.textAlign = 'left'; g.fillStyle = COLORS.dim; g.font = `600 24px ${FONT}`; g.fillText(t(k), 36, y);
      g.textAlign = 'right'; g.fillStyle = COLORS.text; g.font = `800 28px ${FONT}`; g.fillText(v, W - 36, y);
    });
    g.restore();
  }
  /** v0.45: three small diamonds — filled per Flow level, the next one filling from the bottom by `frac`. */
  _drawFlowPips(g, f, x0, cy) {
    const rx = 7, ry = 8, gap = 22, lit = '#7ef0ff';
    const dia = (cx) => { g.beginPath(); g.moveTo(cx, cy - ry); g.lineTo(cx + rx, cy); g.lineTo(cx, cy + ry); g.lineTo(cx - rx, cy); g.closePath(); };
    for (let i = 0; i < 3; i++) {
      const cx = x0 + i * gap; dia(cx);
      if (i < f.level) { g.fillStyle = lit; g.shadowColor = lit; g.shadowBlur = 8; g.fill(); g.shadowBlur = 0; continue; }
      g.fillStyle = 'rgba(126,240,255,0.14)'; g.fill();
      if (i === f.level && f.frac > 0) { g.save(); g.clip(); g.fillStyle = 'rgba(126,240,255,0.7)'; g.fillRect(cx - rx, cy + ry - 2 * ry * f.frac, 2 * rx, 2 * ry * f.frac); g.restore(); dia(cx); }
      g.lineWidth = 2; g.strokeStyle = 'rgba(126,240,255,0.55)'; g.stroke();
    }
  }
  _drawSong(g) {
    const W = this.song.cw, H = this.song.ch, d = this.data;
    g.clearRect(0, 0, W, H);
    const fmt = (s) => `${String(Math.floor((s || 0) / 60)).padStart(2, '0')}:${String(Math.floor((s || 0) % 60)).padStart(2, '0')}`;
    g.textBaseline = 'middle'; g.fillStyle = COLORS.text; g.textAlign = 'center'; g.font = `700 22px ${FONT}`;
    fitText(g, d.title || '', W * 0.6, 22, 700); g.fillText(d.title || '', W / 2, 16);
    // beat meter: 16 bars, the current sixteenth lit (driven by the song clock)
    const n = 16, bw = 8, gap = (W * 0.5) / n, x0 = W / 2 - (W * 0.5) / 2, ph = ((d.beatPh || 0) % n + n) % n;
    for (let i = 0; i < n; i++) { const on = i === ph, hh = on ? 26 : 8 + 10 * Math.abs(Math.sin(i * 1.7 + (d.beatPh || 0) * 0.9)); g.fillStyle = on ? '#7ef9ff' : 'rgba(34,211,255,0.45)'; g.fillRect(x0 + i * gap, 56 - hh / 2, bw, hh); }
    g.font = `700 20px ${FONT}`; g.textAlign = 'right'; g.fillStyle = COLORS.dim; g.fillText(`${d.bpm || 0} BPM`, W - 24, 56);
    // progress
    const px = 90, pw = W - 180, py = H - 18;
    g.fillStyle = 'rgba(255,255,255,0.15)'; g.fillRect(px, py, pw, 5); g.fillStyle = '#22d3ff'; g.fillRect(px, py, pw * (d.progress || 0), 5);
    g.font = `600 18px ${FONT}`; g.fillStyle = COLORS.dim; g.textAlign = 'right'; g.fillText(fmt(d.time), px - 10, py + 3); g.textAlign = 'left'; g.fillText(fmt(d.duration), px + pw + 10, py + 3);
  }
  _drawObj(g) {
    const W = this.obj.cw, H = this.obj.ch;
    if (!this.objective && !this.tutorial.length) return;
    techFrame(g, 4, 4, W - 8, H - 8, { fill: 'rgba(4,20,40,0.66)', c: 20 });
    g.textAlign = 'left'; g.textBaseline = 'top';
    g.fillStyle = COLORS.warn; g.font = `800 30px ${FONT}`;
    fitText(g, `◆ ${this.objective}`, W - 50, 30, 800); g.fillText(`◆ ${this.objective}`, 24, 18);
    g.fillStyle = COLORS.text; g.font = `500 22px ${FONT}`;
    let y = 60;
    for (const line of this.tutorial.slice(0, 3)) { y = wrapText(g, line, 28, y, W - 56, 28, 2); }
  }
  _drawBanner(g) {
    const W = this.ban.cw, H = this.ban.ch, b = this.banner;
    if (!b.text) return;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const size = fitText(g, b.text, W - 40, 110, 900);
    g.font = `900 italic ${size}px ${FONT}`;
    g.lineWidth = 14; g.strokeStyle = 'rgba(0,10,30,0.85)'; g.strokeText(b.text, W / 2, b.sub ? H * 0.4 : H / 2);
    g.shadowColor = b.color; g.shadowBlur = 24; g.fillStyle = b.color; g.fillText(b.text, W / 2, b.sub ? H * 0.4 : H / 2);
    if (b.sub) { g.shadowBlur = 0; const ss = fitText(g, b.sub, W - 40, 36, 600); g.font = `600 ${ss}px ${FONT}`; g.fillStyle = COLORS.text; g.fillText(b.sub, W / 2, H * 0.8); }
  }
}
