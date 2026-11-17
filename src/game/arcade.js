// Arcade Mode (街機模式): fixed rooftop platform, Green Maniac on the Green Bat
// Jet throws tech pumpkin bombs in sync with the chart; player intercepts with
// webs and blue light bombs. All note motion is a pure function of song time.
import * as THREE from 'three';
import { resolveNotes } from '../core/chart.js';
import { Conductor, audio } from '../core/audio.js';
import { settings } from '../core/settings.js';
import { t } from '../core/i18n.js';
import { pickTarget, angularZoneSize } from './aim.js';
import { judgeTiming, ScoreKeeper, JUDGE } from './judge.js';
import { createPumpkinBomb, createLightBomb, GREEN_MANIAC_THROW_RELEASE } from '../art/enemies.js';
import { ARCADE } from '../data/layout.js';
import { COLORS } from '../ui/panel.js';
import { LaneGuides, assignTracks } from './lanes.js';
import { FanWebFx } from './fanWebFx.js';
import { HallShow } from './hallShow.js';
import { chartSections, ARMORED, ArmoredSeq } from './armored.js';
import { createArmoredPumpkin, armoredModelReady, ARMORED_LOOK } from '../art/armoredPumpkin.js';
import { ArmoredFx } from './armoredFx.js';

const HAND_COLOR = { L: 0xb388ff, R: 0x22d3ff, any: 0xffffff, heavy: 0xffd166, both: 0x9fe8ff };
const TYPE_SCALE = { pumpkin: 1, cluster: 0.85, heavy: 1.65, fanRow: 1 };
const BOMB_WEIGHT = { pumpkin: 0.5, cluster: 1, heavy: 1.5 };
const MISS_WEIGHT = { pumpkin: 1, cluster: 0.7, heavy: 1.8, fanRow: 1.5 }; // a missed row = ONE group miss
/** Fan Web rows (v0.22): score weight of a cleared row (3 bombs), early-feedback margin, cue lead time. */
export const FAN_ROW = { hitWeight: 3, earlyMargin: 0.6, lateMargin: 0.5, cueLead: 1.6, tutorialLead: 3.4, nearHint: 0.35 };
/** v0.48 armored pumpkin: how early / late a wave still gets feedback, when the wave cue shows, how long the fly-in to the player takes on a miss. */
export const ARMORED_PLAY = { earlyMargin: 0.6, cueLead: 1.2, tutorialLead: 3.4, escape: 0.32, holdBob: 0.03, aimSize: 1.6,
  late: 0.6,        // the wave still counts (Good) this long after its beat
  blastLayer: 0.2,  // the blast burns one remaining layer off every 0.2 s …
  blastEnd: 0.35 }; // … and destroys the pumpkin this long after the last layer
const TAUNTS = ['arcade.taunt.1', 'arcade.taunt.2', 'arcade.taunt.3']; // v0.48: his line after two misses in a row (a popup above him)
const BOSS_RELEASE = () => GREEN_MANIAC_THROW_RELEASE; // throw clip release time (bomb leaves his hand on the throw)
const BOSS_DMG = { pumpkin: 1, cluster: 1, heavy: 3, fanRow: 1 }; // Green Maniac HP bar (cosmetic: clearing bombs drains it) // throw animation release time (GREEN_MANIAC_THROW_RELEASE)
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion();

export class ArcadeGame {
  constructor(app) {
    this.app = app;
    this.root = new THREE.Group(); this.root.name = 'arcade'; app.scene.add(this.root);
    this.conductor = new Conductor(audio);
    this.state = 'idle'; // idle | intro | playing | paused | results
    this.pumpkins = []; // pool
    for (let i = 0; i < 30; i++) this.pumpkins.push(this._mkPumpkin('normal'));
    for (let i = 0; i < 6; i++) this.pumpkins.push(this._mkPumpkin('giant'));
    this.lightBombs = [];
    for (let i = 0; i < 6; i++) { const lb = createLightBomb(); lb.root.visible = false; this.root.add(lb.root); this.lightBombs.push({ lb, active: false }); }
    this.handOrbs = { left: createLightBomb(), right: createLightBomb() };
    for (const h of ['left', 'right']) { this.handOrbs[h].root.visible = false; this.root.add(this.handOrbs[h].root); }
    this.debug = { autoplay: false, log: [] };
    this.lanes = new LaneGuides(app.scene); // three floating rhythm lanes (v0.16)
    this.fanFx = new FanWebFx(app.scene, 4, app.fx); // two-hand Fan Web (v0.22); v0.30: + the shared VFX kit
    this.armoredFx = new ArmoredFx(app.scene); this.armored = null; // v0.48: charge pips + beam; the one armored pumpkin (made on the first start, after the model had time to load)
    this.show = new HallShow(app); // v0.48: the hall on the beat and on the combo (settings.arcadeShow)
    this.conductor.onEnded = () => { if (this.state === 'playing') this._finish(false); };
  }
  /** kind: 'normal' (pumpkin / cluster notes) | 'giant' (heavy notes) — the user's GLB bombs when loaded */
  _mkPumpkin(kind = 'normal') {
    const p = createPumpkinBomb({ model: kind });
    p.root.visible = false; this.root.add(p.root);
    return { p, active: false, kind };
  }
  _getPumpkin(kind = 'normal') { let it = this.pumpkins.find((x) => !x.active && x.kind === kind); if (!it) { it = this._mkPumpkin(kind); this.pumpkins.push(it); } it.active = true; it.p.root.visible = true; return it; }
  _free(it) { if (!it) return; it.active = false; it.p.root.visible = false; it.p.setHighlight(0); it._hl = 0; }

  get boss() { return this.app.boss; }

