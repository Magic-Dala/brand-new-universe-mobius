// v0.45 boss finisher — after the last hit the boss stalls; the player grabs the tether with BOTH hands and pulls
// for the kill, or the timeout blasts it anyway. PURE (no three.js / audio): worldChase.js reports the hands and the
// pull gesture and turns the events into VFX, bonus style and audio. Runs on real dt; update(0) (paused) never advances.
//
//   idle ─start─▶ stall ⇄ tethered (both hands) ─pull─▶ yank ─▶ blast ─▶ done
//                   └──── timeout (from start, stall / tethered only) ────▶ blast (not byPlayer)
import { FEEL } from '../data/feel.js';

export const FINISHER_STATES = ['idle', 'stall', 'tethered', 'yank', 'blast', 'done'];

export class Finisher {
  constructor(cfg = FEEL.finisher) { this.cfg = cfg; this.abort(); }
  get state() { return this.st; }
  get active() { return this.st === 'stall' || this.st === 'tethered' || this.st === 'yank' || this.st === 'blast'; }
  get byPlayer() { return this.by; }
  get hands() { return { left: this.hl, right: this.hr }; }
  abort() { this.st = 'idle'; this.hl = false; this.hr = false; this.by = false; this.t = 0; this.stateT = 0; this.queue = []; }
  start() { if (this.st !== 'idle') return false; this.abort(); this.st = 'stall'; this.queue.push({ type: 'stall' }); return true; }
  _grip() { // both hands ⇒ tethered, otherwise stall
    const to = this.hl && this.hr ? 'tethered' : 'stall'; if (to === this.st) return;
    this.st = to; this.queue.push({ type: to === 'tethered' ? 'tethered' : 'untethered' });
  }
  tether(hand) { if (this.st !== 'stall' && this.st !== 'tethered') return; if (hand === 'left') this.hl = true; else if (hand === 'right') this.hr = true; this._grip(); }
  untether(hand) { if (this.st !== 'stall' && this.st !== 'tethered') return; if (hand === 'left') this.hl = false; else if (hand === 'right') this.hr = false; this._grip(); }
  pull() { if (this.st !== 'tethered') return false; this.st = 'yank'; this.by = true; this.stateT = 0; this.queue.push({ type: 'yank', byPlayer: true }); return true; }
  _blast() { this.st = 'blast'; this.queue.push({ type: 'blast', byPlayer: this.by }); }
  update(realDt) {
    if (realDt > 0 && this.active) {
      this.t += realDt; this.stateT += realDt;
      if ((this.st === 'stall' || this.st === 'tethered') && this.t >= this.cfg.timeout) { this._blast(); this.stateT = 0; }
      else if (this.st === 'yank' && this.stateT >= this.cfg.yankTime) { this.stateT -= this.cfg.yankTime; this._blast(); }
      if (this.st === 'blast' && this.stateT >= this.cfg.blastTime) { this.st = 'done'; this.queue.push({ type: 'done', byPlayer: this.by }); }
    }
    const out = this.queue; this.queue = []; return out;
  }
}
