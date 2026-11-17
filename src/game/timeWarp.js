// v0.45 impact time warp — a short global slow-motion curve for the world simulation (counter / shield break hits,
// the boss defeat). PURE (no three.js / audio): worldChase.js feeds it real dt and multiplies the world dt by the
// returned scale; head pose, hands, HUD and menus keep running on real dt. Phases: idle → hold (at the slow scale)
// → ease (linear in scale back to 1) → idle. hold() keeps a scale until release(ease). The slowest request wins; a
// request during an ease restarts from the slower of the two scales. update(0) (paused) changes nothing.
// v0.49 the punch moment: approach(gap) holds the slow approach scale once the fly-in is inside FEEL.warp.approach.dist;
// impact(kind) ends that hold with the hit's own warp; cancelApproach() ends it with no hit. A finisher hold() always wins.
import { FEEL } from '../data/feel.js';

export class TimeWarp {
  constructor(cfg = FEEL.warp) { this.cfg = cfg; this.reset(); }
  reset() { this.s = 1; this.phase = 'idle'; this.held = false; this.holdLeft = 0; this.easeLen = 0; this.easeT = 0; this.from = 1; this.approaching = false; }
  get scale() { return this.s; }
  get active() { return this.phase !== 'idle'; }
  _min(scale, comfort) { return comfort ? Math.max(scale, this.cfg.comfort.minScale) : scale; }
  request(kind, { comfort = false } = {}) {
    const c = this.cfg[kind]; if (!c || kind === 'defeat' || kind === 'comfort' || this.held) return;
    const s = this._min(c.scale, comfort), h = c.hold * (comfort ? this.cfg.comfort.holdMul : 1);
    if (this.phase === 'hold' && s > this.s) { this.holdLeft = Math.max(this.holdLeft, h); this.easeLen = Math.max(this.easeLen, c.ease); return; } // milder: keep the slower scale
    this.s = Math.min(this.s, s); this.phase = 'hold'; this.holdLeft = h; this.easeLen = c.ease; this.easeT = 0;
  }
  hold(scale, { comfort = false } = {}) { this.approaching = false; this.s = this._min(scale, comfort); this.phase = 'hold'; this.held = true; this.holdLeft = Infinity; }
  release(ease) { if (!this.held) return; this.held = false; this.approaching = false; this.holdLeft = 0; this.easeLen = ease; }
  /** v0.49: the fly-in is `gap` metres from him. Inside cfg.approach.dist the slow scale holds until impact() / cancelApproach(). True on the frame it starts. */
  approach(gap, { comfort = false } = {}) {
    const c = this.cfg.approach; if (!c || this.held || this.approaching || !(gap <= c.dist)) return false;
    this.hold(c.scale, { comfort }); this.approaching = true;
    return true;
  }
  /** v0.49: the hit landed. Ends an approach and plays `kind`'s warp from the slow scale; with no approach it is request(kind). */
  impact(kind, opts) {
    if (this.approaching) { this.approaching = false; this.held = false; this.holdLeft = 0; this.easeLen = 0; }
    this.request(kind, opts);
  }
  /** v0.49: the fly-in ended with no hit: back to full speed over cfg.approach.ease. True when an approach was running. */
  cancelApproach() { if (!this.approaching) return false; this.release(this.cfg.approach.ease); return true; }
  update(realDt) {
    if (!(realDt > 0) || this.phase === 'idle') return this.s;
    let dt = realDt;
    if (this.phase === 'hold') {
      if (this.held || (this.holdLeft -= dt) > 0) return this.s;
      dt = -this.holdLeft; this.phase = 'ease'; this.from = this.s; this.easeT = 0; // leftover time goes into the ease
    }
    this.easeT += dt;
    if (this.easeLen <= 0 || this.easeT >= this.easeLen) { this.s = 1; this.phase = 'idle'; } else this.s = this.from + (1 - this.from) * (this.easeT / this.easeLen);
    return this.s;
  }
}