  /** Start a run. song: { id, title, buffer }, chart (validated), difficulty */
  start({ song, chart, difficulty }) {
    this.stop();
    this.song = song; this.chart = chart; this.difficulty = difficulty;
    const { notes, sequences, travelSec, clock } = resolveNotes(chart, difficulty, { armored: settings.arcadeArmored !== false }); // v0.48: off = the armored events are dropped (the v0.46 event count)
    this.travel = settings.arcadeTravelSec > 0 ? settings.arcadeTravelSec : travelSec; // adjustable flight time
    this.clock = clock;
    // lanes: laid out from the arena (player spot → Green Maniac); every note gets a lane (0 L, 1 C, 2 R)
    this.lanes.layout(this.app.arenaOrigin, this.app.arenaForward, this.app.bossHome, this.app.eyeHeight());
    this.lanes.setVisible(true);
    assignTracks(notes);
    this.notes = notes.map((n) => ({ ...n, state: 'pending', obj: null, ring: null, ring2: null, p0: new THREE.Vector3(), strike: this.lanes.strike[n.track].clone(), pos: new THREE.Vector3(), lockedAt: null, missT: 0 }));
    // Fan Web rows: ONE rhythm event each (three member bombs share time, group id and judgement)
    this.rows = new Map();
    for (const n of this.notes) if (n.row) { if (!this.rows.has(n.row)) this.rows.set(n.row, { id: n.row, time: n.time, members: [], state: 'pending', practice: n.practice, cue: n.cue, judged: null, cueSlot: -1 }); this.rows.get(n.row).members[n.member] = n; }
    this.rowList = [...this.rows.values()].sort((a, b) => a.time - b.time);
    this.rowList.forEach((r, i) => { r.cueSlot = i % 2; });
    this.boss.root.scale.setScalar(settings.arcadeBossScale); // smaller: the whole throw path stays in view
    this.bossHits = 0; this.bossTotal = this.notes.reduce((a, n) => a + (BOSS_DMG[n.type] || 1), 0);
    // v0.48 armored sequences: each shell beat is one rhythm event, the wave beat is one more (weight 3). The first of a run is practice.
    this.seqs = sequences.map((q, k) => ({ ...q, from: new THREE.Vector3(), blastT: 0, burnFrom: 0, burnTo: 0, seq: new ArmoredSeq(q), state: 'pending', practice: k === 0, last: k === sequences.length - 1, thrown: false, pos: new THREE.Vector3(), p0: new THREE.Vector3(), endT: 0, cueShown: false }));
    this.armoredStats = { sequences: this.seqs.length, full: 0, partial: 0, miss: 0, shellHits: 0, shellMisses: 0, waves: 0, fizzles: 0, early: 0 };
    if (this.armored && !this.armored.real && armoredModelReady()) { this.root.remove(this.armored.root); this.armored = null; } // the model arrived after a stand-in was made
    if (this.seqs.length && !this.armored) { this.armored = createArmoredPumpkin(() => createPumpkinBomb({ model: 'giant' }).root); this.armored.root.visible = false; this.root.add(this.armored.root); }
    this._armTutShown = false;
    this.bossTotal += this.seqs.reduce((a, q) => a + q.hits + 3, 0);
    this.eventTotal = this.notes.filter((n) => !n.row).length + this.rowList.length + this.seqs.reduce((a, q) => a + q.hits + 1, 0); // rhythm events (a row counts once)
    this.score = new ScoreKeeper(this.eventTotal);
    this.fanFx.clear(); this._fanTutShown = false; this._fanEngagedT = -9; this.fanStats = { fired: 0, hits: 0, early: 0, late: 0, empty: 0, misses: 0, poseFail: 0 };
    this.nextIdx = 0; this.thrownIdx = 0;
    this.conductor.load(song.buffer);
    this.leadIn = 2.0;
    this.conductor.play(0, this.leadIn);
    this.state = 'playing';
    this.flights = [];
    this.lastNoteTime = Math.max(this.notes.length ? this.notes[this.notes.length - 1].time : 0, this.seqs.length ? this.seqs[this.seqs.length - 1].waveTime : 0);
    this.app.hud.setMode('arcade');
    this.app.hud.setObjective(t('game.objective.arcade'), this.app.tutorialLines('arcade'));
    this.app.hud.showBanner(t('game.ready'), this.leadIn, COLORS.text, song.title);
    this._goShown = false; this._tutShown = undefined;
    this.root.visible = true;
    this.boss.setVisible(true);
    this.boss.maniac.setState('dance'); this.boss.maniac.setTempo?.(chart.timing?.bpm); // v4: dances between throws (on tempo)
    audio.loadSfx?.(); audio.loadArcadeSfx?.(); // v0.48: the sample bank is on in the Arcade (decoded in the lead-in; a no-op once loaded)
    this.debug.log = []; this.showStats = { reacts: 0, taunts: 0, ups: 0, downs: 0, bursts: 0 };
    this.show.start({ eventCount: this.eventTotal, sections: chartSections(chart), clock, beatsPerBar: chart.timing?.beatsPerBar || 4, on: settings.arcadeShow !== false });
    this._prewarm();
  }
  /** Warm up shaders / textures of everything the battle will show (see Effects.prewarm). */
  _prewarm() {
    const fx = this.app.fx, fwd = this.app.arenaForward;
    const hidden = this.app.arenaOrigin.clone().addScaledVector(fwd, 4).add(_v.set(0, -2.5, 0)); // under the roof, in view
    fx.preloadPopups([['judge.perfect', COLORS.perfect], ['judge.good', COLORS.good], ['judge.miss', COLORS.bad], ['judge.early', COLORS.warn], ['judge.late', COLORS.warn], ['judge.overheat', COLORS.warn], ['hud.bomb', COLORS.warn], ['judge.wrongHand', COLORS.warn], ['fan.triple', COLORS.perfect], ['fan.need', COLORS.warn], ['fan.pose', COLORS.warn], ['fan.practice', COLORS.warn], ...TAUNTS.map((k) => [k, COLORS.warn]), ['armored.wave', COLORS.perfect], ['armored.crack', COLORS.perfect], ['armored.partial', COLORS.warn], ['armored.notyet', COLORS.warn], ['armored.none', COLORS.warn]]);
    fx.prewarm(hidden, 4);
    this.fanFx.prewarm?.(hidden, 4); // v0.30 vfx: fan shaders compiled in the lead-in too
    this._warmObjs = [];
    for (const it of this.pumpkins.slice(0, 3)) { if (it.active) continue; it.p.root.visible = true; it.p.root.position.copy(hidden); for (const lvl of [0, 1, 2]) it.p.setHighlight(lvl); this._warmObjs.push(it.p.root); }
    // highlight levels use different outline materials → show one pumpkin per level
    this.pumpkins[0].p.setHighlight(0); this.pumpkins[1].p.setHighlight(1); this.pumpkins[2].p.setHighlight(2);
    { const g = this.pumpkins.find((x) => x.kind === 'giant' && !x.active); if (g) { g.p.root.visible = true; g.p.root.position.copy(hidden); this._warmObjs.push(g.p.root); } } // the heavy model too
    for (const b of this.lightBombs.slice(0, 1)) { b.lb.root.visible = true; b.lb.root.position.copy(hidden); this._warmObjs.push(b.lb.root); }
    if (this.armored && this.seqs.length) { this.armored.root.visible = true; this.armored.root.position.copy(hidden); this.armored.showAll(true); this._warmObjs.push(this.armored.root); } // v0.48: all four stage materials
    this.armoredFx.prewarm(hidden, true);
    this._warmFrames = 4;
  }

  noteTime(n) { return n.time + settings.offsetMs / 1000; } // offset: + = judged later

  stop() {
    this.conductor.stop(); this.show?.stop();
    this.lanes.setVisible(false); this.boss.resetScale();
    for (const it of this.pumpkins) this._free(it);
    for (const b of this.lightBombs) { b.active = false; b.lb.root.visible = false; }
    for (const h of ['left', 'right']) this.handOrbs[h].root.visible = false;
    if (this.notes) for (const n of this.notes) this._freeRings(n);
    this.app.fx.clear(); this.fanFx.clear(); this.armoredFx.clear(); if (this.armored) this.armored.root.visible = false;
    this.notes = []; this.seqs = []; this.rows = new Map(); this.rowList = [];
    this.flights = [];
    if (this.state !== 'idle' && this.boss.riding) this.boss.maniac.setState('ride'); // stop dancing (escape / menus)
    this.state = 'idle';
  }
  pause() { if (this.state !== 'playing') return; this.conductor.pause(); this.state = 'paused'; this.app.hud.showBanner(t('hud.paused'), 9999); }
  resume() {
    if (this.state !== 'paused') return;
    this.conductor.resume(3);
    this.state = 'playing';
    this._resumeAt = performance.now() / 1000 + 3;
    this.app.hud.showBanner('3', 1, COLORS.text, t('game.resume3'));
  }

