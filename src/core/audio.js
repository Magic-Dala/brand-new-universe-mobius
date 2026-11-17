// Web Audio engine: one AudioContext, mix buses, buffer cache, synthesized
// placeholder SFX, and the Conductor (rhythm clock based on audio time).
import { settings, onSettingsChange } from './settings.js';
import { SampleBank, panFor } from './sfx.js';
import { SFX_MANIFEST_STORY, SFX_MANIFEST_ARCADE } from '../data/sfxManifest.js';
import { FEEL } from '../data/feel.js';

/** v0.45 names that replaced a v0.44 call: when no sample plays for them they play the v0.44 sound (null = v0.44 played nothing there). */
const V044_ALIAS = { bossHit: 'boomEnemy', stagger: 'boomEnemy', release: 'web', heavyWindup: null };

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.buffers = new Map();
    this._noise = null;
    this.listeners = new Set();
  }

  /** Must be called from a user gesture (click / XR entry button). */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC({ latencyHint: 'interactive' });
      const c = this.ctx;
      this.master = c.createGain();
      this.music = c.createGain();
      this.sfx = c.createGain();
      this.ambient = c.createGain();
      this.comp = c.createDynamicsCompressor();
      this.comp.threshold.value = -10; this.comp.ratio.value = 4;
      // v0.45: music → low-pass → lift → master (time warp / Flow meter drive setMusicFilter; neutral = 20 kHz, ×1)
      this.musicLP = c.createBiquadFilter(); this.musicLP.type = 'lowpass'; this.musicLP.frequency.value = 20000; this.musicLP.Q.value = 0.5;
      this.musicLift = c.createGain();
      this.music.connect(this.musicLP).connect(this.musicLift).connect(this.master); this.sfx.connect(this.master); this.ambient.connect(this.master);
      this.master.connect(this.comp).connect(c.destination);
      this.applyVolumes();
      onSettingsChange((k) => { if (k.endsWith('Volume')) this.applyVolumes(); });
      c.onstatechange = () => this.listeners.forEach((f) => f(c.state));
    }
    if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
    this.loadRoomTheme(); // v0.28b: ~1.2 MB, decoded in the background
    return this.ctx;
  }
  onStateChange(f) { this.listeners.add(f); return () => this.listeners.delete(f); }
  get running() { return !!this.ctx && this.ctx.state === 'running'; }
  applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(settings.masterVolume, t, 0.02);
    this.music.gain.setTargetAtTime(settings.musicVolume, t, 0.02);
    this.sfx.gain.setTargetAtTime(settings.sfxVolume, t, 0.02);
    this.ambient.gain.setTargetAtTime(settings.musicVolume * 0.6, t, 0.02);
  }

  async loadBuffer(url) {
    if (this.buffers.has(url)) return this.buffers.get(url);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const arr = await res.arrayBuffer();
    const buf = await this.decode(arr);
    this.buffers.set(url, buf);
    return buf;
  }
  decode(arrayBuffer) {
    const ctx = this.ctx || this.unlock();
    return new Promise((resolve, reject) => {
      const p = ctx.decodeAudioData(arrayBuffer, resolve, reject);
      if (p && p.then) p.then(resolve, reject);
    });
  }

  // ------------------------------------------------------------------ SFX
  noiseBuffer() {
    if (this._noise) return this._noise;
    const c = this.ctx, len = c.sampleRate;
    const b = c.createBuffer(1, len, c.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return (this._noise = b);
  }
  _env(g, t, a, peak, dcy) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + dcy);
  }
  _pan(p) {
    const c = this.ctx;
    if (!c.createStereoPanner) return null;
    const n = c.createStereoPanner(); n.pan.value = Math.max(-1, Math.min(1, p)); return n;
  }
  _out(node, pan = 0, bus = this.sfx) {
    if (this._gm !== undefined && this._gm !== 1) { const m = this.ctx.createGain(); m.gain.value = this._gm; node.connect(m); node = m; } // v0.45: per-call multiplier (play(…, gain)); none when omitted
    const p = pan ? this._pan(pan) : null;
    if (p) { node.connect(p); p.connect(bus); } else node.connect(bus);
  }
  noise(dur, { type = 'bandpass', f0 = 2000, f1 = 600, q = 1, gain = 0.5, attack = 0.005, pan = 0, when = 0 } = {}) {
    const c = this.ctx; if (!c) return;
    const t = c.currentTime + when;
    const s = c.createBufferSource(); s.buffer = this.noiseBuffer();
    const f = c.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain(); this._env(g, t, attack, gain, dur);
    s.connect(f).connect(g); this._out(g, pan);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
  }
  tone(freq, dur, { type = 'sine', gain = 0.3, attack = 0.005, slideTo = 0, pan = 0, when = 0, bus } = {}) {
    const c = this.ctx; if (!c) return;
    const t = c.currentTime + when;
    const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = c.createGain(); this._env(g, t, attack, gain, dur);
    o.connect(g); this._out(g, pan, bus || this.sfx);
    o.start(t); o.stop(t + attack + dur + 0.05);
  }
  /** v0.45: music-bus low-pass cutoff (Hz) and lift (gain); 20000 and 1 = neutral. */
  setMusicFilter(cutoffHz, lift = 1) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.musicLP.frequency.setTargetAtTime(Math.max(20, Math.min(20000, cutoffHz)), t, 0.08);
    this.musicLift.gain.setTargetAtTime(lift, t, 0.08);
  }
  /** v0.45: samples play only while true (main.js: the World Chase state); Arcade / Story keep the synthesized sounds. */
  useBank = false;
  /** v0.45: listener pose for positional samples (SampleBank.play): head position + right vector. */
  setListener(pos, right) { this._lpos = pos; this._lright = right; }
  /** v0.45: fetch + decode the designed samples (creates the bank on first call). Never rejects. */
  loadSfx() {
    if (!this.bank) this.bank = new SampleBank(this);
    return this.bank.load(`${import.meta.env?.BASE_URL || '/'}audio/sfx/`);
  }
  /** v0.47: the Story's own samples (SFX_MANIFEST_STORY) are consulted first while true (main.js: Story with settings.storyCombat on). World Chase never sets it, so it sounds as in v0.46. */
  useStory = false;
  /** v0.47: fetch + decode the World Chase samples and the Story's own (a second bank that shares the first one's voice limit). Never rejects. */
  loadStorySfx() {
    const base = `${import.meta.env?.BASE_URL || '/'}audio/sfx/`;
    if (!this.bank) this.bank = new SampleBank(this);
    if (!this.storyBank) { this.storyBank = new SampleBank(this, SFX_MANIFEST_STORY); this.storyBank.voices = this.bank.voices; } // one voice pool: FEEL.sfx.maxVoices in all
    return Promise.all([this.bank.load(base), this.storyBank.load(base)]);
  }
  /** v0.48: the Arcade's own samples (SFX_MANIFEST_ARCADE) are consulted while true (main.js: the Arcade). Story and World Chase never set it. */
  useArcade = false;
  /** v0.48: fetch + decode the Arcade's own samples (a third bank on the same voice pool). Never rejects. */
  loadArcadeSfx() {
    const base = `${import.meta.env?.BASE_URL || '/'}audio/sfx/`;
    if (!this.bank) this.bank = new SampleBank(this);
    if (!this.arcadeBank) { this.arcadeBank = new SampleBank(this, SFX_MANIFEST_ARCADE); this.arcadeBank.voices = this.bank.voices; }
    return this.arcadeBank.load(base);
  }
  /** A designed sample for `name`, if the banks are in use and one plays (the Story's own bank first while useStory). */
  _sample(name, pan, pos, gain, listener) {
    if (!this.useBank || settings.designedSfx === false) return false;
    const o = { pan, pos, gain, listener };
    if (this.useStory && this.storyBank && this.storyBank.play(name, o)) return true;
    if (this.useArcade && this.arcadeBank && this.arcadeBank.play(name, o)) return true;
    return !!(this.bank && this.bank.play(name, o));
  }
  /** v0.47: `name` as a designed sample; when none plays, the synthesized `fallback` sound (for names whose own fallback is fixed by v0.45, e.g. heavyWindup = silence). */
  playOr(name, fallback, pan = 0, pos = null, gain = 1) {
    if (!this.running) return;
    const listener = this._lpos ? { pos: this._lpos, right: this._lright } : null;
    if (this._sample(name, pan, pos, gain, listener)) return;
    this.play(fallback, pan, pos, gain);
  }
  play(name, pan = 0, pos = null, gain = 1) { // v0.45: pos + gain apply to samples and to the synth fallback (pan from the listener, gain as a multiplier)
    if (!this.running) return;
    const listener = this._lpos ? { pos: this._lpos, right: this._lright } : null; // a null listener = "no position"
    if (this._sample(name, pan, pos, gain, listener)) return; // v0.45: designed sample first, synth below as fallback
    if (name in V044_ALIAS) { const a = V044_ALIAS[name]; if (a) this.play(a, pan); return; } // v0.45: no sample played → the v0.44 sound, played as v0.44 did (no position, no gain)
    if (pos && listener) pan = panFor(pos, listener, pan);
    this._step = 0; { const m = /^(comboUp|shellCrack)([1-9])$/.exec(name); if (m) { name = m[1]; this._step = +m[2]; } } // v0.48: comboUp1…3 / shellCrack1…3 = rising steps of one synthesized sound
    this._gm = gain; try { this._synth(name, pan); } finally { this._gm = 1; }
  }
  _synth(name, pan) {
    switch (name) {
      case 'web': // "thwip"
        this.noise(0.12, { f0: 5000, f1: 1200, q: 2, gain: 0.35, pan });
        this.tone(1400, 0.08, { type: 'triangle', slideTo: 500, gain: 0.12, pan });
        break;
      case 'shieldOn': // v0.44 palm shield rises: soft rising shimmer
        this.tone(520, 0.14, { type: 'triangle', slideTo: 1040, gain: 0.07, attack: 0.02, pan });
        this.noise(0.12, { f0: 3500, f1: 6000, q: 3, gain: 0.08, attack: 0.03, pan });
        break;
      case 'shieldOff': // … and folds away
        this.tone(900, 0.1, { type: 'triangle', slideTo: 450, gain: 0.045, pan });
        break;
      case 'shieldHit': // a pumpkin bursts on it: bright ping over a short thud
        this.tone(1320, 0.16, { type: 'triangle', slideTo: 880, gain: 0.12, pan });
        this.noise(0.22, { type: 'lowpass', f0: 2400, f1: 200, gain: 0.4, pan });
        this.tone(150, 0.2, { type: 'sine', slideTo: 60, gain: 0.3, pan });
        break;
      case 'shieldBreak': // overload: falling crackle
        this.tone(700, 0.3, { type: 'sawtooth', slideTo: 110, gain: 0.07, pan });
        this.noise(0.35, { f0: 4000, f1: 400, q: 1.5, gain: 0.22, pan });
        break;
      case 'pull': // v0.44 web pull: the strand tightens (short rising creak — restrained)
        this.tone(300, 0.16, { type: 'triangle', slideTo: 620, gain: 0.07, attack: 0.02, pan });
        this.noise(0.14, { f0: 900, f1: 2600, q: 2.5, gain: 0.1, attack: 0.03, pan });
        break;
      case 'fanCharge': // two-hand contact: short rising spark
        this.tone(660, 0.09, { type: 'triangle', slideTo: 1980, gain: 0.12, pan });
        this.noise(0.08, { f0: 6000, f1: 2500, q: 3, gain: 0.18, pan });
        break;
      case 'fanHit': // the whole row breaks at once: wide shimmer + low thump
        this.noise(0.32, { f0: 4500, f1: 700, q: 1.2, gain: 0.36, pan });
        this.tone(1320, 0.18, { type: 'square', slideTo: 2640, gain: 0.06, pan: -0.6 });
        this.tone(1320, 0.18, { type: 'square', slideTo: 2640, gain: 0.06, pan: 0.6 });
        this.tone(110, 0.22, { type: 'sine', slideTo: 55, gain: 0.3, pan });
        break;
      case 'webHit':
        this.tone(880, 0.12, { type: 'square', slideTo: 1760, gain: 0.07, pan });
        this.noise(0.18, { f0: 3000, f1: 800, gain: 0.2, pan });
        break;
      case 'charge':
        this.tone(220, 0.35, { type: 'sawtooth', slideTo: 660, gain: 0.05, attack: 0.05, pan });
        break;
      case 'throw':
        this.noise(0.22, { type: 'highpass', f0: 800, f1: 3000, gain: 0.25, attack: 0.02, pan });
        break;
      case 'fizzle':
        this.noise(0.25, { f0: 1200, f1: 200, gain: 0.12, pan });
        break;
      case 'boomBlue':
        this.noise(0.5, { type: 'lowpass', f0: 3000, f1: 120, gain: 0.7, pan });
        this.tone(140, 0.4, { type: 'sine', slideTo: 40, gain: 0.5, pan });
        this.tone(1200, 0.25, { type: 'triangle', slideTo: 2400, gain: 0.06, pan });
        break;
      case 'coin': // v0.23: bright two-note pickup chime
        this.tone(1568, 0.07, { type: 'square', gain: 0.06, pan });
        this.tone(2349, 0.16, { type: 'triangle', gain: 0.09, pan, when: 0.06 });
        break;
      case 'wallStep': // v0.23: wall-run footstep (soft armoured thud)
        this.noise(0.07, { type: 'lowpass', f0: 900, f1: 200, gain: 0.22, pan });
        this.tone(110, 0.06, { type: 'sine', slideTo: 70, gain: 0.12, pan });
        break;
      case 'boomFar': // v6: a pumpkin bomb going off down in the street (heard from Mobius' room: muffled, low)
        this.noise(1.1, { type: 'lowpass', f0: 500, f1: 40, gain: 0.32, attack: 0.02, pan });
        this.tone(60, 0.9, { type: 'sine', slideTo: 25, gain: 0.28, pan });
        break;
      case 'boomEnemy':
        this.noise(0.7, { type: 'lowpass', f0: 1500, f1: 60, gain: 0.8, pan });
        this.tone(90, 0.6, { type: 'sine', slideTo: 30, gain: 0.6, pan });
        break;
      case 'perfect':
        this.tone(1318.5, 0.12, { type: 'triangle', gain: 0.12, pan });
        this.tone(1975.5, 0.18, { type: 'triangle', gain: 0.08, when: 0.04, pan });
        break;
      case 'good':
        this.tone(988, 0.12, { type: 'triangle', gain: 0.1, pan });
        break;
      case 'miss':
        this.tone(160, 0.25, { type: 'square', slideTo: 90, gain: 0.08, pan });
        break;
      case 'early':
        this.tone(330, 0.08, { type: 'square', gain: 0.04, pan });
        break;
      case 'hover':
        this.tone(1800, 0.03, { type: 'sine', gain: 0.03 });
        break;
      case 'click':
        this.tone(1200, 0.05, { type: 'square', gain: 0.05 });
        this.tone(2400, 0.04, { type: 'sine', gain: 0.04, when: 0.02 });
        break;
      case 'tick':
        this.tone(1760, 0.04, { type: 'square', gain: 0.12 });
        break;
      case 'tickDown':
        this.tone(2637, 0.06, { type: 'square', gain: 0.15 });
        break;
      case 'throwEnemy':
        this.noise(0.3, { type: 'bandpass', f0: 400, f1: 1600, q: 0.8, gain: 0.18, attack: 0.03, pan });
        break;
      case 'punch':
        this.noise(0.12, { type: 'lowpass', f0: 2500, f1: 200, gain: 0.6, pan });
        this.tone(110, 0.12, { type: 'sine', slideTo: 50, gain: 0.5, pan });
        break;
      case 'suitUp':
        for (let i = 0; i < 6; i++) this.tone(440 * Math.pow(1.26, i), 0.15, { type: 'triangle', gain: 0.08, when: i * 0.07 });
        this.noise(0.8, { type: 'highpass', f0: 500, f1: 6000, gain: 0.12, attack: 0.2 });
        break;
      case 'radio':
        this.noise(0.6, { type: 'bandpass', f0: 1800, f1: 1400, q: 3, gain: 0.12, attack: 0.05 });
        break;
      case 'alarm':
        this.tone(880, 0.18, { type: 'square', gain: 0.06 });
        this.tone(660, 0.18, { type: 'square', gain: 0.06, when: 0.2 });
        break;
      case 'jetFlyby': // doppler-ish whoosh + engine roar
        this.noise(2.2, { type: 'bandpass', f0: 300, f1: 1800, q: 0.7, gain: 0.5, attack: 0.6 });
        this.tone(70, 2.0, { type: 'sawtooth', slideTo: 140, gain: 0.12, attack: 0.5 });
        this.tone(55, 2.4, { type: 'square', slideTo: 40, gain: 0.08, attack: 0.8, when: 0.6 });
        break;
      case 'attach':
        this.tone(600, 0.06, { type: 'square', slideTo: 300, gain: 0.08, pan });
        break;
      case 'teleport':
        this.tone(500, 0.15, { type: 'sine', slideTo: 1200, gain: 0.08 });
        break;
      case 'turn':
        this.tone(700, 0.04, { type: 'sine', gain: 0.04 });
        break;
      case 'damage':
        this.noise(0.3, { type: 'lowpass', f0: 800, f1: 100, gain: 0.5 });
        break;
      case 'roofBlast': // the factory roof gives way: big low boom + metal tearing
        this.noise(1.4, { type: 'lowpass', f0: 2200, f1: 50, gain: 0.9 });
        this.tone(70, 1.2, { type: 'sine', slideTo: 24, gain: 0.7 });
        this.noise(0.9, { type: 'bandpass', f0: 1800, f1: 500, q: 3, gain: 0.25, when: 0.15 });
        this.tone(320, 0.8, { type: 'sawtooth', slideTo: 140, gain: 0.05, when: 0.2 });
        break;
      case 'debris': // panels and bricks clattering
        for (let k = 0; k < 5; k++) this.noise(0.12, { type: 'bandpass', f0: 2500 - k * 300, f1: 900, q: 4, gain: 0.18, when: k * 0.11 + Math.random() * 0.05 });
        break;
      case 'land': // soft landing thud (no shake)
        this.noise(0.35, { type: 'lowpass', f0: 600, f1: 80, gain: 0.55 });
        this.tone(90, 0.25, { type: 'sine', slideTo: 45, gain: 0.35 });
        break;
      case 'thrust': // back-pack thrusters (fall assist): short soft jet burst
        this.noise(0.45, { type: 'bandpass', f0: 900, f1: 420, q: 0.9, gain: 0.16, attack: 0.06, pan });
        this.tone(95, 0.4, { type: 'sawtooth', slideTo: 80, gain: 0.03, attack: 0.08 });
        break;
      case 'doorBreak': // Green Maniac bursting through the roll-up door
        this.noise(0.9, { type: 'lowpass', f0: 1800, f1: 120, gain: 0.7 });
        for (let k = 0; k < 6; k++) this.noise(0.16, { type: 'bandpass', f0: 3200 - k * 350, f1: 800, q: 3, gain: 0.2, when: 0.05 + k * 0.09 });
        this.tone(60, 0.7, { type: 'square', slideTo: 30, gain: 0.12 });
        break;
      case 'creak':
        this.tone(140, 0.9, { type: 'sawtooth', slideTo: 90, gain: 0.04, attack: 0.2 });
        break;
      case 'countdown':
        this.tone(880, 0.12, { type: 'triangle', gain: 0.12 });
        break;
      case 'whoosh': // v0.45 new feedback (own switches, no v0.44 equivalent): synthesized when there is no sample
        this.noise(0.3, { type: 'bandpass', f0: 600, f1: 2400, q: 0.8, gain: 0.14, attack: 0.08, pan });
        break;
      case 'launch':
        this.noise(0.35, { type: 'highpass', f0: 500, f1: 4000, gain: 0.2, attack: 0.04, pan });
        this.tone(200, 0.25, { type: 'sine', slideTo: 600, gain: 0.08, pan });
        break;
      case 'flowUp':
        this.tone(880, 0.1, { type: 'triangle', gain: 0.07, pan });
        this.tone(1320, 0.16, { type: 'triangle', gain: 0.06, when: 0.07, pan });
        break;
      // ---- v0.48 Arcade (unpitched stings, so they sit under any song)
      case 'comboUp': { // a show level gained: a short rising shimmer, brighter per level (step 1 … 3)
        const k = Math.max(1, this._step || 1);
        this.noise(0.22, { type: 'bandpass', f0: 1800 + 900 * k, f1: 5200 + 1200 * k, q: 2.2, gain: 0.16, pan });
        this.noise(0.1, { type: 'highpass', f0: 7000, f1: 9000, q: 0.7, gain: 0.07 + 0.02 * k, when: 0.12, pan });
        break;
      }
      case 'comboBreak': // a level lost: a soft falling thud
        this.noise(0.26, { type: 'lowpass', f0: 1400, f1: 180, q: 0.9, gain: 0.26, pan });
        break;
      case 'hallBurst': // the chorus burst: a wide swell
        this.noise(0.5, { type: 'bandpass', f0: 500, f1: 4200, q: 0.8, gain: 0.2, attack: 0.05, pan: -0.5 });
        this.noise(0.5, { type: 'bandpass', f0: 700, f1: 5200, q: 0.8, gain: 0.2, attack: 0.05, pan: 0.5 });
        break;
      case 'waveCharge': // the wave beat is coming: energy gathering
        this.noise(0.9, { type: 'bandpass', f0: 600, f1: 3600, q: 3.5, gain: 0.14, attack: 0.5, pan });
        break;
      case 'waveFire': // the energy wave: a crack, then a rushing beam
        this.noise(0.07, { type: 'highpass', f0: 3000, f1: 6000, q: 0.7, gain: 0.3, pan });
        this.noise(0.5, { type: 'bandpass', f0: 4200, f1: 500, q: 1.4, gain: 0.3, when: 0.03, pan });
        this.noise(0.35, { type: 'lowpass', f0: 240, f1: 70, q: 0.9, gain: 0.3, when: 0.03, pan });
        break;
      case 'shellCrack': { // a layer of the armored pumpkin breaks: a dry crack, higher on each layer (step 1 … 3)
        const k = Math.max(1, this._step || 1);
        this.noise(0.05, { type: 'highpass', f0: 1800 + 700 * k, f1: 3000 + 900 * k, q: 0.8, gain: 0.32, pan });
        this.noise(0.14, { type: 'bandpass', f0: 900 + 500 * k, f1: 400 + 250 * k, q: 2.5, gain: 0.2, when: 0.02, pan });
        break;
      }
      case 'shellRegrow': // a shell beat missed: the layer holds (a dull knock)
        this.noise(0.12, { type: 'lowpass', f0: 420, f1: 160, q: 3, gain: 0.26, pan });
        this.noise(0.1, { type: 'lowpass', f0: 360, f1: 140, q: 3, gain: 0.2, when: 0.11, pan });
        break;
      case 'jetStall': // v0.47 Story chase: the jet sputters (three choked bursts over a falling whine)
        for (let i = 0; i < 3; i++) this.noise(0.09, { type: 'bandpass', f0: 900 - i * 180, f1: 300, q: 1.2, gain: 0.3, when: i * 0.13, pan });
        this.tone(520, 0.55, { type: 'sawtooth', slideTo: 140, gain: 0.1, attack: 0.02, pan });
        break;
      case 'jetRecover': // … and lights up again (rising roar)
        this.noise(0.5, { type: 'bandpass', f0: 300, f1: 2600, q: 0.7, gain: 0.26, attack: 0.08, pan });
        this.tone(140, 0.45, { type: 'sawtooth', slideTo: 620, gain: 0.09, attack: 0.05, pan });
        break;
      case 'playerHit': // a blast reaches the player: low thump + a short ring (no health to lose in Story)
        this.noise(0.18, { type: 'lowpass', f0: 1800, f1: 160, gain: 0.5, pan });
        this.tone(90, 0.2, { type: 'sine', slideTo: 45, gain: 0.4, pan });
        this.tone(1900, 0.18, { type: 'sine', gain: 0.04, when: 0.03, pan });
        break;
      case 'coinBurst': // the punch reward: a quick spray of coin pings
        for (let i = 0; i < 5; i++) this.tone(1500 + ((i * 7) % 5) * 260, 0.09, { type: 'triangle', gain: 0.07, when: i * 0.045, pan });
        break;
      case 'heavyWindupStory': // his heavy pumpkin being charged (Story only; World Chase keeps v0.44's silence for 'heavyWindup')
        this.tone(70, 0.9, { type: 'sawtooth', slideTo: 210, gain: 0.1, attack: 0.3, pan });
        this.noise(0.9, { type: 'bandpass', f0: 200, f1: 1400, q: 1.5, gain: 0.1, attack: 0.5, pan });
        break;
      case 'finisherYank':
        this.noise(0.25, { f0: 800, f1: 3000, q: 2, gain: 0.2, attack: 0.03, pan });
        this.tone(160, 0.25, { type: 'sawtooth', slideTo: 520, gain: 0.07, attack: 0.04, pan });
        break;
      case 'go':
        this.tone(1320, 0.25, { type: 'triangle', gain: 0.14 }); this.tone(1760, 0.3, { type: 'triangle', gain: 0.08, when: 0.05 });
        break;
      case 'slowmoIn': // v0.49 the punch moment: time winds down (a falling whoosh over a sinking tone)
        this.noise(0.55, { type: 'bandpass', f0: 2600, f1: 260, q: 0.9, gain: 0.2, attack: 0.03, pan });
        this.tone(300, 0.6, { type: 'sine', slideTo: 70, gain: 0.12, attack: 0.02, pan });
        break;
      default: break;
    }
  }
  /** Continuous Green Bat Jet engine hum; setLevel(0..1) by distance. */
  startJetHum() {
    if (!this.ctx) return null;
    const c = this.ctx, out = c.createGain(); out.gain.value = 0; out.connect(this.sfx);
    const n = c.createBufferSource(); n.buffer = this.noiseBuffer(); n.loop = true;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 420; f.Q.value = 0.9;
    const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 62;
    const og = c.createGain(); og.gain.value = 0.25;
    n.connect(f).connect(out); o.connect(og).connect(out); n.start(); o.start();
    return {
      setLevel: (v) => { out.gain.setTargetAtTime(0.32 * Math.max(0, Math.min(1, v)), c.currentTime, 0.15); f.frequency.setTargetAtTime(300 + 500 * v, c.currentTime, 0.2); },
      stop: () => { out.gain.setTargetAtTime(0, c.currentTime, 0.2); setTimeout(() => { try { n.stop(); o.stop(); } catch { /* */ } out.disconnect(); }, 800); },
    };
  }
  /** v0.45 rope tension: one low filtered sawtooth per rope; set(level 0..1, hz). Null without an audio context. */
  startTension() {
    if (!this.ctx) return null;
    const c = this.ctx, out = c.createGain(); out.gain.value = 0; out.connect(this.sfx);
    const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = FEEL.speed.tensionHz[0];
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500; f.Q.value = 1.2;
    o.connect(f).connect(out); o.start();
    let last = null;
    return {
      set: (level, hz, k = 1) => { // k: comfort multiplier on gain; skipped while level and hz moved < 1% since the last applied values
        level = Math.max(0, Math.min(1, level)); if (last && Math.abs(level - last[0]) < 0.01 && Math.abs(hz - last[1]) < 0.01 * last[1] && k === last[2]) return; last = [level, hz, k]; const t = c.currentTime; out.gain.setTargetAtTime(FEEL.speed.tensionGain * k * level * level, t, 0.08); o.frequency.setTargetAtTime(hz, t, 0.08); f.frequency.setTargetAtTime(300 + 900 * level, t, 0.1); },
      stop: () => { out.gain.setTargetAtTime(0, c.currentTime, 0.08); setTimeout(() => { try { o.stop(); } catch { /* */ } out.disconnect(); }, 400); },
    };
  }
  /** v0.23 wind while swinging: looped noise through a low-pass that opens with speed. setLevel(0..1). */
  startWind() {
    if (!this.ctx) return null;
    const c = this.ctx, out = c.createGain(); out.gain.value = 0; out.connect(this.sfx);
    const n = c.createBufferSource(); n.buffer = this.noiseBuffer(); n.loop = true;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 300; f.Q.value = 0.7;
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 120;
    n.connect(hp).connect(f).connect(out); n.start();
    return {
      setLevel: (v) => { v = Math.max(0, Math.min(1, v)); out.gain.setTargetAtTime(0.42 * v * v, c.currentTime, 0.12); f.frequency.setTargetAtTime(280 + 1700 * v, c.currentTime, 0.15); },
      stop: () => { out.gain.setTargetAtTime(0, c.currentTime, 0.2); setTimeout(() => { try { n.stop(); } catch { /* */ } out.disconnect(); }, 800); },
    };
  }
  /**
   * v0.27 city ambience: distant traffic rumble (low-passed noise) + tyre hiss, and now and then a far-away horn,
   * randomly panned. setLevel(0..1): ≈1 down on the street, fading with height; low inside Mobius' room.
   */
  startCityAmbience() {
    if (!this.ctx) return null;
    const c = this.ctx, out = c.createGain(); out.gain.value = 0; out.connect(this.ambient);
    const n = c.createBufferSource(); n.buffer = this.noiseBuffer(); n.loop = true;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 170; lp.Q.value = 0.5;
    const rumble = c.createGain(); rumble.gain.value = 0.9;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.6;
    const hiss = c.createGain(); hiss.gain.value = 0.05;
    n.connect(lp).connect(rumble).connect(out); n.connect(bp).connect(hiss).connect(out); n.start();
    let level = 0, stopped = false, timer = 0;
    const honk = () => {
      if (stopped) return;
      if (level > 0.08) {
        const t = c.currentTime + 0.02, pan = c.createStereoPanner ? c.createStereoPanner() : null, g = c.createGain(), f = c.createBiquadFilter();
        f.type = 'lowpass'; f.frequency.value = 1300; const base = 340 + Math.random() * 120, dur = 0.18 + Math.random() * 0.35, two = Math.random() < 0.4;
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05 * level, t + 0.03); g.gain.setValueAtTime(0.05 * level, t + dur); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.12);
        if (pan) { pan.pan.value = Math.random() * 1.6 - 0.8; f.connect(g).connect(pan).connect(out); } else f.connect(g).connect(out);
        for (const fr of [base, base * 1.26]) { const o = c.createOscillator(); o.type = 'square'; o.frequency.value = fr; o.connect(f); o.start(t); o.stop(t + dur + 0.15); }
        if (two) { const t2 = t + dur + 0.12; const o = c.createOscillator(); o.type = 'square'; o.frequency.value = base; const g2 = c.createGain(); g2.gain.setValueAtTime(0.0001, t2); g2.gain.exponentialRampToValueAtTime(0.04 * level, t2 + 0.03); g2.gain.exponentialRampToValueAtTime(0.0001, t2 + 0.2); o.connect(g2).connect(f); o.start(t2); o.stop(t2 + 0.25); }
      }
      timer = setTimeout(honk, 7000 + Math.random() * 16000);
    };
    timer = setTimeout(honk, 5000);
    return {
      setLevel: (v) => { level = Math.max(0, Math.min(1, v)); out.gain.setTargetAtTime(0.22 * level, c.currentTime, 0.6); lp.frequency.setTargetAtTime(120 + 120 * level, c.currentTime, 0.6); },
      stop: () => { stopped = true; clearTimeout(timer); out.gain.setTargetAtTime(0, c.currentTime, 0.4); setTimeout(() => { try { n.stop(); } catch { /* */ } out.disconnect(); }, 2000); },
    };
  }
  /** Haptic pulse on controllers that support it. */
  haptic(inputSource, intensity = 0.5, ms = 40) {
    if (!settings.haptics || !inputSource?.gamepad) return;
    const h = inputSource.gamepad.hapticActuators?.[0];
    try { h?.pulse?.(intensity, ms); } catch { /* ignore */ }
  }

  // ----------------------------------------------------- room theme
  /**
   * v0.28b room theme (ElevenLabs Music, instrumental, 83 BPM lo-fi; cut on the beat grid into a seamless 94.296 s =
   * 131-beat loop). Ogg Opus first (gapless), MP3 fallback; until it is decoded (or if both fail) the old procedural
   * lo-fi loop plays and is crossfaded to the theme once the buffer arrives. Routed to the ambient bus (so voice /
   * radio ducking applies), fades in over ~2 s and out over ~1.2 s.
   */
  static ROOM_THEME = { urls: ['audio/music/room_theme.ogg', 'audio/music/room_theme.mp3'], loopEnd: 94.296, gain: 0.55 };
  loadRoomTheme() {
    if (this._roomThemeP || !this.ctx) return this._roomThemeP;
    const base = import.meta.env?.BASE_URL || '/', T = AudioEngine.ROOM_THEME;
    const tryAt = (i) => i >= T.urls.length ? Promise.resolve(null) : this.loadBuffer(base + T.urls[i]).catch((e) => { console.warn('room theme', T.urls[i], e); return tryAt(i + 1); });
    this._roomThemeP = tryAt(0).then((b) => (this.roomTheme = b));
    return this._roomThemeP;
  }
  startRoomMusic() {
    if (!this.ctx || this._room) return;
    const c = this.ctx, T = AudioEngine.ROOM_THEME;
    const room = this._room = { out: null, theme: null, proc: null, stopped: false };
    const playTheme = (buf) => {
      if (room.stopped || room.theme) return;
      const src = c.createBufferSource(); src.buffer = buf; src.loop = true;
      src.loopStart = 0; src.loopEnd = Math.min(buf.duration, T.loopEnd); // trims encoder padding → no gap at the seam
      const g = c.createGain(); g.gain.value = 0.0001; src.connect(g).connect(this.ambient);
      g.gain.setTargetAtTime(T.gain, c.currentTime, room.proc ? 0.8 : 0.6);
      src.start();
      room.theme = { src, g };
      if (room.proc) { room.proc.stop(1.0); room.proc = null; } // crossfade from the placeholder
    };
    if (this.roomTheme) { playTheme(this.roomTheme); }
    else {
      room.proc = this._proceduralRoom();
      this.loadRoomTheme()?.then((b) => { if (b) playTheme(b); });
    }
    room.stop = () => {
      room.stopped = true;
      room.proc?.stop(0.4);
      if (room.theme) { const { src, g } = room.theme, t0 = c.currentTime; g.gain.cancelScheduledValues(t0); g.gain.setValueAtTime(g.gain.value, t0); g.gain.setTargetAtTime(0.0001, t0, 0.4); try { src.stop(t0 + 2.5); } catch { /* */ } }
    };
  }
  get roomMusicKind() { return !this._room ? null : this._room.theme ? 'theme' : this._room.proc ? 'procedural' : 'loading'; }
  /** Placeholder room music (procedural lo-fi loop) – fallback while / if the theme cannot load. */
  _proceduralRoom() {
    const c = this.ctx;
    const out = c.createGain(); out.gain.value = 0.0001; out.connect(this.ambient);
    out.gain.setTargetAtTime(0.5, c.currentTime, 1.0);
    const chords = [[220, 277.2, 329.6], [196, 246.9, 293.7], [174.6, 220, 261.6], [196, 246.9, 329.6]];
    const beat = 60 / 84;
    let next = c.currentTime + 0.1, step = 0, stopped = false;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400; lp.connect(out);
    const sched = () => {
      if (stopped) return;
      while (next < c.currentTime + 0.5) {
        const bar = Math.floor(step / 8) % 4, s = step % 8;
        if (s === 0) for (const f of chords[bar]) {
          const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
          const g = c.createGain(); g.gain.setValueAtTime(0.0001, next);
          g.gain.exponentialRampToValueAtTime(0.05, next + 0.3); g.gain.exponentialRampToValueAtTime(0.0001, next + beat * 3.8);
          o.connect(g).connect(lp); o.start(next); o.stop(next + beat * 4);
        }
        if (s % 2 === 0) { // soft kick
          const o = c.createOscillator(); o.frequency.setValueAtTime(110, next); o.frequency.exponentialRampToValueAtTime(45, next + 0.15);
          const g = c.createGain(); g.gain.setValueAtTime(0.25, next); g.gain.exponentialRampToValueAtTime(0.0001, next + 0.2);
          o.connect(g).connect(out); o.start(next); o.stop(next + 0.25);
        }
        if (s % 2 === 1) { // hat
          const n = c.createBufferSource(); n.buffer = this.noiseBuffer();
          const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000;
          const g = c.createGain(); g.gain.setValueAtTime(0.03, next); g.gain.exponentialRampToValueAtTime(0.0001, next + 0.05);
          n.connect(f).connect(g).connect(out); n.start(next); n.stop(next + 0.06);
        }
        next += beat / 2; step++;
      }
      this._roomTimer = setTimeout(sched, 120);
    };
    sched();
    return { out, stop: (tc = 0.4) => { stopped = true; clearTimeout(this._roomTimer); out.gain.setTargetAtTime(0.0001, c.currentTime, tc); setTimeout(() => out.disconnect(), tc * 5000); } };
  }
  stopRoomMusic() { this._room?.stop(); this._room = null; }

  // ----------------------------------------------------- v0.43 background music (src/core/bgm.js)
  /**
   * Idempotent: call every frame with the wanted track (or null). Same track → only the level changes (smoothly);
   * another track → the old one fades out (~1.5 s) while the new one is fetched, decoded and faded in. Loops the
   * whole file on the music bus (music volume + voice ducking apply). Only the current track's decoded buffer is kept
   * (a 3-minute 48 kHz stereo track is ~70 MB decoded), so switching maps never accumulates memory.
   */
  setBgm(id, level = 1, { gain = 0.5, url = null } = {}) {
    if (!this.ctx) return;
    const cur = this._bgm;
    if (!id) { if (cur) { this._fadeOutBgm(cur); this._bgm = null; } return; }
    if (cur && cur.id === id) {
      if (Math.abs(cur.level - level) > 1e-3) { cur.level = level; if (cur.g) cur.g.gain.setTargetAtTime(Math.max(0.0001, cur.gain * level), this.ctx.currentTime, 0.35); }
      return;
    }
    if (cur) this._fadeOutBgm(cur);
    const b = this._bgm = { id, level, gain, src: null, g: null };
    const p = this._bgmCache?.id === id ? this._bgmCache.p : (this._bgmCache = { id, p: fetch(url).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); }).then((a) => this.decode(a)) }).p;
    p.then((buf) => {
      if (this._bgm !== b) return; // switched away while loading
      const c = this.ctx, src = c.createBufferSource(); src.buffer = buf; src.loop = true;
      const g = c.createGain(); g.gain.value = 0.0001; src.connect(g).connect(this.music);
      g.gain.setTargetAtTime(Math.max(0.0001, b.gain * b.level), c.currentTime, 0.6);
      src.start(); b.src = src; b.g = g;
    }).catch((e) => { console.warn('bgm', id, e); if (this._bgmCache?.id === id) this._bgmCache = null; });
  }
  _fadeOutBgm(b) {
    if (!b.g) return;
    const c = this.ctx, t0 = c.currentTime;
    b.g.gain.cancelScheduledValues(t0); b.g.gain.setValueAtTime(b.g.gain.value, t0); b.g.gain.setTargetAtTime(0.0001, t0, 0.4);
    try { b.src.stop(t0 + 2.5); } catch { /* */ }
    setTimeout(() => { try { b.g.disconnect(); } catch { /* */ } }, 3000);
  }
  get bgmState() { const b = this._bgm; return b ? { id: b.id, level: b.level, playing: !!b.src } : null; }
}

