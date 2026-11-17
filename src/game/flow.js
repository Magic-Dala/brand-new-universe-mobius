// v0.45 Flow meter — points earned by good play (pumpkins, blocks, pulls, counters …) rise through levels 0–3 and
// decay when idle; getting hurt drops one level. PURE (no three.js / audio): worldChase.js feeds it events and turns
// the level into beam / wind / music tint. Level changes caused by gain() / hurt() are queued and returned by the
// next update(). Style score per event = styleBase × (1 + level before the gain).
import { FEEL } from '../data/feel.js';

export class Flow {
  constructor(cfg = FEEL.flow) { this.cfg = cfg; this.reset(); }
  reset() { this.pts = 0; this.lvl = 0; this.pk = 0; this.sty = 0; this.idle = 0; this.queue = []; }
  get level() { return this.lvl; }
  get points() { return this.pts; }
  get peak() { return this.pk; }
  get style() { return this.sty; }
  _sync() { // re-derive the level from the points; queue one event per change
    const lvl = this.cfg.thresholds.filter((t) => this.pts >= t).length;
    if (lvl === this.lvl) return;
    this.queue.push({ type: lvl > this.lvl ? 'levelUp' : 'levelDown', level: lvl }); this.lvl = lvl; this.pk = Math.max(this.pk, lvl);
  }
  gain(kind) {
    const g = this.cfg.gains[kind]; if (!g) return 0;
    const style = this.cfg.styleBase * (1 + this.lvl); this.sty += style;
    this.pts = Math.min(this.cfg.maxPoints, this.pts + g); this.idle = 0; this._sync(); return style;
  }
  bonus(n) { this.sty += n; }
  hurt() { this.pts = this.lvl > 0 ? this.cfg.thresholds[this.lvl - 1] - 1 : 0; this._sync(); }
  update(dt) {
    if (dt > 0) {
      const before = this.idle; this.idle += dt;
      const decaying = this.idle - Math.max(before, this.cfg.decayDelay); // only the part of dt past the delay
      if (decaying > 0 && this.pts > 0) { this.pts = Math.max(0, this.pts - this.cfg.decayRate * decaying); this._sync(); }
    }
    const out = this.queue; this.queue = []; return out;
  }
}