  // --------------------------------------------------------------- frame
  update(dt, tPerf) {
    if (this.app.state !== 'arcade' && this.app.state !== 'results') return; // boss belongs to the story outside arcade
    if (this._warmFrames > 0 && --this._warmFrames === 0) { this.armored?.showAll(false); this.armoredFx.prewarm(null, false); for (const o of this._warmObjs) o.visible = false; for (const it of this.pumpkins) if (!it.active) it.p.setHighlight(0); for (const b of this.lightBombs) if (!b.active) b.lb.root.visible = false; }
    if (this.state !== 'playing') { this._updateBoss(dt, tPerf, this.conductor.now()); return; }
    const c = this.conductor; c.tick();
    if (this.state !== 'playing') return;
    const now = c.now();
    const fx = this.app.fx, hud = this.app.hud;
    // resume countdown banner
    if (this._resumeAt) {
      const left = this._resumeAt - tPerf;
      if (left > 0) { const s = String(Math.ceil(left)); if (hud.banner.text !== s) { hud.showBanner(s, 1, COLORS.text, t('game.resume3')); audio.play('tick'); } }
      else { this._resumeAt = 0; hud.hideBanner(); }
    }
    if (!this._goShown && now >= -0.05 && now < 1) { this._goShown = true; hud.showBanner(t('game.go'), 0.8, COLORS.perfect); }
    { const showTut = now < 8; if (showTut !== this._tutShown) { this._tutShown = showTut; hud.setObjectiveVisible(showTut); } } // then the lanes stay clear

    // spawn (boss throws ahead of the beat so the bomb ARRIVES on the beat)
    while (this.thrownIdx < this.notes.length && now >= this.noteTime(this.notes[this.thrownIdx]) - this.travel - BOSS_RELEASE()) {
      this.boss.throw(); this.thrownIdx++;
    }
    while (this.nextIdx < this.notes.length && now >= this.noteTime(this.notes[this.nextIdx]) - this.travel) {
      const n = this.notes[this.nextIdx++];
      n.state = 'flying'; n.obj = this._getPumpkin(n.type === 'heavy' ? 'giant' : 'normal');
      n.obj.p.root.scale.setScalar(TYPE_SCALE[n.type]);
      fx.vfx?.pumpkinFlight(n.obj.p, { scale: TYPE_SCALE[n.type] }); // v0.30 vfx: face glow, fuse sparks, green trail (visual only)
      this.boss.throwPoint(n.p0);
      n.ring = fx.ring(); n.ring.mat.color.set(n.type === 'heavy' ? HAND_COLOR.heavy : HAND_COLOR[n.hand]);
      if (n.row) { n.ring2 = fx.ring(); n.ring2.mat.color.set(HAND_COLOR.both); } // row cue: double ring (shape, not only colour)
      audio.play('throwEnemy', this._pan(n.p0));
    }

    // move notes, rings, misses
    const camPos = this.app.camera.getWorldPosition(_v).clone();
    const hot = this._hot || (this._hot = [0, 0, 0]); hot[0] = hot[1] = hot[2] = 0;
    for (let i = Math.max(0, this.nextIdx - 40); i < this.nextIdx; i++) {
      const n = this.notes[i];
      if (n.state === 'flying' || n.state === 'escaping') {
        const T = this.noteTime(n), u = (now - (T - this.travel)) / this.travel;
        this._notePos(n, u, camPos, n.pos);
        n.obj.p.root.position.copy(n.pos);
        n.obj.p.root.lookAt(camPos);
        n.obj.p.update(dt);
        n.obj.p.setGlow(THREE.MathUtils.clamp(u, 0, 1));
        // approach ring: shrinks onto the lane's judgement ring exactly on the beat
        if (n.ring) {
          const k = THREE.MathUtils.clamp((T - now) / 0.9, 0, 1);
          const r = settings.arcadeRingRadius * (n.type === 'heavy' ? 1.35 : 1) * (1 + 1.6 * k);
          n.ring.mesh.position.copy(n.strike); n.ring.mesh.lookAt(camPos); n.ring.mesh.scale.setScalar(r);
          n.ring.mat.opacity = k >= 1 ? 0 : 0.2 + 0.7 * (1 - k);
          if (n.ring2) { n.ring2.mesh.position.copy(n.strike); n.ring2.mesh.lookAt(camPos); n.ring2.mesh.scale.setScalar(r * 0.72); n.ring2.mat.opacity = n.ring.mat.opacity; }
          if (now > T + settings.goodWindow) this._freeRings(n);
        }
        if (n.state === 'flying') { const hk = THREE.MathUtils.clamp(1 - (T - now) / 1.2, 0, 1); if (hk > hot[n.track]) hot[n.track] = hk; }
        if (n.state === 'flying' && now > T + settings.goodWindow) {
          if (n.row) this._rowMiss(this.rows.get(n.row), now); // the whole row, once
          else { n.state = 'escaping'; n.missT = now; this._judge(n, JUDGE.MISS, 0, { weight: MISS_WEIGHT[n.type] }); }
        }
        if (n.state === 'escaping' && now - n.missT > 0.32) {
          fx.vfx?.missBlast(n.pos, camPos) || fx.boom(n.pos, { color: 0xffb020, size: 0.9 }); audio.play('boomEnemy', this._pan(n.pos)); // v0.30 vfx
          const row = n.row ? this.rows.get(n.row) : null;
          if (!row || (n.member === 1 && !row.practice)) { audio.play('damage'); this.app.flashDamage?.(); } // a row hurts once; practice not at all
          this._retire(n);
        }
      } else if (n.state === 'netted' && n.obj) {
        n.netT += dt; const k = Math.min(1, n.netT / 0.22);
        n.obj.p.root.scale.setScalar(TYPE_SCALE[n.type] * (1 - 0.35 * k)); n.obj.p.update(dt);
        if (k >= 1) { fx.vfx?.pumpkinBurst(n.pos, { size: TYPE_SCALE[n.type], floor: this.app.arenaOrigin.y, clear: true }) || fx.boom(n.pos, { color: 0x8ff0ff, size: 0.45 * TYPE_SCALE[n.type], life: 0.45 }); n.state = 'done'; this._retire(n); } // v0.30 vfx
      } else if (n.state === 'locked' && n.obj) {
        n.obj.p.root.position.copy(n.pos); n.obj.p.update(dt); if (n.obj._hl !== 2) { n.obj._hl = 2; n.obj.p.setHighlight(2); }
      }
    }

    // input
    const hub = this.app.hub;
    const overheated = this.score.overheated(now);
    for (const e of hub.events) {
      if (overheated && (e.type === 'web' || e.type === 'bombThrow' || e.type === 'fanWeb')) { /* (the energy wave is never blocked by overheat) */ fx.popup('judge.overheat', e.origin.clone().addScaledVector(e.dir, 1.2), COLORS.warn); continue; }
      if (e.type === 'fanWeb') this._onFanWeb(e, now, tPerf);
      else if (e.type === 'energyWave') this._onEnergyWave(e, now, tPerf);
      else if (e.type === 'web') this._onWeb(e, now);
      else if (e.type === 'bombThrow') this._onBomb(e, now);
      else if (e.type === 'bombCharge') audio.play('charge');
      else if (e.type === 'bombFizzle') audio.play('fizzle');
    }
    if (hub.fan?.engaged) this._fanEngagedT = now;
    if (this.debug.autoplay) this._autoplay(now, tPerf);
    this._updateRows(now, camPos);
    this._updateArmored(dt, now, camPos);
    this.fanFx.update(dt);
    const beatSec = 60 / (this.clock?.bpmAt(this.clock.secToBeat(now)) || this.chart.timing.bpm);
    this.lanes.update(now, beatSec, (this.chart.timing.offsetSec || 0) + settings.offsetMs / 1000, this.travel, hot);
    this.show.update(dt, { now, beatSec, offsetSec: (this.chart.timing.offsetSec || 0) + settings.offsetMs / 1000, combo: this.score.combo, comfort: !!settings.comfortMode, beat: this.clock ? this.clock.secToBeat(now - settings.offsetMs / 1000) : null,
      nextThrowIn: this.thrownIdx < this.notes.length ? this.noteTime(this.notes[this.thrownIdx]) - this.travel - BOSS_RELEASE() - now : Infinity });
    this._showEvents(now);
    this._updateFlights(dt, now);
    this._updateAim(now);
    this._updateHandOrbs();
    this._updateBoss(dt, tPerf, now);

    // HUD
    const s = this.score;
    hud.setStats({ score: s.score, combo: s.combo, acc: s.accuracy, shield: s.shield, progress: Math.min(1, Math.max(0, now / this.conductor.duration)),
      bossHp: 1 - Math.min(1, this.bossHits / Math.max(1, this.bossTotal)), title: this.song.title, time: Math.max(0, now), duration: this.conductor.duration, bpm: Math.round(60 / beatSec), beatPh: Math.floor(((now - (this.chart.timing.offsetSec || 0)) / beatSec) * 4), status: overheated ? t('judge.overheat') : (hub.trackingLost.left || hub.trackingLost.right) && hub.inputKind === 'hands' ? t('hud.tracking') : '', weapons: { left: { bomb: hub.bombCharge.left ? hub.bombCharge.left : 1, lost: hub.trackingLost.left }, right: { bomb: hub.bombCharge.right ? hub.bombCharge.right : 1, lost: hub.trackingLost.right } } });

    if (s.failed) { this._finish(true); return; }
    // all notes judged & retired, past last note → wait for song end (or 2 s after if audio ended early)
    if (this.nextIdx >= this.notes.length && now > this.lastNoteTime + settings.offsetMs / 1000 + 1.5 && now >= this.conductor.duration - 0.05) this._finish(false);
  }

  _pan(p) { const cam = this.app.camera; const local = cam.worldToLocal(_w.copy(p)); return THREE.MathUtils.clamp(local.x / 4, -1, 1); }

  /** Position on the throw arc. u ∈ [0,1] reaches strike at the beat; u>1 continues to the player. */
  _notePos(n, u, camPos, out) {
    if (u <= 1) {
      // along the note's lane (straight, reaches the judgement ring at the beat); the first 12 %
      // blends out of Green Maniac's throwing hand so the bomb visibly leaves the boss
      const uu = Math.max(0, u);
      this.lanes.point(n.track, uu, out);
      if (uu < 0.12) { const k = uu / 0.12, e = k * k * (3 - 2 * k); out.lerpVectors(n.p0, out, e); }
    } else {
      // continue from strike toward the player's chest
      const chest = _w.copy(camPos); chest.y -= 0.35;
      const k = Math.min(1.2, (u - 1) * this.travel / 0.35);
      out.lerpVectors(n.strike, chest, k);
    }
    return out;
  }

