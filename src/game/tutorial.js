// v0.49 Story tutorials — the page logic and the panel's layout helpers. PURE: no three.js, no DOM, no audio.
// src/ui/tutorialPanel.js draws what this says; src/game/story.js and src/game/factoryFlow.js open the tutorials.
//   Tutorials    which tutorial is open, which page, next / back / skip / done, and "at most once per Story run"
//   mediaSlots   where one or two clips sit inside the panel's media area
//   fitInto      a picture of another shape inside a slot
//   panelSpot    where the panel goes: straight ahead, or toward the middle of the room when a wall is in the way
//   clipUpload   when a clip's picture is sent to the GPU again
import { TUTORIALS, TUTORIAL_PANEL } from '../data/tutorials.js';

export class Tutorials {
  constructor(sets = TUTORIALS) { this.sets = sets; this._ev = []; this._spare = []; this._shown = new Set(); this._id = null; this._page = 0; }
  /** A new Story run: nothing has been shown; an open tutorial is closed without an event. */
  reset() { this._shown.clear(); this._id = null; this._page = 0; this._ev.length = 0; }
  /** The id of the open tutorial, or null. */
  get active() { return this._id; }
  get page() { return this._page; }
  get pageCount() { return this._id ? this.sets[this._id].pages.length : 0; }
  get isFirst() { return this._page === 0; }
  get isLast() { return !!this._id && this._page === this.pageCount - 1; }
  /** The open page's data ({ title, line, media }), or null. */
  get current() { return this._id ? this.sets[this._id].pages[this._page] : null; }
  /** This tutorial has been opened in this run. */
  shown(id) { return this._shown.has(id); }
  /**
   * Open tutorial `id` on its first page. False (and nothing changes) when the switch is off (enabled: false), another one
   * is open, the id is unknown, or it was already shown in this run.
   */
  open(id, { enabled = true } = {}) {
    if (!enabled || this._id || !this.sets[id] || this._shown.has(id)) return false;
    this._id = id; this._page = 0; this._shown.add(id);
    this._ev.push({ type: 'open', id });
    return true;
  }
  next() { if (!this._id || this.isLast) return false; this._page++; this._ev.push({ type: 'page', id: this._id, page: this._page }); return true; }
  back() { if (!this._id || this.isFirst) return false; this._page--; this._ev.push({ type: 'page', id: this._id, page: this._page }); return true; }
  /** The Done button: closes it, from the last page only. */
  done() { return this.isLast ? this._close('done') : false; }
  /** The Skip button: closes the whole tutorial from any page. */
  skip() { return this._id ? this._close('skip') : false; }
  _close(how) { const id = this._id; this._id = null; this._page = 0; this._ev.push({ type: 'close', id, how }); return true; }
  /** Events since the last drain(): { type: 'open', id } | { type: 'page', id, page } | { type: 'close', id, how: 'done' | 'skip' }. The array is reused. */
  drain() { const out = this._ev; this._ev = this._spare; this._ev.length = 0; this._spare = out; return out; }
}

/** n = 1 or 2 clips: 16:9 slots ({ x, y, w, h } in panel pixels) inside the media area; two sit side by side with cfg.gap between them. */
export function mediaSlots(n, cfg = TUTORIAL_PANEL) {
  const A = cfg.media, R = 16 / 9, k = n >= 2 ? 2 : 1;
  const w = Math.min((A.w - cfg.gap * (k - 1)) / k, A.h * R), h = w / R;
  const x0 = A.x + (A.w - (w * k + cfg.gap * (k - 1))) / 2, y = A.y + (A.h - h) / 2;
  const out = []; for (let i = 0; i < k; i++) out.push({ x: x0 + i * (w + cfg.gap), y, w, h });
  return out;
}

/** The largest box of `aspect` (width / height) inside `slot`, centred in it. */
export function fitInto(aspect, slot) {
  const w = Math.min(slot.w, slot.h * aspect), h = w / aspect;
  return { x: slot.x + (slot.w - w) / 2, y: slot.y + (slot.h - h) / 2, w, h };
}

/**
 * Where the panel's centre goes on the floor plane. head = { x, z }, fwd = the unit direction the player looks along
 * (flat), room = { minX, maxX, minZ, maxZ } in the same coordinates, or null outside a room. Straight ahead at cfg.dist;
 * if that leaves the room (less cfg.wallMargin), toward the middle of the room instead, pulled in to stay inside the walls.
 */
export function panelSpot(head, fwd, room = null, cfg = TUTORIAL_PANEL) {
  const at = (dx, dz, d) => ({ x: head.x + dx * d, z: head.z + dz * d });
  const s = at(fwd.x, fwd.z, cfg.dist);
  if (!room) return s;
  const m = cfg.wallMargin, x0 = room.minX + m, x1 = room.maxX - m, z0 = room.minZ + m, z1 = room.maxZ - m;
  const ok = (p) => p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1;
  if (ok(s)) return s;
  let dx = (room.minX + room.maxX) / 2 - head.x, dz = (room.minZ + room.maxZ) / 2 - head.z; const L = Math.hypot(dx, dz);
  if (L < 0.3) { dx = -fwd.x; dz = -fwd.z; } else { dx /= L; dz /= L; } // (standing in the middle, nose to… nothing: behind is as good as anywhere)
  for (let d = cfg.dist; d >= cfg.minDist - 1e-9; d -= 0.05) { const p = at(dx, dz, d); if (ok(p)) return p; }
  const p = at(dx, dz, cfg.minDist);
  return { x: Math.min(x1, Math.max(x0, p.x)), z: Math.min(z1, Math.max(z0, p.z)) };
}

/** The upload state of one clip slot; a fresh one whenever the slot gets another clip. */
export const newClip = () => ({ t: -1, at: -Infinity });
/**
 * Should this clip's current picture be sent to the GPU now? c = its state (newClip()), time = the clip's playback time
 * (s), nowMs = the clock (ms), ready = the clip has a picture to show. True for the first ready picture, then whenever the
 * time has moved and gapMs has passed: about once per video frame, never for a paused or stalled clip. (The browser's own
 * "new video frame" signal is not relied on: it does not always fire for a clip that only lives on a texture.)
 */
export function clipUpload(c, time, nowMs, ready, gapMs = TUTORIAL_PANEL.uploadGap) {
  if (!ready || time === c.t || nowMs - c.at < gapMs) return false;
  c.t = time; c.at = nowMs;
  return true;
}