export const audio = new AudioEngine();

// =========================================================================
// Conductor – the rhythm clock. Song time comes from the AudioContext clock
// (getOutputTimestamp when available), never from accumulated frame deltas.
// =========================================================================
export class Conductor {
  constructor(engine = audio) {
    this.engine = engine;
    this.buffer = null;
    this.source = null;
    this.state = 'stopped'; // stopped | playing | paused | resuming | ended
    this.startCtx = 0; // ctx time at which song time `startPos` is heard (before latency)
    this.startPos = 0;
    this.pausedPos = 0;
    this.duration = 0;
    this.onEnded = null;
    this._last = -Infinity;
    this.rate = 1; // debug fast-forward is NOT supported via rate; tests use seek
  }
  load(buffer) { this.stop(); this.buffer = buffer; this.duration = buffer.duration; }
  get ctx() { return this.engine.ctx; }

  /** Output latency (s) between scheduling and the sound reaching the ears. */
  latency() {
    const c = this.ctx;
    return (c.outputLatency || 0) + (c.baseLatency || 0);
  }
  _ctxNowHeard() {
    const c = this.ctx;
    if (c.getOutputTimestamp) {
      const ts = c.getOutputTimestamp();
      if (ts.contextTime > 0 && ts.performanceTime > 0) {
        return ts.contextTime + (performance.now() - ts.performanceTime) / 1000;
      }
    }
    return c.currentTime - this.latency();
  }