  /** origin (optional): aim origin → enforces an angular tolerance floor (settings.arcadeAssistDeg). */
  _candidates(now, earlyMargin, origin = null) {
    const list = [];
    for (let i = Math.max(0, this.nextIdx - 40); i < this.nextIdx; i++) {
      const n = this.notes[i];
      if (n.state !== 'flying' || n.row) continue; // row bombs belong to the Fan Web only (never picked off one by one)
      const dt = now - this.noteTime(n);
      if (dt < -settings.goodWindow - earlyMargin || dt > settings.goodWindow) continue;
      let w = 0.32 * TYPE_SCALE[n.type], h = w * 0.85;
      if (origin) { const a = angularZoneSize(origin.distanceTo(n.pos), settings.arcadeAssistDeg, settings.assistMargin, 0); w = Math.max(w, a); h = Math.max(h, a); }
      list.push({ pos: n.pos, w, h, note: n });
    }
    return list;
  }

  /**
   * Auto-target (settings.arcadeAutoAim): ignore aim direction entirely; pick the note whose
   * beat is closest to *now* among notes inside the timing window (+ early margin).
   * Webs prefer notes for the firing hand and skip heavies; bombs prefer heavy/cluster.
   */
  _autoPick(now, earlyMargin, hand, kind) {
    const code = hand === 'left' ? 'L' : 'R';
    let best = null, bestKey = Infinity;
    for (const c of this._candidates(now, earlyMargin)) {
      const n = c.note;
      if (kind === 'web' && n.type === 'heavy') continue;
      const dt = Math.abs(now - this.noteTime(n));
      let key = dt;
      if (kind === 'web' && n.hand !== 'any' && n.hand !== code) key += 0.5; // other hand's note only if nothing else
      if (kind === 'bomb') key -= n.type === 'heavy' ? 0.3 : n.type === 'cluster' ? 0.2 : 0;
      if (key < bestKey) { bestKey = key; best = c; }
    }
    return best ? { target: best } : null;
  }

  _onWeb(e, now) {
    const fx = this.app.fx;
    if (this._armoredWeb(e, now)) return; // v0.48: a shell beat of the armored pumpkin
    const pick = settings.arcadeAutoAim ? this._autoPick(now, 0.6, e.hand, 'web')
      : pickTarget(e.origin, e.dir, this._candidates(now, 0.6, e.origin), { margin: settings.assistMargin, maxDist: 40 });
    audio.play('web', this._pan(e.origin));
    this.app.hub.haptic(e.hand, 0.3, 20);
    if (!pick) {
      fx.web(e.origin, _v.copy(e.origin).addScaledVector(e.dir, 22));
      if (this._rowHint(now)) return; // a Fan Web row is due: show how to answer it (no spam penalty)
      this.score.invalidShot(now);
      return;
    }
    const n = pick.target.note;
    fx.web(e.origin, n.pos);
    const handCode = e.hand === 'left' ? 'L' : 'R';
    const dt = now - this.noteTime(n);
    if (n.type === 'heavy') { fx.popup('hud.bomb', n.pos.clone().add(_v.set(0, 0.35, 0)), COLORS.warn); this.score.invalidShot(now); audio.play('early'); return; }
    if (!settings.arcadeAutoAim && n.hand !== 'any' && n.hand !== handCode) { fx.popup('judge.wrongHand', n.pos.clone().add(_v.set(0, 0.3, 0)), COLORS.warn); this.score.invalidShot(now); audio.play('early'); return; }
    const j = judgeTiming(dt);
    if (!j) {
      if (dt < 0) { fx.popup('judge.early', n.pos.clone().add(_v.set(0, 0.3, 0)), COLORS.warn); audio.play('early'); this.score.invalidShot(now); }
      return;
    }
    fx.net(n.pos, 0.32 * TYPE_SCALE[n.type]);
    this._destroy(n, j, dt, 1, 'web');
  }

  _onBomb(e, now) {
    const fx = this.app.fx;
    const vel = (e.worldVelocity || e.dir.clone().multiplyScalar(3)).clone();
    const dir = vel.clone().normalize();
    audio.play('throw', this._pan(e.origin));
    this.app.hub.haptic(e.hand, 0.6, 40);
    // generous assist for an area weapon: 60% margin, within timing window only
    const cands = this._candidates(now, 0.0);
    const pick = settings.arcadeAutoAim ? this._autoPick(now, 0, e.hand, 'bomb')
      : (pickTarget(e.origin, dir, cands, { margin: 0.6, maxDist: 30 }) || pickTarget(e.origin, e.dir, cands, { margin: 0.6, maxDist: 30 }));
    const fl = this.lightBombs.find((b) => !b.active) || this.lightBombs[0];
    fl.active = true; fl.done = false; fl.lb.root.visible = true; fl.lb.setCharge(1);
    fl.from = e.origin.clone(); fl.t = 0;
    this.app.fx.vfx?.blueTrail(fl.lb.root); // v0.30 vfx: throw trail (visual only)
    if (pick) {
      const primary = pick.target.note;
      const locked = [primary];
      for (const c of cands) if (c.note !== primary && c.note.pos.distanceTo(primary.pos) <= 1.15) locked.push(c.note);
      for (const n of locked) { n.state = 'locked'; n.lockedAt = now; n.lockDt = now - this.noteTime(n); if (n.ring) { this.app.fx.freeRing(n.ring); n.ring = null; } }
      fl.target = primary.pos.clone(); fl.locked = locked; fl.dur = Math.max(0.12, fl.from.distanceTo(fl.target) / 18);
      fl.mode = 'locked';
    } else {
      fl.target = null; fl.mode = 'free'; fl.vel = dir.multiplyScalar(Math.max(9, vel.length() * 4)); fl.dur = 0.9; fl.locked = [];
      if (!this._rowHint(now)) this.score.invalidShot(now);
    }
    this.flights.push(fl);
  }

  _updateFlights(dt, now) {
    const fx = this.app.fx;
    for (const fl of this.flights) {
      fl.t += dt;
      const r = fl.lb.root;
      if (fl.mode === 'locked') {
        const k = Math.min(1, fl.t / fl.dur);
        r.position.lerpVectors(fl.from, fl.target, k); r.position.y += Math.sin(Math.PI * k) * 0.4;
      } else {
        fl.vel.y -= 4 * dt; r.position.copy(fl.from).addScaledVector(fl.vel, fl.t).add(_v.set(0, -2 * fl.t * fl.t, 0));
        // contact with any note inside its window
        for (const c of this._candidates(now, 0)) if (c.note.pos.distanceTo(r.position) < 0.5) { fl.locked.push(c.note); c.note.state = 'locked'; c.note.lockDt = now - this.noteTime(c.note); fl.t = fl.dur; fl.target = fl.target || c.note.pos.clone(); }
      }
      fl.lb.update(dt);
      if (fl.t >= fl.dur) {
        const at = fl.mode === 'locked' || fl.locked.length ? (fl.target || r.position) : r.position;
        fx.vfx?.blueBomb(at) || fx.boom(at, { color: 0x5fd8ff, size: 1.4 }); audio.play('boomBlue', this._pan(at)); // v0.30 vfx
        for (const n of fl.locked) {
          const j = judgeTiming(n.lockDt) || JUDGE.GOOD; // locked only when inside window at release
          this._destroy(n, j, n.lockDt, BOMB_WEIGHT[n.type], 'bomb');
        }
        fl.active = false; r.visible = false; fl.done = true;
      }
    }
    this.flights = this.flights.filter((f) => !f.done);
  }

