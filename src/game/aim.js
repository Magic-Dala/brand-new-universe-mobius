// Aim assist (命中輔助): a target's hit-zone is its projected width/height,
// expanded by `margin` on every side (default 10% → zone = 120% of size).
// Projection is done in the aim ray's own frame (single reference point: the
// ray origin), so the result is identical for both eyes and reproducible.
import * as THREE from 'three';

const _right = new THREE.Vector3(), _up = new THREE.Vector3(), _rel = new THREE.Vector3();
const WORLD_UP = new THREE.Vector3(0, 1, 0);

/**
 * @param {THREE.Vector3} origin  ray origin (world)
 * @param {THREE.Vector3} dir     normalized ray direction (world)
 * @param {Array<{pos:THREE.Vector3, w:number, h:number}>} candidates
 * @param {object} opt { margin=0.1, maxDist=60, minDist=0.2, occluded?(origin, pos)=>bool }
 * @returns {{target, score, offX, offY, dist}|null}  score = normalized offset (0 = dead centre, 1 = zone edge)
 */
export function pickTarget(origin, dir, candidates, opt = {}) {
  const margin = opt.margin ?? 0.1, maxDist = opt.maxDist ?? 60, minDist = opt.minDist ?? 0.2;
  // ray frame
  _right.crossVectors(dir, WORLD_UP);
  if (_right.lengthSq() < 1e-6) _right.set(1, 0, 0);
  _right.normalize();
  _up.crossVectors(_right, dir).normalize();
  let best = null;
  for (const c of candidates) {
    _rel.copy(c.pos).sub(origin);
    const dist = _rel.dot(dir);
    if (dist < minDist || dist > maxDist) continue; // behind or out of range
    const ox = _rel.dot(_right), oy = _rel.dot(_up);
    const halfW = (c.w / 2) * (1 + 2 * margin); // 10% → 120% zone width
    const halfH = (c.h / 2) * (1 + 2 * margin);
    const nx = Math.abs(ox) / halfW, ny = Math.abs(oy) / halfH;
    if (nx > 1 || ny > 1) continue;
    if (opt.occluded && opt.occluded(origin, c.pos, c)) continue; // no hitting through walls
    const score = Math.hypot(nx, ny);
    // closest to the reticle wins; ties → nearer target
    if (!best || score < best.score - 1e-6 || (Math.abs(score - best.score) < 1e-6 && dist < best.dist)) {
      best = { target: c, score, offX: ox, offY: oy, dist };
    }
  }
  return best;
}

/**
 * Angular acceptance zone: returns the target size (w = h) whose 120%-style zone
 * (with `margin`) spans exactly ±halfAngleDeg around the aim ray at distance d,
 * never smaller than minHalf metres. Used for far swing anchors.
 */
export function angularZoneSize(d, halfAngleDeg, margin = 0, minHalf = 1.2) {
  const half = Math.max(minHalf, d * Math.tan(THREE.MathUtils.degToRad(halfAngleDeg)));
  return (2 * half) / (1 + 2 * margin);
}

/** Zone half-extents (metres) for a target – exposed for the dev visualiser. */
export const zoneHalfExtents = (w, h, margin) => ({ x: (w / 2) * (1 + 2 * margin), y: (h / 2) * (1 + 2 * margin) });