  /** Start (or restart) playback so that song time `pos` is heard after `leadIn` seconds. */
  play(pos = 0, leadIn = 0.1) {
    this._stopSource();
    const c = this.ctx;
    const when = c.currentTime + leadIn;
    const src = c.createBufferSource();
    src.buffer = this.buffer;
    src.connect(this.engine.music);
    if (pos >= 0) src.start(when, pos);
    else src.start(when - pos, 0); // negative pos = silence before audio start
    src.onended = () => {
      if (this.source === src && this.state === 'playing' && this.now() >= this.duration - 0.05) {
        this.state = 'ended';
        this.onEnded?.();
      }
    };
    this.source = src;
    this.startCtx = when;
    this.startPos = pos;
    this.state = 'playing';
    this._last = -Infinity;
  }

  /** Current heard song time in seconds. Monotonic while playing. */
  now() {
    if (!this.ctx) return 0;
    if (this.state === 'paused' || this.state === 'stopped') return this.pausedPos;
    let t = this._ctxNowHeard() - this.startCtx + this.startPos;
    if (this.state === 'resuming') {
      t = Math.min(t, this.pausedPos);
      if (this._ctxNowHeard() >= this.startCtx) this.state = 'playing';
    }
    if (t < this._last) t = this._last; // never go backwards (jitter in timestamps)
    this._last = t;
    return t;
  }

  pause() {
    if (this.state !== 'playing' && this.state !== 'resuming') return;
    this.pausedPos = Math.max(0, this.now());
    this._stopSource();
    this.state = 'paused';
  }
  /** Resume after a countdown; song time is frozen at pausedPos until audio resumes. */
  resume(countdown = 0) {
    if (this.state !== 'paused') return;
    const pos = this.pausedPos;
    this.play(pos, Math.max(0.05, countdown));
    this.state = countdown > 0 ? 'resuming' : 'playing';
    this.pausedPos = pos;
    this._last = -Infinity;
  }
  stop() { this._stopSource(); this.state = 'stopped'; this.pausedPos = 0; }
  _stopSource() {
    if (this.source) {
      this.source.onended = null;
      try { this.source.stop(); } catch { /* ignore */ }
      this.source.disconnect();
      this.source = null;
    }
  }
  /** Check for natural end (called each frame; onended can be unreliable). */
  tick() {
    if (this.state === 'playing' && this.now() >= this.duration) {
      this._stopSource();
      this.state = 'ended';
      this.onEnded?.();
    }
  }
}