  _destroy(n, result, dt, weight, via) {
    const fx = this.app.fx;
    this.bossHits += BOSS_DMG[n.type] || 1;
    this._judge(n, result, dt, { weight }); // scored now (exactly once); the visuals follow
    audio.play(via === 'web' ? 'webHit' : 'boomBlue', this._pan(n.pos));
    if (via === 'web' && n.obj) { // the web net wraps the bomb for a moment, then it pops (sparks + beat pulse)
      n.state = 'netted'; n.netT = 0; if (n.ring) { fx.freeRing(n.ring); n.ring = null; }
      fx.net(n.pos, 0.2 * TYPE_SCALE[n.type], null, 0.32);
      return;
    }
    fx.vfx?.pumpkinBurst(n.pos, { size: TYPE_SCALE[n.type], by: 'bomb', floor: this.app.arenaOrigin.y, clear: true }) || fx.boom(n.pos, { color: 0x5fd8ff, size: 0.7 * TYPE_SCALE[n.type] }); // v0.30 vfx
    this._retire(n);
  }
  _judge(n, result, dt, { weight = 1 } = {}) {
    if (!this.score.record(n.id, result, { dt, weight })) return;
    const fx = this.app.fx;
    const key = result === JUDGE.PERFECT ? 'judge.perfect' : result === JUDGE.GOOD ? 'judge.good' : 'judge.miss';
    const col = result === JUDGE.PERFECT ? COLORS.perfect : result === JUDGE.GOOD ? COLORS.good : COLORS.bad;
    fx.popup(key, n.pos.clone().add(_v.set(0, 0.35, 0)), col);
    if (result !== JUDGE.MISS) audio.play(result, this._pan(n.pos)); else audio.play('miss');
    this.debug.log.push({ id: n.id, result, dt: +dt.toFixed(4), t: +this.noteTime(n).toFixed(3) });
    this.show.onEvent(result); // v0.48: the hall follows the player
  }
  /** v0.48: what the hall show asks of the Arcade this frame: Green Maniac's reactions and taunts, the level sounds. */
  _showEvents(now) {
    const r = this.show.takeReact();
    if (r?.kind === 'hit') this.boss.maniac.setState('hit', r.variant);
    else if (r?.kind === 'taunt') { this.app.fx.popup(TAUNTS[r.n % TAUNTS.length], _v.copy(this.app.bossHome).add(_w.set(0, 1.5, 0)).clone(), COLORS.warn); this.showStats.taunts++; }
    if (r?.kind === 'hit') this.showStats.reacts++;
    if (this.show.takeBurst()) { this.showStats.bursts++; audio.playOr('hallBurst', 'hallBurst'); }
    const lv = this.show.takeLevelEvent();
    if (lv) { this.showStats[lv.up ? 'ups' : 'downs']++; audio.play(lv.up ? `comboUp${lv.level}` : 'comboBreak'); }
  }
  _freeRings(n) { if (n.ring) { this.app.fx.freeRing(n.ring); n.ring = null; } if (n.ring2) { this.app.fx.freeRing(n.ring2); n.ring2 = null; } }
  _retire(n) {
    this._freeRings(n);
    this._free(n.obj); n.obj = null; n.state = n.state === 'escaping' ? 'missed' : 'done';
  }

  // --------------------------------------------------------------- Fan Web rows (v0.22)
  /**
   * Two-hand Fan Web. Judged on the CONTACT time (e.tContact, performance clock) converted to the music clock
   * of this frame — never on when the fan visually reaches the bombs. Picks the closest pending row inside the
   * Good window; one gesture clears at most one row; early / late never carry over to another beat.
   */
  _onFanWeb(e, now, tPerf) {
    const fx = this.app.fx, cam = this.app.camera.getWorldPosition(_w).clone();
    const ts = now - Math.max(0, (tPerf ?? performance.now() / 1000) - (e.tContact ?? tPerf ?? 0)); // contact time on the music clock
    const origin = e.origin ? e.origin.clone() : cam.clone().add(_v.set(0, -0.45, 0)).addScaledVector(this.app.arenaForward, 0.35);
    this.fanStats.fired++;
    audio.play('fanCharge'); this._fanContactFx(origin, e);
    let best = null, bestDt = 0;
    for (const r of this.rowList) {
      if (r.state !== 'pending') continue;
      const dt = ts - this.noteTime(r);
      if (Math.abs(dt) <= settings.goodWindow && (!best || Math.abs(dt) < Math.abs(bestDt))) { best = r; bestDt = dt; }
    }
    if (best && best.members.every((m) => m.state === 'flying')) { this._rowHit(best, judgeTiming(bestDt), bestDt, origin); return; }
    // no row in the window: early (one is coming) / late (one just went by) / nothing to hit
    const up = this.rowList.find((r) => r.state === 'pending' && ts - this.noteTime(r) < -settings.goodWindow && ts - this.noteTime(r) > -settings.goodWindow - FAN_ROW.earlyMargin);
    const gone = this.rowList.find((r) => r.state === 'missed' && now - r.missedAt < FAN_ROW.lateMargin);
    const at = this._rowCenter(up || gone) || origin.clone().addScaledVector(this.app.arenaForward, 3);
    this.fanFx.fire(origin, (up || gone) ? (up || gone).members.map((m) => (m.obj ? m.pos : m.strike)) : this.lanes.strike, 0x2f7fb8, { hit: false });
    if (up) { this.fanStats.early++; fx.popup('judge.early', at.clone().add(_v.set(0, 0.45, 0)), COLORS.warn); audio.play('early'); }
    else if (gone) { this.fanStats.late++; fx.popup('judge.late', at.clone().add(_v.set(0, 0.45, 0)), COLORS.warn); audio.play('early'); }
    else { this.fanStats.empty++; this.score.invalidShot(now); }
  }
  _rowHit(row, result, dt, origin) {
    const fx = this.app.fx;
    row.state = 'cleared'; row.judged = result;
    this.fanStats.hits++;
    const pts = row.members.map((m) => m.pos.clone()), cam = this.app.camera.getWorldPosition(new THREE.Vector3());
    this.fanFx.fire(origin, pts);
    for (const m of row.members) { // all three wrapped + popped together (same judgement)
      this.bossHits += BOSS_DMG.fanRow;
      m.state = 'netted'; m.netT = 0; this._freeRings(m);
      fx.web(_w.copy(origin).lerp(m.pos, 0.3), m.pos, { life: 0.3 }); // a bright strand to each bomb (starts ahead of the hands)
      fx.net(m.pos, 0.42, null, 0.4);
      fx.boom(m.pos, { color: 0x7ef0ff, size: 0.55, life: 0.45 });
      this.fanFx.burst(m.pos, cam); // shock ring, spark burst, orange shell shards
    }
    this.lanes.pulseAll?.(); // beat pulse on the three judgement rings
    this.fanFx.showCue(row.cueSlot, null, null, null, null, null);
    if (this.score.record(row.id, result, { dt, weight: FAN_ROW.hitWeight })) { // ONE rhythm event: combo +1, score ×3
      const c = this._rowCenter(row);
      const key = result === JUDGE.PERFECT ? 'judge.perfect' : 'judge.good', col = result === JUDGE.PERFECT ? COLORS.perfect : COLORS.good;
      fx.popup(key, c.clone().add(_v.set(0, 0.78, 0)), col); // one group judgement (not three) + the row label below it
      fx.popup('fan.triple', c.clone().add(_v.set(0, 0.42, 0)), COLORS.perfect);
      audio.play('fanHit', 0); audio.play(result, 0);
      this.show.onEvent('fanRow'); this.show.onEvent(result); // v0.48: a wave along the floor streaks
      this.debug.log.push({ id: row.id, result, dt: +dt.toFixed(4), t: +this.noteTime(row).toFixed(3), row: true });
    }
  }
  _rowMiss(row, now) {
    if (!row || row.state !== 'pending') return;
    row.state = 'missed'; row.missedAt = now;
    for (const m of row.members) if (m.state === 'flying') { m.state = 'escaping'; m.missT = now; }
    this.fanFx.showCue(row.cueSlot, null, null, null, null, null);
    this.fanStats.misses++;
    const poseFail = now - this._fanEngagedT < 0.9; // the hands were trying: the gesture was not recognised
    if (poseFail) this.fanStats.poseFail++;
    const c = this._rowCenter(row);
    if (!row.practice && this.score.record(row.id, JUDGE.MISS, { weight: MISS_WEIGHT.fanRow })) this.show.onEvent('miss'); // one group miss
    this.app.fx.popup(poseFail ? 'fan.pose' : row.practice ? 'fan.practice' : 'judge.miss', c.clone().add(_v.set(0, 0.5, 0)), poseFail || row.practice ? COLORS.warn : COLORS.bad);
    audio.play('miss');
    this.debug.log.push({ id: row.id, result: JUDGE.MISS, dt: 0, t: +this.noteTime(row).toFixed(3), row: true, practice: !!row.practice, poseFail });
  }
  _rowCenter(row) { if (!row) return null; const m = row.members[1] || row.members[0]; return (m.obj ? m.pos : m.strike).clone(); }
  /** One-hand attack while a row is due → tell the player it needs the Fan Web (not counted as spam). */
  _rowHint(now) {
    const r = this.rowList?.find((x) => x.state === 'pending' && Math.abs(now - this.noteTime(x)) < settings.goodWindow + FAN_ROW.nearHint);
    if (!r) return false;
    if ((this._rowHintT || -9) < now - 0.8) { this._rowHintT = now; this.app.fx.popup('fan.need', this._rowCenter(r).add(_v.set(0, 0.5, 0)), COLORS.warn); }
    return true;
  }
  _fanContactFx(origin, e) {
    const fx = this.app.fx;
    fx.boom(origin, { color: 0x7ef0ff, size: 0.22, life: 0.3 }); // energy gathering at the contact point
    for (const w of e.wrists || []) if (w) fx.web(w, origin, { life: 0.22 }); // linked to both wrist emitters
  }
  _updateRows(now, cam) {
    if (!this.rowList?.length) return;
    for (const r of this.rowList) {
      const T = this.noteTime(r), k = 1 - (T - now) / FAN_ROW.cueLead;
      if (r.practice && !this._fanTutShown && T - now < FAN_ROW.tutorialLead) { // first row: name + how-to, with time to prepare
        this._fanTutShown = true; this.app.hud.showBanner(t('fan.name'), 3.0, COLORS.perfect, t('fan.short'));
      }
      const live = r.state === 'pending' && r.members.every((m) => m.obj && m.state === 'flying');
      if (live && k > 0) this.fanFx.showCue(r.cueSlot, r.members[0].pos, r.members[2].pos, r.members[1].pos, cam, Math.min(1, k));
      else if (r.state !== 'pending' || !live) { if (r.cueSlot >= 0 && (r.state !== 'pending')) this.fanFx.showCue(r.cueSlot, null, null, null, null, null); }
    }
  }

