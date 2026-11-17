// Rhythm judgement & scoring. Spatial hit (aim assist) and timing are separate:
// aim decides IF it hit, |input time − note time| decides Perfect / Good.
import { settings } from '../core/settings.js';

export const JUDGE = { PERFECT: 'perfect', GOOD: 'good', MISS: 'miss' };
export const BASE_SCORE = { perfect: 300, good: 120, miss: 0 };

export function judgeTiming(dt, perfectWindow = settings.perfectWindow, goodWindow = settings.goodWindow) {
  const a = Math.abs(dt);
  if (a <= perfectWindow) return JUDGE.PERFECT;
  if (a <= goodWindow) return JUDGE.GOOD;
  return null; // outside window
}

export function rankFor(acc, failed) {
  if (failed) return 'F';
  if (acc >= 0.95) return 'S';
  if (acc >= 0.85) return 'A';
  if (acc >= 0.7) return 'B';
  if (acc >= 0.55) return 'C';
  return 'D';
}

export class ScoreKeeper {
  constructor(totalNotes) { this.total = totalNotes; this.reset(); }
  reset() {
    this.score = 0; this.combo = 0; this.maxCombo = 0;
    this.counts = { perfect: 0, good: 0, miss: 0 };
    this.shield = 100; this.failed = false;
    this.invalid = []; this.overheatUntil = -1;
    this.judged = new Set(); this.offsets = [];
  }
  get judgedCount() { return this.counts.perfect + this.counts.good + this.counts.miss; }
  get accuracy() {
    const n = this.judgedCount;
    return n ? (this.counts.perfect + this.counts.good * 0.6) / n : 1;
  }
  get multiplier() { return 1 + Math.min(this.combo, 60) / 30; } // up to ×3
  /** Register a judgement for note `id` (each note is judged exactly once). */
  record(id, result, { dt = 0, weight = 1 } = {}) {
    if (this.judged.has(id)) return false;
    this.judged.add(id);
    this.counts[result]++;
    if (result === JUDGE.MISS) {
      this.combo = 0;
      if (!settings.noFail) { this.shield = Math.max(0, this.shield - 8 * weight); if (this.shield <= 0) this.failed = true; }
    } else {
      this.combo++; this.maxCombo = Math.max(this.maxCombo, this.combo);
      this.score += Math.round(BASE_SCORE[result] * this.multiplier * weight);
      this.shield = Math.min(100, this.shield + (result === JUDGE.PERFECT ? 2 : 1));
      this.offsets.push(dt);
    }
    return true;
  }
  /** Invalid / early shots feed an anti-spam meter → OVERHEAT locks weapons. */
  invalidShot(t) {
    this.invalid.push(t);
    while (this.invalid.length && t - this.invalid[0] > 1.6) this.invalid.shift();
    if (this.invalid.length >= 5) { this.overheatUntil = t + 1.2; this.invalid.length = 0; return true; }
    return false;
  }
  overheated(t) { return t < this.overheatUntil; }
  meanOffsetMs() { return this.offsets.length ? (this.offsets.reduce((a, b) => a + b, 0) / this.offsets.length) * 1000 : 0; }
  summary() {
    return { score: this.score, maxCombo: this.maxCombo, accuracy: this.accuracy, counts: { ...this.counts }, failed: this.failed, rank: rankFor(this.accuracy, this.failed), meanOffsetMs: this.meanOffsetMs() };
  }
}
