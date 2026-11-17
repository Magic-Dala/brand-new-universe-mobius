// Tap-along timing calibration: 8 metronome clicks at 125 BPM; the player
// fires a web (or trigger/click) on each. Median offset → settings.offsetMs.
import { audio, Conductor } from '../core/audio.js';
import { settings } from '../core/settings.js';

export class Calibration {
  constructor(app) { this.app = app; this.beats = 8; this.period = 60 / 125; this.reset(); this._clock = new Conductor(audio); }
  reset() { this.index = 0; this.hits = []; this.done = false; this.resultMs = 0; this.base = 0; this.running = false; }
  start() {
    this.reset();
    const c = audio.ctx; if (!c) return;
    this.base = c.currentTime + 1.2;
    for (let i = 0; i < this.beats; i++) {
      const when = this.base + i * this.period - c.currentTime;
      audio.tone(i % 4 === 0 ? 1760 : 1320, 0.05, { type: 'square', gain: 0.2, when });
    }
    this.running = true;
    this.app.menus.panels.calib.dirty = true;
  }
  heardNow() { return this._clock._ctxNowHeard(); }
  update(events) {
    if (!this.running) return;
    const now = this.heardNow();
    const idx = Math.max(0, Math.min(this.beats, Math.floor((now - this.base) / this.period + 1)));
    if (idx !== this.index) { this.index = idx; this.app.menus.panels.calib.dirty = true; }
    for (const e of events) {
      if (e.type !== 'web' && e.type !== 'select') continue;
      const k = Math.round((now - this.base) / this.period);
      if (k < 0 || k >= this.beats) continue;
      const dt = now - (this.base + k * this.period);
      if (Math.abs(dt) < 0.3 && this.hits[k] == null) { this.hits[k] = dt; audio.play('good'); }
    }
    if (now > this.base + (this.beats - 1) * this.period + 0.5) {
      this.running = false; this.done = true;
      const v = this.hits.filter((x) => x != null).sort((a, b) => a - b);
      this.resultMs = v.length ? v[Math.floor(v.length / 2)] * 1000 : 0;
      if (!v.length) this.done = false;
      this.app.menus.panels.calib.dirty = true;
    }
  }
  apply() { settings.offsetMs = Math.round(this.resultMs); }
}