  // --------------------------------------------------------------- armored pumpkin + energy wave (v0.48)
  _seqT(t) { return t + settings.offsetMs / 1000; }
  /** how far above the armored pumpkin's centre its text sits (it grew three times; the offsets were written for 0.65 m) */
  _armTop() { return Math.max(0, (this.armored?.size(this.armored.stage) ?? 0.65) / 2 - 0.3); }
  /** The sequence in play (the pumpkin is out), if any. */
  _liveSeq() { return this.seqs?.find((q) => q.state === 'flying' || q.state === 'holding' || q.state === 'blasting') || null; }
  _updateArmored(dt, now, camPos) {
    const fx = this.app.fx, hub = this.app.hub, A = this.armored;
    this.armoredFx.update(dt);
    let live = null;
    for (const q of this.seqs) {
      const hold = this._seqT(q.holdTime);
      if (q.state === 'pending') {
        if (!q.thrown && now >= hold - this.travel - BOSS_RELEASE()) { q.thrown = true; this.boss.throw(); }
        if (q.practice && !this._armTutShown && hold - now < ARMORED_PLAY.tutorialLead) { this._armTutShown = true; this.app.hud.showBanner(t('armored.name'), 3.4, COLORS.perfect, t('armored.short')); }
        if (now >= hold - this.travel) { q.state = 'flying'; this.boss.throwPoint(q.p0); A.setStage(0); A.root.visible = true; audio.play('throwEnemy', this._pan(q.p0)); }
      }
      if (q.state === 'flying' || q.state === 'holding') {
        live = q;
        const u = (now - (hold - this.travel)) / this.travel;
        if (u < 1) { this.lanes.point(1, Math.max(0, u), q.pos); if (u < 0.12) { const k = Math.max(0, u) / 0.12; q.pos.lerpVectors(q.p0, q.pos, k * k * (3 - 2 * k)); } }
        else { if (q.state === 'flying') this._armoredLand(q); q.state = 'holding'; q.pos.copy(this.lanes.strike[1]); q.pos.y += Math.sin(now * 2.4) * ARMORED_PLAY.holdBob; } // it holds at the centre judgement ring
        A.root.position.copy(q.pos); A.root.lookAt(camPos);
        if (q.state === 'flying' && now - (q.trailT || 0) > 0.07) { q.trailT = now; fx.boom(q.pos, { color: 0xffa020, size: 0.5, life: 0.3 }); } // a burning trail as it flies in (the instanced kit)
        // shell beats that went by: that layer stays on (nothing grows back)
        for (let i = 0; i < q.hits; i++) if (q.seq.shell[i] === null && now > this._seqT(q.shellTimes[i]) + settings.goodWindow) {
          q.seq.shellMiss(i); this.armoredStats.shellMisses++;
          audio.playOr('shellRegrow', 'miss', this._pan(q.pos));
          if (!q.practice && this.score.record(`${q.id}.s${i}`, JUDGE.MISS, { weight: 1 })) { fx.popup('judge.miss', q.pos.clone().add(_v.set(0, 0.45 + this._armTop(), 0)), COLORS.bad); this.show.onEvent('miss'); this.debug.log.push({ id: `${q.id}.s${i}`, result: JUDGE.MISS, dt: 0, t: +this._seqT(q.shellTimes[i]).toFixed(3), armored: true }); }
        }
        // the wave cue, then: no wave in time = a miss, and it flies at the player
        const wT = this._seqT(q.waveTime);
        if (!q.cueShown && now >= wT - ARMORED_PLAY.cueLead) { q.cueShown = true; fx.popup('armored.wave', q.pos.clone().add(_v.set(0, 0.6 + this._armTop(), 0)), COLORS.perfect); audio.playOr('waveCharge', 'fanCharge', 0); }
        if (now > wT + Math.max(settings.goodWindow, ARMORED_PLAY.late)) {
          q.seq.expire(); q.state = 'escaping'; q.endT = now; this.armoredStats.miss++;
          if (!q.practice && this.score.record(`${q.id}.w`, JUDGE.MISS, { weight: MISS_WEIGHT.heavy })) { fx.popup('judge.miss', q.pos.clone().add(_v.set(0, 0.45 + this._armTop(), 0)), COLORS.bad); audio.play('miss'); this.show.onEvent('miss'); }
          else if (q.practice) fx.popup('fan.practice', q.pos.clone().add(_v.set(0, 0.45 + this._armTop(), 0)), COLORS.warn);
          this.debug.log.push({ id: `${q.id}.w`, result: JUDGE.MISS, dt: 0, t: +wT.toFixed(3), armored: true, practice: q.practice });
        }
      } else if (q.state === 'blasting') { // 2026-11-15: the beam stays on from the join until the pumpkin is destroyed
        live = q; A.root.position.copy(q.pos); A.root.lookAt(camPos); // it stays where the blast caught it
        const g = hub.grip; if (g.left?.valid && g.right?.valid) q.from.copy(g.left.pos).add(g.right.pos).multiplyScalar(0.5);
        this.armoredFx.aim(q.from, q.pos);
        if (now - (q.sparkT || 0) > 0.09) { q.sparkT = now; fx.boom(q.pos, { color: 0x8ff0ff, size: 0.45 + 0.25 * Math.random(), life: 0.25 }); this.app.hub.haptic('left', 0.35, 60); this.app.hub.haptic('right', 0.35, 60); } // sparks off the pumpkin while the beam is on it
        const el = now - q.blastT, burn = Math.min(q.burnTo, q.burnFrom + Math.floor(el / ARMORED_PLAY.blastLayer));
        while (A.stage < burn) { const b = A.stage; A.setStage(b + 1); this.armoredFx.kick(1); fx.boom(q.pos, { color: ARMORED_LOOK.burst[b] ?? 0xffa020, size: 0.6, life: 0.35 }); audio.play(`shellCrack${b + 1}`, this._pan(q.pos)); }
        if (el >= (q.burnTo - q.burnFrom) * ARMORED_PLAY.blastLayer + ARMORED_PLAY.blastEnd) {
          fx.vfx?.pumpkinBurst(q.pos, { size: 1.6, by: 'bomb', floor: this.app.arenaOrigin.y, clear: true }) || fx.boom(q.pos, { color: 0x5fd8ff, size: 1.2 });
          fx.boom(q.pos, { color: 0x7ef0ff, size: 2.6, life: 0.7 }); audio.play('boomBlue', this._pan(q.pos)); this.lanes.pulseAll?.();
          fx.boom(q.pos, { color: 0x9dffb0, size: 4.2, life: 0.9 }); fx.boom(q.pos, { color: 0xffffff, size: 1.8, life: 0.3 }); // the core lets go: a wide green shock and a white flash
          for (let k = 0; k < 6; k++) fx.boom(_v.copy(q.pos).add(_w.set((Math.random() - 0.5) * 2.4, (Math.random() - 0.3) * 1.6, (Math.random() - 0.5) * 1.2)), { color: [0x4dff6a, 0xffa020, 0x8ff0ff][k % 3], size: 0.7 + Math.random() * 0.6, life: 0.35 + Math.random() * 0.3 });
          this.app.hub.haptic('left', 1, 200); this.app.hub.haptic('right', 1, 200);
          this.armoredFx.release(); q.state = 'done'; A.root.visible = false; live = null;
          if (q.last) { this._lastWaveAt = now; this.boss.maniac.setState('hit', 'head'); fx.boom(_v.copy(this.app.bossHome), { color: 0x7ef0ff, size: 1.6, life: 0.6 }); } // the last wave of the song carries on into Green Maniac
        }
      } else if (q.state === 'escaping') {
        const k = Math.min(1, (now - q.endT) / ARMORED_PLAY.escape), chest = _w.copy(camPos); chest.y -= 0.35;
        q.pos.lerpVectors(this.lanes.strike[1], chest, k); A.root.position.copy(q.pos);
        if (k >= 1) {
          fx.vfx?.missBlast(q.pos, camPos) || fx.boom(q.pos, { color: 0xffb020, size: 1.2 }); audio.play('boomEnemy', this._pan(q.pos));
          if (!q.practice) { audio.play('damage'); this.app.flashDamage?.(); }
          q.state = 'done'; A.root.visible = false;
        }
      }
    }
    // its aura: a shell and circling motes in the colour of the layer showing, breathing on the beat
    if (live && A.root.visible) this.armoredFx.setAura(true, live.pos, A.size(A.stage) / 2, A.stage, dt, this.show.out?.beat ?? 0); else this.armoredFx.setAura(false);
    // hand charge: one pip per layer removed, on both hands; the lit pips swell as the palms come together
    if (live) {
      const g = hub.grip, glow = hub.wave?.engaged ? THREE.MathUtils.clamp(1 - (hub.wave.debug.dist - 0.14) / 0.2, 0, 1) : 0;
      this.armoredFx.setCharge(true, live.seq.charge, [g.left, g.right], this.app.camera, glow);
    } else this.armoredFx.setCharge(false);
  }
  /** A web while the armored pumpkin holds: cracks one layer when a shell beat is inside the Good window. Returns true when the web was for it. */
  _armoredWeb(e, now) {
    const q = this._liveSeq(); if (!q || q.state !== 'holding') return false;
    if (!settings.arcadeAutoAim && !pickTarget(e.origin, e.dir, [{ pos: q.pos, w: ARMORED_PLAY.aimSize, h: ARMORED_PLAY.aimSize, note: q }], { margin: settings.assistMargin, maxDist: 40 })) return false;
    let best = -1, bestDt = 0;
    for (let i = 0; i < q.hits; i++) { if (q.seq.shell[i] !== null) continue; const dt = now - this._seqT(q.shellTimes[i]); if (best < 0 || Math.abs(dt) < Math.abs(bestDt)) { best = i; bestDt = dt; } }
    audio.play('web', this._pan(e.origin)); this.app.hub.haptic(e.hand, 0.3, 20); this.app.fx.web(e.origin, q.pos);
    if (best < 0) { // every layer is judged: it wants the wave now
      this.app.fx.popup('armored.wave', q.pos.clone().add(_v.set(0, 0.45 + this._armTop(), 0)), COLORS.perfect); return true;
    }
    if (Math.abs(bestDt) > settings.goodWindow) {
      if (bestDt < 0) { this.app.fx.popup('judge.early', q.pos.clone().add(_v.set(0, 0.35 + this._armTop(), 0)), COLORS.warn); audio.play('early'); this.score.invalidShot(now); }
      return true;
    }
    this._shellHit(q, best, bestDt, e.origin);
    return true;
  }
  /** The armored pumpkin arrives at the ring: it slams to a stop. */
  _armoredLand(q) {
    const fx = this.app.fx, p = this.lanes.strike[1];
    fx.boom(p, { color: 0x4dff6a, size: 2.4, life: 0.6 }); fx.boom(p, { color: 0xffa020, size: 1.5, life: 0.4 });
    this.armoredFx.kick(1); this.lanes.pulseAll?.(); audio.playOr('heavyWindup', 'boomEnemy', 0);
    this.app.hub.haptic('left', 0.6, 120); this.app.hub.haptic('right', 0.6, 120);
  }
  _shellHit(q, i, dt, from) {
    const fx = this.app.fx, before = q.seq.stage;
    q.seq.shellHit(i); if (q.seq.stage === before) return;
    const result = judgeTiming(dt) || JUDGE.GOOD;
    this.armoredStats.shellHits++; this.bossHits += 1;
    this.armored.setStage(q.seq.stage); // the next stage swaps in; the burst is the colour of the layer that just broke
    this.armoredFx.kick(1); fx.boom(q.pos, { color: ARMORED_LOOK.burst[before] ?? 0xffa020, size: 1.6, life: 0.45 }); // the aura flares and a big shard burst the size of the pumpkin
    fx.net(q.pos, 0.3, null, 0.25);
    fx.boom(q.pos, { color: ARMORED_LOOK.burst[before] ?? 0xffa020, size: 0.55, life: 0.4 });
    audio.play(`shellCrack${q.seq.stage}`, this._pan(q.pos));
    this.app.hub.haptic('left', 0.25, 30); this.app.hub.haptic('right', 0.25, 30);
    if (this.score.record(`${q.id}.s${i}`, result, { dt, weight: 1 })) {
      fx.popup(result === JUDGE.PERFECT ? 'judge.perfect' : 'judge.good', q.pos.clone().add(_v.set(0, 0.45 + this._armTop(), 0)), result === JUDGE.PERFECT ? COLORS.perfect : COLORS.good);
      audio.play(result, this._pan(q.pos)); this.show.onEvent(result);
      this.debug.log.push({ id: `${q.id}.s${i}`, result, dt: +dt.toFixed(4), t: +this._seqT(q.shellTimes[i]).toFixed(3), armored: true });
    }
  }
  /**
   * The two-palm energy wave. Judged on the CONTACT time (e.tContact, performance clock) converted to the music clock of
   * this frame, like the Fan Web. With every layer off: Perfect or Good by the timing. With a layer left it still destroys
   * the pumpkin, Good at best. With nothing due: Early if one is about to arrive, else a fizzle (an invalid shot).
   */
  _onEnergyWave(e, now, tPerf) {
    const fx = this.app.fx, cam = this.app.camera.getWorldPosition(new THREE.Vector3());
    if (this.state !== 'playing') return;
    const ts = now - Math.max(0, (tPerf ?? performance.now() / 1000) - (e.tContact ?? tPerf ?? 0));
    const origin = e.origin ? e.origin.clone() : cam.clone().add(_v.set(0, -0.3, 0)).addScaledVector(this.app.arenaForward, 0.4);
    this.armoredStats.waves++;
    const q = this._liveSeq(), wT = q ? this._seqT(q.waveTime) : 0, dt = ts - wT;
    if (q && (q.state === 'holding' || q.state === 'flying')) { // (also while it is still flying in: the blast starts at once, wherever it is)
      // 2026-11-15 (headset try): the join counts at ANY moment while the pumpkin is out, and the blast then
      // runs until it is destroyed. Perfect or Good by the timing needs every layer off and the join on its beat; anything else
      // (armor left, early, late) is Good. Shell beats not yet reached are not counted as misses.
      const onBeat = Math.abs(dt) <= settings.goodWindow;
      const outcome = q.seq.wave(), full = outcome === 'full';
      const result = full && onBeat ? (judgeTiming(dt) || JUDGE.GOOD) : JUDGE.GOOD;
      this.armoredStats[outcome]++; this.bossHits += 3; if (!onBeat) this.armoredStats.offBeat = (this.armoredStats.offBeat || 0) + 1;
      q.state = 'blasting'; q.blastT = now; q.from.copy(origin); q.burnFrom = this.armored.stage; q.burnTo = q.hits;
      this.armoredFx.hold(origin, q.pos, true, this.armored.size(this.armored.stage) / 2);
      audio.playOr('waveFire', 'boomBlue', 0); this.app.hub.haptic('left', 0.8, 250); this.app.hub.haptic('right', 0.8, 250);
      fx.boom(origin, { color: 0xbff4ff, size: 0.9, life: 0.35 }); // a flash at the palms
      if (this.score.record(`${q.id}.w`, result, { dt, weight: ARMORED.waveWeight })) {
        fx.popup(result === JUDGE.PERFECT ? 'judge.perfect' : 'judge.good', q.pos.clone().add(_v.set(0, 0.7 + this._armTop(), 0)), result === JUDGE.PERFECT ? COLORS.perfect : COLORS.good);
        if (!full) fx.popup('armored.partial', q.pos.clone().add(_v.set(0, 0.4 + this._armTop(), 0)), COLORS.warn);
        audio.play(result, 0); this.show.onEvent('wave'); this.show.onEvent(result);
        this.debug.log.push({ id: `${q.id}.w`, result, dt: +dt.toFixed(4), t: +wT.toFixed(3), armored: true, outcome, onBeat });
      }
      return;
    }
    if (q && q.state === 'blasting') return; // already blasting it
    // no armored pumpkin is out: a small puff at the palms and a line saying so. It is not counted as an invalid shot, so trying
    // the gesture never leads to overheat.
    fx.boom(origin, { color: 0x8ff0ff, size: 0.35, life: 0.3 });
    fx.popup('armored.none', origin.clone().addScaledVector(this.app.arenaForward, 1.2), COLORS.warn);
    this.armoredStats.fizzles++; audio.play('fizzle');
  }

