// v0.46 close combat tunables (World Chase): close range (inside tauntIn he lets the player come to holdGap and turns to
// taunt; beyond tauntOut he surfs again; camping campTime → he boosts away to boostOut, then lockout s of the v0.45 8 m
// floor), the punch (revision 4: a web at a staggered boss inside close range = the fly-in hit, the lunge; body contact is a
// hit too), Green Maniac's hit reactions and the impact bursts. Seconds / metres.
// The time-warp numbers and the Flow gain for a punch live in src/data/feel.js (FEEL.warp.punch, FEEL.flow.gains.punch).
export const CLOSE = {
  holdGap: 2.2, tauntIn: 15, tauntOut: 17, campTime: 5, lockout: 6,
  boostOut: 19, // m: a camping boost ends here (tauntOut + 2: he does not re-enter close range the instant it ends)
  brakeAccel: 28, // m/s²: how hard he matches a faster player inside close range (the floor engages early enough to brake at this rate)
  noPass: 1.5, // m: last resort in close range — his route position never comes closer than this (he is never flown through)
  brakeHold: 0.3, // m above the early floor where he keeps at least the player's speed once matched (no brake / cap chatter)
  ring: { radius: 1.5, color: 0xff3b30, pulseHz: 1.6, opacity: [0.55, 0.95] },
  punch: { interval: 0.5, flow: 2 }, // (the damage limiter itself is FIGHT.punchInterval; the Flow gain FEEL.flow.gains.punch)
  // the fly-in: accel to speed (comfortSpeed in comfort mode), contact at `contact` m from his body point, or give up after
  // timeout s; a contact pushes the player back (relative speed toward him dropped, rebound m/s away + reboundUp m/s up);
  // body contacts outside a lunge at most once per cooldown s
  lunge: { speed: 24, comfortSpeed: 14, accel: 45, timeout: 1.0, contact: 1.6, rebound: 8, reboundUp: 3, cooldown: 0.8 },
  react: { minGap: 0.4 },
  anim: { tauntIn: 0.3, hitIn: 0.2, hitOut: 0.25 }, // (hitIn: from surf the hips jump ≈ 0.88 rad; a faster fade pins the tail tip)
  fx: { minGap: 0.25 }, // s: at most one impact burst per this long
};
