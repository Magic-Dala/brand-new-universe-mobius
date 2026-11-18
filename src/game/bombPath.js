// v1.1 chase pumpkins: PURE pieces of the soft tracking and the path preview (three.js vectors only, no scene).
// Tracking is mild and fair: during the flight the aim follows the player with today's limited lead (for the time
// left), at most `maxShift` from where it was at release, and the velocity bends toward it by at most accel·dt per
// step. It lets go `letGo` s before arrival or `letGoDist` m from the chest, and never steers back toward a player
// the pumpkin has already passed. Unit tested in tests/bombpath.test.mjs.
import * as THREE from 'three';

const _lead = new THREE.Vector3(), _d = new THREE.Vector3();

/**
 * Aim point for the time left: chest + limited lead (vel · tRem · leadFactor, at most maxLead) + the pumpkin's own
 * spread offset, clamped to at most cfg.maxShift from aim0 (the aim at release). cfg: { leadFactor, maxLead, maxShift }.
 */
export function trackedAim(aim0, chest, vel, tRem, offset, cfg, out = new THREE.Vector3()) {
  _lead.copy(vel).multiplyScalar(Math.max(0, tRem) * cfg.leadFactor);
  if (_lead.lengthSq() > cfg.maxLead * cfg.maxLead) _lead.setLength(cfg.maxLead);
  out.copy(chest).add(_lead);
  if (offset) out.add(offset);
  _d.subVectors(out, aim0);
  if (_d.lengthSq() > cfg.maxShift * cfg.maxShift) out.copy(aim0).add(_d.setLength(cfg.maxShift));
  return out;
}

/**
 * Velocity after one step: toward the velocity that reaches `aim` in tRem s under gravity g, changed by at most
 * accel·dt (m/s). Written to `out` (may be `vel`).
 */
export function steer(pos, vel, aim, tRem, g, accel, dt, out = new THREE.Vector3()) {
  const T = Math.max(tRem, 1e-3);
  _d.subVectors(aim, pos).divideScalar(T); _d.y += 0.5 * g * T; // the wanted velocity (launchVelocity)
  _d.sub(vel);
  const max = accel * dt;
  if (_d.lengthSq() > max * max) _d.setLength(max);
  return out.copy(vel).add(_d);
}

/** Is tracking still on? tRem: s to arrival; dist: m to the chest; passed: the pumpkin has gone by the player. */
export function tracking(tRem, dist, passed, cfg) {
  return !passed && tRem > cfg.letGo && dist > cfg.letGoDist;
}

/** Has the pumpkin gone by the player? (its horizontal velocity points away from the chest) */
export function passedPlayer(pos, vel, chest) {
  return (chest.x - pos.x) * vel.x + (chest.z - pos.z) * vel.z <= 0;
}

/**
 * n points of the remaining ballistic flight (pos, vel, gravity g, tRem s) into `out` (Float32Array, 3·n numbers):
 * point 0 is `pos`, point n−1 is where it will be after tRem.
 */
export function samplePath(pos, vel, g, tRem, n, out) {
  for (let i = 0; i < n; i++) {
    const t = (tRem * i) / (n - 1);
    out[i * 3] = pos.x + vel.x * t;
    out[i * 3 + 1] = pos.y + vel.y * t - 0.5 * g * t * t;
    out[i * 3 + 2] = pos.z + vel.z * t;
  }
  return out;
}