  _updateAim(now) {
    // Reticles, aim lines and the bomb outline highlight used to switch on/off every frame when
    // hand tracking or the web-pose confidence jittered (→ constant flicker). Now each hand keeps
    // its last state for 0.2 s, and the highlighted bomb only changes when the target changes.
    const hub = this.app.hub, fx = this.app.fx, tNow = performance.now() / 1000;
    this._aimHold = this._aimHold || { left: { until: 0, note: null, end: new THREE.Vector3(), pick: false }, right: { until: 0, note: null, end: new THREE.Vector3(), pick: false } };
    const want = new Set();
    for (const h of ['left', 'right']) {
      const a = hub.aim[h], ret = fx.reticles[h], hold = this._aimHold[h];
      let shown = false;
      if (a.valid && !hub.ctx.menuOpen && !hub.ctx.uiHover[h]) {
        const near = hub.mode[h] !== 'hand' || hub.machines[h].web.conf > 0.18 || hub.machines[h].web.active;
        const pick = settings.arcadeAutoAim ? this._autoPick(now, 0.6, h, 'web') : pickTarget(a.origin, a.dir, this._candidates(now, 0.6, a.origin), { margin: settings.assistMargin, maxDist: 40 });
        if (near || pick) {
          hold.until = tNow + 0.2; hold.note = pick?.target.note || null; hold.pick = !!pick;
          hold.end.copy(pick ? pick.target.pos : _v.copy(a.origin).addScaledVector(a.dir, 8));
          if (hub.mode[h] !== 'desktop') fx.setAimLine(h, a.origin, hold.end, pick ? 0.5 : 0.18); else fx.aimLines[h].visible = false;
          shown = true;
        }
      }
      if (!shown && tNow > hold.until) { ret.visible = false; fx.aimLines[h].visible = false; hold.note = null; continue; }
      if (hold.note && (hold.note.state !== 'flying' || !hold.note.obj)) { hold.note = null; hold.pick = false; }
      if (hold.note) { want.add(hold.note); hold.end.copy(hold.note.pos); }
      ret.visible = true; ret.position.copy(hold.end); ret.lookAt(this.app.camera.getWorldPosition(_w));
      ret.scale.setScalar(hold.pick ? 1.4 : Math.max(1, this.app.camera.getWorldPosition(_w).distanceTo(hold.end) * 0.25));
    }
    for (const c of this._candidates(now, 0.6)) { const o = c.note.obj; if (!o) continue; const lvl = want.has(c.note) ? 2 : 0; if (o._hl !== lvl) { o._hl = lvl; o.p.setHighlight(lvl); } }
  }
  _updateHandOrbs() {
    const hub = this.app.hub;
    for (const h of ['left', 'right']) {
      const o = this.handOrbs[h], c = hub.bombCharge[h];
      o.root.visible = c > 0 && hub.grip[h].valid;
      if (o.root.visible) { o.root.position.copy(hub.grip[h].pos); o.setCharge(c); o.root.scale.setScalar(0.5 + 0.6 * c); o.update(1 / 72); }
    }
  }
  _updateBoss(dt, tPerf, now) {
    // sway in sync with the beat (bar-length figure-8) — purely cosmetic
    const beat = this.chart ? (now - this.chart.timing.offsetSec) * this.chart.timing.bpm / 60 : tPerf * 2;
    this.boss.hoverAt(this.app.bossHome, beat, this.app.camera.getWorldPosition(_v), dt, tPerf);
  }

