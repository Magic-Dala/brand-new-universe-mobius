// v0.46 Green Maniac hit reactions (World Chase): which clip a hit plays, and the gate that decides whether it plays.
import { CLOSE } from '../data/closeCombat.js';

/** 'head' for a punch; any other source (web, Light Bomb, tether, Fan Web, counter) head or body at random. */
export function pickReaction(src, rnd = Math.random) { return src === 'punch' || rnd() < 0.5 ? 'head' : 'body'; }

/**
 * At most one reaction per cfg.minGap seconds, and none while he winds up or throws (the telegraph stays readable).
 * Two steps: allow() only answers; mark() takes the slot — call it only once the model actually played the reaction.
 */
export class ReactionGate {
  constructor(cfg = CLOSE.react) { this.cfg = cfg; this.last = -Infinity; }
  allow(t, fightState) { return fightState !== 'telegraph' && fightState !== 'attack' && t - this.last >= this.cfg.minGap; }
  mark(t) { this.last = t; }
  reset() { this.last = -Infinity; }
}