  _finish(failed) {
    if (this.state !== 'playing') return;
    this.state = 'results'; this.show.stop();
    this.lanes.setVisible(false);
    if (failed) this.conductor.stop();
    this.result = { ...this.score.summary(), failed: failed || this.score.failed, songId: this.song.id, difficulty: this.difficulty, total: this.eventTotal, fan: { ...this.fanStats, rows: this.rowList.length }, armored: { ...this.armoredStats } };
    if (this.result.failed) this.result.rank = 'F';
    else this.boss.maniac.setState('angryLoop'); // v7: the player won → Green Maniac lost: angry
    for (const it of this.pumpkins) this._free(it);
    for (const n of this.notes) this._freeRings(n);
    this.fanFx.clear(); this.armoredFx.clear(); if (this.armored) this.armored.root.visible = false;
    this.app.hud.hideBanner();
    this.app.onArcadeFinished(this.result);
  }

  // -------------------------------------------------------------- testing
  /** Dev/test autoplay: fires a perfectly-timed web/bomb at each note on its beat. */
  _autoplay(now, tPerf = performance.now() / 1000) {
    if (this.debug.autoplayArmored !== false) for (const q of this.seqs) { // v0.48: webs on the shell beats, the wave on its beat
      if (q.state !== 'holding') continue;
      const skip = this.debug.autoplayShellSkip || 0; // (tests: leave the first n shell beats unanswered)
      for (let i = skip; i < q.hits; i++) if (q.seq.shell[i] === null && now >= this._seqT(q.shellTimes[i]) + (this.debug.autoplayDt || 0)) this._shellHit(q, i, now - this._seqT(q.shellTimes[i]), this.app.camera.getWorldPosition(new THREE.Vector3()));
      if (this.debug.autoplayWave !== false && now >= this._seqT(q.waveTime) + (this.debug.autoplayDt || 0)) this._onEnergyWave({ tContact: tPerf, t: tPerf, source: 'autoplay' }, now, tPerf);
    }
    for (let i = Math.max(0, this.nextIdx - 40); i < this.nextIdx; i++) {
      const n = this.notes[i];
      if (n.state !== 'flying' || now < this.noteTime(n) + (this.debug.autoplayDt || 0)) continue;
      if (n.row) { if (this.debug.autoplayFan !== false && this.rows.get(n.row).state === 'pending') this._onFanWeb({ tContact: tPerf, t: tPerf, source: 'autoplay' }, now, tPerf); continue; }
      const origin = this.app.camera.getWorldPosition(new THREE.Vector3()); origin.y -= 0.3;
      const dir = this.debug.randomDir ? new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize() : n.pos.clone().sub(origin).normalize();
      if (n.type === 'pumpkin') this._onWeb({ hand: n.hand === 'L' ? 'left' : 'right', origin, dir }, now);
      else this._onBomb({ hand: 'right', origin, dir, worldVelocity: dir.clone().multiplyScalar(4) }, now);
    }
  }
}
